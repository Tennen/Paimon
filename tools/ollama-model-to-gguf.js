#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function usage() {
  console.log(`
Usage:
  node tools/ollama-model-to-gguf.js --model <name[:tag]> [options]

Options:
  --output-dir <dir>    target directory (default: ~/.llm/models)
  --output-file <name>  output file name (default: auto generated)
  --force               overwrite output file if exists
  --manifest-root <dir> custom Ollama manifests root (default: ~/.ollama/models/manifests)
  --blob-root <dir>     custom Ollama blobs root (default: ~/.ollama/models/blobs)
  -h, --help            show help

Example:
  node tools/ollama-model-to-gguf.js --model qwen3:4b
  node tools/ollama-model-to-gguf.js --model qwen3:4b --output-dir ~/.llm/models --force
`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const options = {
    model: "",
    outputDir: "~/.llm/models",
    outputFile: "",
    force: false,
    manifestRoot: "~/.ollama/models/manifests",
    blobRoot: "~/.ollama/models/blobs"
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--model") {
      options.model = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--output-file") {
      options.outputFile = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--manifest-root") {
      options.manifestRoot = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--blob-root") {
      options.blobRoot = args[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (!options.model.trim()) {
    fail("Missing --model");
  }

  const manifestRoot = expandHome(options.manifestRoot.trim());
  const blobRoot = expandHome(options.blobRoot.trim());
  const outputDir = expandHome(options.outputDir.trim());

  const modelRef = parseModelReference(options.model.trim());
  const manifestPath = path.join(
    manifestRoot,
    modelRef.registry,
    modelRef.namespace,
    modelRef.model,
    modelRef.tag
  );

  if (!fs.existsSync(manifestPath)) {
    fail(`Manifest not found: ${manifestPath}`);
  }

  const manifest = loadManifest(manifestPath);
  const modelLayer = pickModelLayer(manifest.layers);
  if (!modelLayer) {
    fail("Failed to locate model layer in Ollama manifest.");
  }

  const digest = modelLayer.digest;
  const blobFileName = digest.replace(":", "-");
  const blobPath = path.join(blobRoot, blobFileName);
  if (!fs.existsSync(blobPath)) {
    fail(`Model blob not found: ${blobPath}`);
  }

  if (!isGguf(blobPath)) {
    fail([
      `Model blob is not GGUF: ${blobPath}`,
      "This script only exports GGUF blobs already downloaded by Ollama."
    ].join("\n"));
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const targetFileName = options.outputFile.trim() || defaultOutputFileName(modelRef);
  const outputPath = path.join(outputDir, targetFileName);

  if (fs.existsSync(outputPath) && !options.force) {
    fail(`Output already exists: ${outputPath} (use --force to overwrite)`);
  }

  fs.copyFileSync(blobPath, outputPath);
  const copiedBytes = fs.statSync(outputPath).size;

  console.log("GGUF export completed.");
  console.log(`model       : ${options.model.trim()}`);
  console.log(`manifest    : ${manifestPath}`);
  console.log(`blob        : ${blobPath}`);
  console.log(`output      : ${outputPath}`);
  console.log(`size(bytes) : ${copiedBytes}`);
}

function parseModelReference(modelValue) {
  const raw = modelValue.trim();
  if (!raw) {
    fail("Empty model reference");
  }

  let tag = "latest";
  let pathPart = raw;
  const lastColon = raw.lastIndexOf(":");
  const lastSlash = raw.lastIndexOf("/");
  if (lastColon > lastSlash) {
    tag = raw.slice(lastColon + 1);
    pathPart = raw.slice(0, lastColon);
  }

  const segments = pathPart.split("/").filter(Boolean);
  if (segments.length === 0) {
    fail(`Invalid model reference: ${raw}`);
  }

  let registry = "registry.ollama.ai";
  let modelSegments = segments;
  if (looksLikeRegistry(segments[0])) {
    registry = segments[0];
    modelSegments = segments.slice(1);
  }
  if (modelSegments.length === 0) {
    fail(`Invalid model reference: ${raw}`);
  }

  let namespace = "library";
  let model = modelSegments[0];
  if (modelSegments.length > 1) {
    namespace = modelSegments.slice(0, modelSegments.length - 1).join("/");
    model = modelSegments[modelSegments.length - 1];
  }

  return { registry, namespace, model, tag };
}

function looksLikeRegistry(segment) {
  return segment.includes(".") || segment.includes(":") || segment === "localhost";
}

function loadManifest(filePath) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      fail(`Invalid manifest JSON: ${filePath}`);
    }
    return payload;
  } catch (error) {
    fail(`Failed to parse manifest: ${filePath}\n${error.message}`);
  }
}

function pickModelLayer(layers) {
  if (!Array.isArray(layers)) {
    return null;
  }

  const candidates = layers.filter((layer) => {
    return layer
      && typeof layer === "object"
      && typeof layer.digest === "string";
  });
  if (candidates.length === 0) {
    return null;
  }

  const preferred = candidates.find((layer) => {
    return typeof layer.mediaType === "string"
      && layer.mediaType.includes("image.model");
  });
  if (preferred) {
    return preferred;
  }

  const byMediaType = candidates.find((layer) => {
    return typeof layer.mediaType === "string"
      && layer.mediaType.toLowerCase().includes("model");
  });
  if (byMediaType) {
    return byMediaType;
  }

  return candidates.reduce((largest, layer) => {
    const currentSize = Number(layer.size || 0);
    const bestSize = Number(largest.size || 0);
    return currentSize > bestSize ? layer : largest;
  });
}

function isGguf(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, header, 0, 4, 0);
    if (bytesRead < 4) {
      return false;
    }
    return header.toString("ascii") === "GGUF";
  } finally {
    fs.closeSync(fd);
  }
}

function defaultOutputFileName(ref) {
  const base = `${ref.namespace}/${ref.model}:${ref.tag}`;
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe.endsWith(".gguf") ? safe : `${safe}.gguf`;
}

function expandHome(inputPath) {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
