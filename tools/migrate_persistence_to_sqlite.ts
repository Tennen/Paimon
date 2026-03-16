#!/usr/bin/env node
import {
  DATA_STORE,
  DataStoreName,
  getStorageDriver,
  getStorageSqlitePath,
  listStoreDefinitions,
  migrateJsonStoresToSqlite
} from "../src/storage/persistence";

type CliOptions = {
  dbPath?: string;
  storeNames?: DataStoreName[];
  listOnly: boolean;
  strict: boolean;
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  if (options.listOnly) {
    printStoreDefinitions();
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

  const strictFailures = skipped.filter((item) => item.reason !== "source file not found");
  if (options.strict && strictFailures.length > 0) {
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
    "  --strict         Exit with non-zero code when migration hits non-missing-file skips (e.g. invalid json)",
    "  --list           Print all store definitions and exit"
  ].join("\n"));
}

main();
