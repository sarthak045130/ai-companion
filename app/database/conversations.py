"""Conversation and message persistence."""

from __future__ import annotations

import re
import json
import time
import uuid
from typing import Any

from .db import Database


def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


class ConversationStore:

    def __init__(self, db: Database):
        self.db = db

    # ---- conversations -------------------------------------------------

    def create(self, title: str = "New chat") -> dict[str, Any]:
        now = time.time()
        conv_id = uuid.uuid4().hex
        self.db.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (conv_id, (title or "New chat").strip()[:120], now, now),
        )
        return self.get(conv_id)  # type: ignore[return-value]

    def get(self, conv_id: str) -> dict[str, Any] | None:
        return self.db.one("SELECT * FROM conversations WHERE id = ?", (conv_id,))

    def list(self, q: str | None = None, limit: int = 500) -> list[dict[str, Any]]:
        if q and q.strip():
            pattern = _like(q.strip())
            return self.db.query(
                """
                SELECT c.* FROM conversations c
                WHERE c.title LIKE ? ESCAPE '\\'
                   OR EXISTS (
                       SELECT 1
                       FROM messages m
                       WHERE m.conversation_id = c.id
                         AND m.content LIKE ? ESCAPE '\\'
                   )
                ORDER BY c.updated_at DESC
                LIMIT ?
                """,
                (pattern, pattern, limit),
            )

        return self.db.query(
            "SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        )

    def rename(self, conv_id: str, title: str) -> dict[str, Any] | None:
        title = (title or "").strip()
        if not title:
            raise ValueError("title cannot be empty")

        self.db.execute(
            "UPDATE conversations SET title = ? WHERE id = ?",
            (title[:120], conv_id),
        )
        return self.get(conv_id)

    def delete(self, conv_id: str) -> bool:
        return (
            self.db.execute(
                "DELETE FROM conversations WHERE id = ?",
                (conv_id,),
            ).rowcount
            > 0
        )

    def most_recent(self) -> dict[str, Any] | None:
        return self.db.one(
            "SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 1"
        )

    # ---- messages ------------------------------------------------------

    def add_message(
        self,
        conv_id: str,
        role: str,
        content: str,
        meta: dict | None = None,
    ) -> dict[str, Any]:
        now = time.time()

        with self.db.transaction():
            res = self.db.execute(
                """
                INSERT INTO messages
                    (conversation_id, role, content, created_at, meta)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    conv_id,
                    role,
                    content,
                    now,
                    json.dumps(meta or {}),
                ),
            )

            self.db.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (now, conv_id),
            )

        return self._message(
            self.db.one(
                "SELECT * FROM messages WHERE id = ?",
                (res.lastrowid,),
            )
        )  # type: ignore[arg-type]

    @staticmethod
    def _message(row: dict[str, Any]) -> dict[str, Any]:
        row = dict(row)

        try:
            row["meta"] = json.loads(row.get("meta") or "{}")
        except ValueError:
            row["meta"] = {}

        return row

    def messages(
        self,
        conv_id: str,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """All messages oldest-first, or the newest `limit` messages."""
        if limit:
            rows = self.db.query(
                """
                SELECT *
                FROM messages
                WHERE conversation_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (conv_id, limit),
            )
            rows.reverse()
        else:
            rows = self.db.query(
                """
                SELECT *
                FROM messages
                WHERE conversation_id = ?
                ORDER BY id
                """,
                (conv_id,),
            )

        return [self._message(r) for r in rows]

    def search_messages(
        self,
        conv_id: str,
        query: str,
        limit: int = 6,
    ) -> list[dict[str, Any]]:
        """
        Find older messages in one conversation that contain relevant
        words from the current query.

        This is intentionally lightweight and local. It does not use
        embeddings; it provides a fallback/context bridge for messages
        that have fallen outside the recent-history window.
        """
        query = (query or "").strip()

        if not query:
            return []

        # Keep meaningful words and ignore common conversational filler.
        words = [
            word.lower()
            for word in re.findall(r"[A-Za-z0-9']+", query)
            if len(word) >= 3
        ]

        stopwords = {
            "the",
            "and",
            "that",
            "this",
            "what",
            "with",
            "about",
            "have",
            "from",
            "were",
            "your",
            "you",
            "are",
            "was",
            "for",
            "did",
            "does",
            "would",
            "could",
            "should",
            "just",
            "like",
            "then",
            "they",
            "them",
            "there",
            "here",
            "earlier",
            "before",
            "again",
        }

        words = list(dict.fromkeys(w for w in words if w not in stopwords))

        if not words:
            return []

        conditions = []
        params: list[Any] = [conv_id]

        for word in words[:10]:
            conditions.append("LOWER(content) LIKE ? ESCAPE '\\'")
            params.append(_like(word.lower()))

        sql = f"""
            SELECT *
            FROM messages
            WHERE conversation_id = ?
              AND role IN ('user', 'assistant')
              AND ({' OR '.join(conditions)})
            ORDER BY id DESC
            LIMIT ?
        """

        params.append(max(1, min(limit, 20)))

        rows = self.db.query(sql, tuple(params))
        rows.reverse()

        return [self._message(r) for r in rows]

    def message_count(self, conv_id: str) -> int:
        row = self.db.one(
            "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?",
            (conv_id,),
        )
        return int(row["n"]) if row else 0