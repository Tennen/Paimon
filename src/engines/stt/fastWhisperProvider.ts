import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { STTInput, STTProvider } from "./types";

type FastWhisperResult = {
  text?: string;
  language?: string;
};

type ProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type FastWhisperProviderConfig = {
  pythonBin: string;
  scriptPath: string;
  model: string;
  device: string;
  computeType: string;
  language?: string;
  beamSize: number;
  vadFilter: boolean;
  timeoutMs: number;
  autoInstall: boolean;
};

type PythonDependencyCheck = {
  module: string;
  pipPackage: string;
};

export class FastWhisperSTTProvider implements STTProvider {
  readonly name = "fast-whisper";
  private readonly config: FastWhisperProviderConfig;

  constructor(config?: Partial<FastWhisperProviderConfig>) {
    this.config = {
      pythonBin: config?.pythonBin ?? process.env.STT_FAST_WHISPER_PYTHON ?? "python3",
      scriptPath:
        config?.scriptPath ??
        process.env.STT_FAST_WHISPER_SCRIPT ??
        path.resolve(process.cwd(), "tools", "fast-whisper-transcribe.py"),
      model: config?.model ?? process.env.STT_FAST_WHISPER_MODEL ?? "small",
      device: config?.device ?? process.env.STT_FAST_WHISPER_DEVICE ?? "auto",
      computeType: config?.computeType ?? process.env.STT_FAST_WHISPER_COMPUTE_TYPE ?? "int8",
      language: config?.language ?? process.env.STT_FAST_WHISPER_LANGUAGE,
      beamSize: config?.beamSize ?? parseInteger(process.env.STT_FAST_WHISPER_BEAM_SIZE, 1),
      vadFilter: config?.vadFilter ?? parseBoolean(process.env.STT_FAST_WHISPER_VAD_FILTER, true),
      timeoutMs: config?.timeoutMs ?? parseInteger(process.env.STT_FAST_WHISPER_TIMEOUT_MS, 180000),
      autoInstall: config?.autoInstall ?? parseBoolean(process.env.STT_FAST_WHISPER_AUTO_INSTALL, true)
    };
  }

  async ensureReady(): Promise<void> {
    await fs.access(this.config.scriptPath);

    if (!this.config.autoInstall) {
      return;
    }

    const dependencyChecks = getPythonDependencyChecks(process.env);
    const missingPackages = await this.getMissingPythonPackages(dependencyChecks);
    if (missingPackages.length === 0) {
      return;
    }

    console.log(`[stt] installing missing python deps: ${missingPackages.join(", ")}`);
    const install = await this.runPython(
      ["-m", "pip", "install", "--disable-pip-version-check", ...missingPackages],
      300000
    );

    if (install.code !== 0) {
      const detail = (install.stderr || install.stdout).trim();
      throw new Error(`failed to install python deps: ${detail || "unknown error"}`);
    }
  }

  async transcribe(input: STTInput): Promise<string> {
    const audioPath = input.audioPath;
    if (!audioPath) {
      return "";
    }

    await fs.access(audioPath);

    const args = [
      this.config.scriptPath,
      "--audio",
      audioPath,
      "--model",
      this.config.model,
      "--device",
      this.config.device,
      "--compute-type",
      this.config.computeType,
      "--beam-size",
      String(this.config.beamSize),
      "--vad-filter",
      this.config.vadFilter ? "true" : "false"
    ];

    if (this.config.language && this.config.language.trim().length > 0) {
      args.push("--language", this.config.language.trim());
    }

    const result = await this.runPython(args, this.config.timeoutMs);
    if (result.code !== 0) {
      throw new Error((result.stderr || result.stdout || "fast-whisper execution failed").trim());
    }

    const output = result.stdout.trim();
    if (!output) {
      return "";
    }

    const lastLine = output.split(/\r?\n/).filter((line) => line.trim().length > 0).pop();
    if (!lastLine) {
      return "";
    }

    let parsed: FastWhisperResult;
    try {
      parsed = JSON.parse(lastLine) as FastWhisperResult;
    } catch {
      throw new Error(`invalid fast-whisper output: ${lastLine}`);
    }

    return (parsed.text ?? "").trim();
  }

  private async getMissingPythonPackages(checks: PythonDependencyCheck[]): Promise<string[]> {
    const packages = new Set<string>();

    for (const check of checks) {
      const importCheck = await this.runPython(["-c", `import ${check.module}`], 10000);
      if (importCheck.code !== 0) {
        packages.add(check.pipPackage);
      }
    }

    return Array.from(packages);
  }

  private runPython(args: string[], timeoutMs: number): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(this.config.pythonBin, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let killedByTimeout = false;

      const timer = setTimeout(() => {
        killedByTimeout = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (killedByTimeout) {
          reject(new Error(`python process timed out after ${timeoutMs}ms`));
          return;
        }
        resolve({
          code: code ?? 1,
          stdout,
          stderr
        });
      });
    });
  }
}

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  if (!input) {
    return fallback;
  }

  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseInteger(input: string | undefined, fallback: number): number {
  if (!input) {
    return fallback;
  }
  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function getPythonDependencyChecks(env: Record<string, string | undefined>): PythonDependencyCheck[] {
  const checks: PythonDependencyCheck[] = [
    { module: "faster_whisper", pipPackage: "faster-whisper" }
  ];

  if (hasSocksProxy(env)) {
    checks.push({ module: "socksio", pipPackage: "httpx[socks]" });
  }

  return checks;
}

function hasSocksProxy(env: Record<string, string | undefined>): boolean {
  const proxyKeys = [
    "ALL_PROXY",
    "all_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy"
  ];
  const socksProtocols = ["socks://", "socks4://", "socks4a://", "socks5://", "socks5h://"];

  for (const key of proxyKeys) {
    const value = env[key]?.trim().toLowerCase();
    if (!value) {
      continue;
    }
    if (socksProtocols.some((protocol) => value.startsWith(protocol))) {
      return true;
    }
  }

  return false;
}
