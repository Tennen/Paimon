import fs from "fs";
import path from "path";

export class MemoryStore {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.resolve(process.cwd(), "data", "memory");
  }

  read(sessionId: string): string {
    const filePath = this.getPath(sessionId);
    if (!fs.existsSync(filePath)) {
      return "";
    }
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }

  append(sessionId: string, entry: string): void {
    const filePath = this.getPath(sessionId);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(filePath, entry + "\n", "utf-8");
  }

  private getPath(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.baseDir, safe, "MEMORY.md");
  }
}
