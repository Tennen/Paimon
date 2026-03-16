#!/usr/bin/env python3
"""Build SQLite metadata index from writing-organizer knowledge artifacts."""

from __future__ import annotations

import argparse
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class Stats:
    topics: int = 0
    materials: int = 0
    insights: int = 0
    documents: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Scan data/writing/topics/*/knowledge artifacts and rebuild a SQLite metadata index."
        )
    )
    parser.add_argument(
        "--topics-root",
        default="data/writing/topics",
        help="Root path of writing topics (default: data/writing/topics)",
    )
    parser.add_argument(
        "--db",
        default="data/writing/index/metadata.sqlite",
        help="Output SQLite path (default: data/writing/index/metadata.sqlite)",
    )
    parser.add_argument(
        "--skip-fts",
        action="store_true",
        help="Skip building FTS indexes",
    )
    return parser.parse_args()


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS materials (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL,
          type TEXT,
          source TEXT,
          input_mode TEXT,
          raw_text TEXT,
          clean_text TEXT,
          metadata_json TEXT,
          created_at TEXT,
          file_path TEXT
        );

        CREATE TABLE IF NOT EXISTS insights (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL,
          material_ids_json TEXT,
          summary TEXT,
          key_points_json TEXT,
          tags_json TEXT,
          entities_json TEXT,
          quality_score REAL,
          created_at TEXT,
          file_path TEXT
        );

        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL,
          material_ids_json TEXT,
          insight_id TEXT,
          mode TEXT,
          title TEXT,
          path TEXT,
          version INTEGER,
          created_at TEXT,
          metadata_path TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_materials_topic_created_at
          ON materials(topic_id, created_at);

        CREATE INDEX IF NOT EXISTS idx_insights_topic_created_at
          ON insights(topic_id, created_at);

        CREATE INDEX IF NOT EXISTS idx_documents_topic_created_at
          ON documents(topic_id, created_at);
        """
    )


def clear_tables(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM materials")
    conn.execute("DELETE FROM insights")
    conn.execute("DELETE FROM documents")


def clear_fts_tables(conn: sqlite3.Connection) -> None:
    conn.execute("DROP TABLE IF EXISTS materials_fts")
    conn.execute("DROP TABLE IF EXISTS documents_fts")


def ensure_fts_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS materials_fts
        USING fts5(id, topic_id, clean_text, raw_text, tokenize='unicode61');

        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts
        USING fts5(id, topic_id, title, content, path, tokenize='unicode61');
        """
    )


def as_dict(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def load_json(file_path: Path) -> dict[str, Any] | None:
    try:
        raw = file_path.read_text(encoding="utf-8").strip()
    except OSError:
        return None

    if not raw:
        return None

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None

    return as_dict(parsed)


def to_json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def to_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def to_int(value: Any, fallback: int = 1) -> int:
    try:
        parsed = int(value)
        return parsed if parsed >= 1 else fallback
    except (TypeError, ValueError):
        return fallback


def scan_topics(topics_root: Path) -> list[Path]:
    if not topics_root.exists():
        return []
    return sorted(path for path in topics_root.iterdir() if path.is_dir())


def insert_materials(
    conn: sqlite3.Connection,
    topic_id: str,
    topic_dir: Path,
    with_fts: bool,
) -> int:
    materials_dir = topic_dir / "knowledge" / "materials"
    if not materials_dir.exists():
        return 0

    count = 0
    for file_path in sorted(materials_dir.rglob("*.json")):
        if file_path.name.endswith(".meta.json"):
            continue

        data = load_json(file_path)
        if not data:
            continue

        material_id = normalize_text(data.get("id"))
        if not material_id:
            continue

        raw_text = normalize_text(data.get("raw_text"))
        clean_text = normalize_text(data.get("clean_text")) or raw_text
        metadata_json = to_json_text(as_dict(data.get("metadata")) or {})

        conn.execute(
            """
            INSERT OR REPLACE INTO materials (
              id, topic_id, type, source, input_mode, raw_text, clean_text,
              metadata_json, created_at, file_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                material_id,
                topic_id,
                normalize_text(data.get("type")),
                normalize_text(data.get("source")),
                normalize_text(data.get("input_mode")),
                raw_text,
                clean_text,
                metadata_json,
                normalize_text(data.get("created_at")),
                str(file_path),
            ),
        )

        if with_fts:
            conn.execute(
                "INSERT INTO materials_fts(id, topic_id, clean_text, raw_text) VALUES (?, ?, ?, ?)",
                (material_id, topic_id, clean_text, raw_text),
            )

        count += 1

    return count


def insert_insights(conn: sqlite3.Connection, topic_id: str, topic_dir: Path) -> int:
    insights_dir = topic_dir / "knowledge" / "insights"
    if not insights_dir.exists():
        return 0

    count = 0
    for file_path in sorted(insights_dir.rglob("*.json")):
        data = load_json(file_path)
        if not data:
            continue

        insight_id = normalize_text(data.get("id"))
        if not insight_id:
            continue

        material_ids = [normalize_text(item) for item in as_list(data.get("material_ids")) if normalize_text(item)]
        key_points = [normalize_text(item) for item in as_list(data.get("key_points")) if normalize_text(item)]
        tags = [normalize_text(item) for item in as_list(data.get("tags")) if normalize_text(item)]
        entities = [normalize_text(item) for item in as_list(data.get("entities")) if normalize_text(item)]

        conn.execute(
            """
            INSERT OR REPLACE INTO insights (
              id, topic_id, material_ids_json, summary, key_points_json,
              tags_json, entities_json, quality_score, created_at, file_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                insight_id,
                topic_id,
                to_json_text(material_ids),
                normalize_text(data.get("summary")),
                to_json_text(key_points),
                to_json_text(tags),
                to_json_text(entities),
                to_float(data.get("quality_score"), fallback=0.0),
                normalize_text(data.get("created_at")),
                str(file_path),
            ),
        )

        count += 1

    return count


def read_document_markdown(topic_dir: Path, relative_path: str) -> str:
    if not relative_path:
        return ""

    markdown_path = topic_dir / relative_path
    if not markdown_path.exists() or not markdown_path.is_file():
        return ""

    try:
        return markdown_path.read_text(encoding="utf-8")
    except OSError:
        return ""


def insert_documents(
    conn: sqlite3.Connection,
    topic_id: str,
    topic_dir: Path,
    with_fts: bool,
) -> int:
    documents_dir = topic_dir / "knowledge" / "documents"
    if not documents_dir.exists():
        return 0

    count = 0
    for file_path in sorted(documents_dir.rglob("*.meta.json")):
        data = load_json(file_path)
        if not data:
            continue

        document_id = normalize_text(data.get("id"))
        if not document_id:
            continue

        material_ids = [normalize_text(item) for item in as_list(data.get("material_ids")) if normalize_text(item)]
        relative_doc_path = normalize_text(data.get("path"))

        conn.execute(
            """
            INSERT OR REPLACE INTO documents (
              id, topic_id, material_ids_json, insight_id, mode, title,
              path, version, created_at, metadata_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                document_id,
                topic_id,
                to_json_text(material_ids),
                normalize_text(data.get("insight_id")),
                normalize_text(data.get("mode")),
                normalize_text(data.get("title")),
                relative_doc_path,
                to_int(data.get("version"), fallback=1),
                normalize_text(data.get("created_at")),
                str(file_path),
            ),
        )

        if with_fts:
            markdown = read_document_markdown(topic_dir, relative_doc_path)
            conn.execute(
                "INSERT INTO documents_fts(id, topic_id, title, content, path) VALUES (?, ?, ?, ?, ?)",
                (
                    document_id,
                    topic_id,
                    normalize_text(data.get("title")),
                    markdown,
                    relative_doc_path,
                ),
            )

        count += 1

    return count


def rebuild_index(topics_root: Path, db_path: Path, skip_fts: bool) -> Stats:
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    try:
        ensure_schema(conn)
        clear_tables(conn)

        with_fts = not skip_fts
        if with_fts:
            clear_fts_tables(conn)
            try:
                ensure_fts_schema(conn)
            except sqlite3.OperationalError as exc:
                with_fts = False
                print(f"[warn] FTS unavailable, continue without FTS: {exc}")

        stats = Stats()

        for topic_dir in scan_topics(topics_root):
            topic_id = topic_dir.name
            stats.topics += 1
            stats.materials += insert_materials(conn, topic_id, topic_dir, with_fts)
            stats.insights += insert_insights(conn, topic_id, topic_dir)
            stats.documents += insert_documents(conn, topic_id, topic_dir, with_fts)

        conn.commit()
        return stats
    finally:
        conn.close()


def main() -> int:
    args = parse_args()
    topics_root = Path(args.topics_root)
    db_path = Path(args.db)

    stats = rebuild_index(topics_root, db_path, skip_fts=args.skip_fts)
    print("SQLite metadata index rebuilt")
    print(f"- topics: {stats.topics}")
    print(f"- materials: {stats.materials}")
    print(f"- insights: {stats.insights}")
    print(f"- documents: {stats.documents}")
    print(f"- db: {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
