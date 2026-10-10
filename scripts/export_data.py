#!/usr/bin/env python3
"""Exports your conversations and memories as readable JSON files (a plain-text backup).

Writes data/conversations/<title>-<id>.json and data/memories/memories.json.
Usage: python scripts/export_data.py [--data-dir PATH]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import ROOT  # noqa: E402
from app.database.conversations import ConversationStore  # noqa: E402
from app.database.db import Database  # noqa: E402
from app.memory.store import MemoryStore  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=str(ROOT / "data"))
    args = parser.parse_args()
    data = Path(args.data_dir)
    db_path = data / "database" / "companion.db"
    if not db_path.exists():
        raise SystemExit(f"No database at {db_path}")
    db = Database(db_path)
    convs = ConversationStore(db)
    (data / "conversations").mkdir(parents=True, exist_ok=True)
    (data / "memories").mkdir(parents=True, exist_ok=True)
    for c in convs.list(limit=100000):
        slug = re.sub(r"[^a-z0-9]+", "-", c["title"].lower()).strip("-")[:40] or "chat"
        out = data / "conversations" / f"{slug}-{c['id'][:8]}.json"
        out.write_text(json.dumps({**c, "messages": convs.messages(c["id"])}, indent=2, ensure_ascii=False), encoding="utf-8")
    rows = db.query("SELECT id, text, category, importance, confidence, created_at, updated_at, active, superseded_by, origin FROM memories ORDER BY created_at")
    (data / "memories" / "memories.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Exported {len(convs.list(limit=100000))} conversations and {len(rows)} memories into {data}")
    db.close()


if __name__ == "__main__":
    main()
