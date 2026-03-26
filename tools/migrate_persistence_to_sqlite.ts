#!/usr/bin/env node
import fs from "fs";
import path from "path";
import {
  DATA_STORE,
  DataStoreName,
  getStorageDriver,
  getStorageSqlitePath,
  listStoreDefinitions,
  migrateJsonStoresToSqlite,
  resolveDataPath
} from "../src/storage/persistence";

type CliOptions = {
  dbPath?: string;
  storeNames?: DataStoreName[];
  listOnly: boolean;
  strict: boolean;
};

type DirectPersistenceArea = {
  id: string;
  kind: "state" | "artifact" | "cache";
  path: string;
  description: string;
  coveredByStoreMigration: boolean;
  note?: string;
  matcher?: (relativePath: string, entryType: "file" | "dir") => boolean;
};

type DirectPersistenceInspection = DirectPersistenceArea & {
  exists: boolean;
  fileCount: number;
  dirCount: number;
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (options.listOnly) {
    printStoreDefinitions();
    printDirectPersistenceCoverage();
    return;
  }

  const report = migrateJsonStoresToSqlite({
    ...(options.dbPath ? { dbPath: options.dbPath } : {}),
    ...(options.storeNames && options.storeNames.length > 0 ? { storeNames: options.storeNames } : {})
  });

  const migrated = report.stores.filter((item) => item.status === "migrated");
  const skipped = report.stores.filter((item) => item.status === "skipped");

  console.log("Persistence migration finished");
  console.log(`- runtime storage driver: ${getStorageDriver()}`);
  console.log(`- sqlite db: ${report.dbPath || getStorageSqlitePath()}`);
  console.log(`- migrated: ${report.migrated}`);
  console.log(`- skipped: ${report.skipped}`);

  for (const item of migrated) {
    console.log(`  [migrated] ${item.name} (${item.codec}) <- ${item.filePath}`);
  }

  for (const item of skipped) {
    console.log(`  [skipped] ${item.name} (${item.codec}) <- ${item.filePath} | ${item.reason ?? "unknown"}`);
  }

  printDirectPersistenceCoverage();

  const strictFailures = skipped.filter((item) => item.reason !== "source file not found");
  const uncoveredState = inspectDirectPersistenceAreas()
    .filter((item) => item.kind === "state" && item.exists && !item.coveredByStoreMigration);
  if (options.strict && (strictFailures.length > 0 || uncoveredState.length > 0)) {
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    listOnly: false,
    strict: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }

    if (token === "--list") {
      options.listOnly = true;
      continue;
    }

    if (token === "--strict") {
      options.strict = true;
      continue;
    }

    if (token === "--db") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--db requires a value");
      }
      options.dbPath = value;
      index += 1;
      continue;
    }

    if (token === "--stores") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--stores requires a comma-separated value");
      }
      options.storeNames = parseStoreNames(value);
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${token}`);
  }

  return options;
}

function parseStoreNames(raw: string): DataStoreName[] {
  const known = new Set(Object.values(DATA_STORE));
  const selected: DataStoreName[] = [];

  for (const token of raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0)) {
    if (!known.has(token as DataStoreName)) {
      throw new Error(`unknown store name: ${token}`);
    }
    selected.push(token as DataStoreName);
  }

  return selected;
}

function printStoreDefinitions(): void {
  console.log("Registered persistence stores");
  for (const definition of listStoreDefinitions()) {
    console.log(`- ${definition.name} | codec=${definition.codec} | file=${definition.filePath}`);
  }
}

function printDirectPersistenceCoverage(): void {
  const inspected = inspectDirectPersistenceAreas();
  const stateAreas = inspected.filter((item) => item.kind === "state");
  const artifactAreas = inspected.filter((item) => item.kind === "artifact");
  const cacheAreas = inspected.filter((item) => item.kind === "cache");

  console.log("");
  console.log("Filesystem persistence outside DATA_STORE store migration");

  if (inspected.length === 0) {
    console.log("- none");
    return;
  }

  for (const item of inspected) {
    const presence = item.exists
      ? `exists=yes files=${item.fileCount} dirs=${item.dirCount}`
      : "exists=no";
    console.log(
      `- ${item.id} | kind=${item.kind} | covered=${item.coveredByStoreMigration ? "yes" : "no"} | ${presence} | path=${item.path}`
    );
    console.log(`  description: ${item.description}`);
    if (item.note) {
      console.log(`  note: ${item.note}`);
    }
  }

  const uncoveredState = stateAreas.filter((item) => item.exists && !item.coveredByStoreMigration);
  const existingArtifacts = artifactAreas.filter((item) => item.exists);
  const existingCaches = cacheAreas.filter((item) => item.exists);

  console.log("");
  console.log("Coverage summary");
  console.log(`- registered DATA_STORE stores: ${listStoreDefinitions().length}`);
  console.log(`- uncovered direct state areas: ${uncoveredState.length}`);
  console.log(`- direct artifact areas: ${existingArtifacts.length}`);
  console.log(`- direct cache areas: ${existingCaches.length}`);

  if (uncoveredState.length > 0) {
    console.log("- result: sqlite migration is not a full persistence cutover yet");
  } else {
    console.log("- result: no extra direct state areas detected outside DATA_STORE");
  }
}

function inspectDirectPersistenceAreas(): DirectPersistenceInspection[] {
  return listDirectPersistenceAreas().map((item) => {
    const counts = countTreeWithMatcher(item.path, item.matcher);
    return {
      ...item,
      exists: counts.exists,
      fileCount: counts.fileCount,
      dirCount: counts.dirCount
    };
  });
}

function listDirectPersistenceAreas(): DirectPersistenceArea[] {
  return [
    {
      id: "writing-organizer.topics",
      kind: "state",
      path: resolveDataPath("writing", "topics"),
      description: "Writing organizer topic meta/raw/state/backup files.",
      coveredByStoreMigration: false,
      note: "These are the core topic and append-state files. If you want full sqlite persistence for intermediate writing state, this block must move.",
      matcher: (relativePath, entryType) => {
        if (entryType !== "file") {
          return false;
        }
        return /(^|\/)meta\.json$/i.test(relativePath)
          || /(^|\/)raw\/[^/]+\.md$/i.test(relativePath)
          || /(^|\/)state\/(summary|outline|draft)\.md$/i.test(relativePath)
          || /(^|\/)backup\/(summary\.prev|outline\.prev|draft\.prev)\.md$/i.test(relativePath);
      }
    },
    {
      id: "writing-organizer.materials",
      kind: "state",
      path: resolveDataPath("writing", "topics"),
      description: "Writing organizer material records persisted after each append.",
      coveredByStoreMigration: false,
      note: "These JSON files include per-append raw_text/clean_text and are intermediate knowledge inputs rather than final markdown output.",
      matcher: (relativePath, entryType) => entryType === "file" && /(^|\/)knowledge\/materials\/.+\.json$/i.test(relativePath)
    },
    {
      id: "writing-organizer.insights",
      kind: "state",
      path: resolveDataPath("writing", "topics"),
      description: "Writing organizer derived insight JSON records.",
      coveredByStoreMigration: false,
      note: "These are intermediate structured results used to build final documents.",
      matcher: (relativePath, entryType) => entryType === "file" && /(^|\/)knowledge\/insights\/.+\.json$/i.test(relativePath)
    },
    {
      id: "writing-organizer.document-meta",
      kind: "state",
      path: resolveDataPath("writing", "topics"),
      description: "Writing organizer document metadata JSON files.",
      coveredByStoreMigration: false,
      note: "The markdown document body can stay on disk, but the metadata is still intermediate/runtime state.",
      matcher: (relativePath, entryType) => entryType === "file" && /(^|\/)knowledge\/documents\/.+\.meta\.json$/i.test(relativePath)
    },
    {
      id: "writing-organizer.document-markdown",
      kind: "artifact",
      path: resolveDataPath("writing", "topics"),
      description: "Writing organizer final markdown document outputs.",
      coveredByStoreMigration: false,
      note: "Per your rule, these can remain filesystem artifacts.",
      matcher: (relativePath, entryType) => {
        if (entryType !== "file") {
          return false;
        }
        return /(^|\/)knowledge\/documents\/.+\.md$/i.test(relativePath)
          && !/\.meta\.json$/i.test(relativePath);
      }
    },
    {
      id: "codex.markdown-reports",
      kind: "artifact",
      path: resolveDataPath("codex", "markdown-reports"),
      description: "Codex markdown report input/output artifacts.",
      coveredByStoreMigration: false,
      note: "Generated artifacts, not DATA_STORE-backed runtime state."
    },
    {
      id: "market-analysis.llm-reports",
      kind: "artifact",
      path: resolveDataPath("market-analysis", "llm-reports"),
      description: "Generated market analysis LLM reports.",
      coveredByStoreMigration: false,
      note: "Generated artifacts, not DATA_STORE-backed runtime state."
    },
    {
      id: "evolution.codex-output",
      kind: "artifact",
      path: resolveDataPath("evolution", "codex"),
      description: "Evolution operator Codex run outputs.",
      coveredByStoreMigration: false,
      note: "Execution artifacts, not DATA_STORE-backed runtime state."
    },
    {
      id: "llm.codex-output",
      kind: "artifact",
      path: resolveDataPath("llm", "codex"),
      description: "Per-request Codex LLM output files.",
      coveredByStoreMigration: false,
      note: "Execution artifacts, not DATA_STORE-backed runtime state."
    },
    {
      id: "wecom.audio-cache",
      kind: "cache",
      path: resolveWecomAudioDir(),
      description: "Downloaded WeCom voice files used as STT input.",
      coveredByStoreMigration: false,
      note: "This is input media cache rather than business state. It is still file-backed, but it does not look like the kind of intermediate structured state you want to move first."
    }
  ];
}

function countTreeWithMatcher(
  targetPath: string,
  matcher?: (relativePath: string, entryType: "file" | "dir") => boolean
): { exists: boolean; fileCount: number; dirCount: number } {
  if (!fs.existsSync(targetPath)) {
    return { exists: false, fileCount: 0, dirCount: 0 };
  }

  const stats = fs.statSync(targetPath);
  if (!stats.isDirectory()) {
    if (!matcher) {
      return { exists: true, fileCount: 1, dirCount: 0 };
    }
    const matched = matcher(path.basename(targetPath), "file");
    return { exists: matched, fileCount: matched ? 1 : 0, dirCount: 0 };
  }

  let fileCount = 0;
  let dirCount = 0;
  const pending = [targetPath];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const relativePath = normalizeRelativePath(targetPath, entryPath);
      if (entry.isDirectory()) {
        if (!matcher || matcher(relativePath, "dir")) {
          dirCount += 1;
        }
        pending.push(entryPath);
        continue;
      }
      if (entry.isFile()) {
        if (!matcher || matcher(relativePath, "file")) {
          fileCount += 1;
        }
      }
    }
  }

  return { exists: fileCount > 0 || (!matcher && fs.existsSync(targetPath)), fileCount, dirCount };
}

function normalizeRelativePath(rootPath: string, entryPath: string): string {
  return path.relative(rootPath, entryPath).replace(/\\/g, "/");
}

function resolveWecomAudioDir(): string {
  const raw = String(process.env.WECOM_AUDIO_DIR ?? "").trim();
  if (!raw) {
    return path.resolve(process.cwd(), "data", "wecom-audio");
  }
  return path.isAbsolute(raw)
    ? raw
    : path.resolve(process.cwd(), raw);
}

function printHelp(): void {
  console.log([
    "migrate_persistence_to_sqlite.ts",
    "",
    "Usage:",
    "  npx tsx tools/migrate_persistence_to_sqlite.ts [--db <path>] [--stores a,b] [--strict]",
    "  npx tsx tools/migrate_persistence_to_sqlite.ts --list",
    "",
    "Options:",
    "  --db <path>      SQLite db path (default follows STORAGE_SQLITE_PATH or data/storage/metadata.sqlite)",
    "  --stores <list>  Comma-separated DATA_STORE keys, e.g. memory.raw,memory.summary",
    "  --strict         Exit with non-zero code when migration hits non-missing-file skips or detects direct file-backed state outside DATA_STORE",
    "  --list           Print store definitions plus direct filesystem persistence coverage and exit"
  ].join("\n"));
}

main();
