"""Persistent long-term memory: SQLite rows + in-memory vector cache for fast retrieval."""
from __future__ import annotations

import threading
import time
import uuid
from collections import deque
from typing import Any

import numpy as np

from ..database.db import Database
from .embeddings import HASH_KIND, Embedder, hash_embed

CATEGORIES = ("fact", "preference", "event", "person", "relationship", "story", "topic", "joke", "statement", "goal")
_PUBLIC_FIELDS = (
    "id", "text", "category", "importance", "confidence", "created_at", "updated_at",
    "last_accessed", "access_count", "source_conversation", "origin",
)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    out = {k: row.get(k) for k in _PUBLIC_FIELDS}
    out["embedding_kind"] = row.get("embedding_kind")
    out["active"] = bool(row.get("active", 1))
    out["superseded_by"] = row.get("superseded_by")
    return out


def _clamp(value: Any, default: float) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


class MemoryStore:
    def __init__(self, db: Database, embedder: Embedder):
        self.db = db
        self.embedder = embedder
        self._lock = threading.RLock()
        self._ids: list[str] = []
        self._kinds: list[str] = []
        self._matrix: np.ndarray | None = None
        self._cache_ready = False
        self.events: deque[dict[str, Any]] = deque(maxlen=100)

    # ---- vector cache --------------------------------------------------
    def _load_cache(self) -> None:
        rows = self.db.query(
            "SELECT id, embedding, embedding_kind FROM memories WHERE active = 1 AND embedding IS NOT NULL"
        )
        self._vecs: dict[str, tuple[str, np.ndarray]] = {
            r["id"]: (r["embedding_kind"], np.frombuffer(r["embedding"], dtype=np.float32)) for r in rows
        }
        self._matrix = None
        self._cache_ready = True

    def _cache_set(self, mem_id: str, kind: str, vec: np.ndarray) -> None:
        with self._lock:
            if not self._cache_ready:
                self._load_cache()
            self._vecs[mem_id] = (kind, vec.astype(np.float32))
            self._matrix = None

    def _cache_drop(self, mem_id: str) -> None:
        with self._lock:
            if self._cache_ready:
                self._vecs.pop(mem_id, None)
                self._matrix = None

    def _snapshot(self) -> tuple[list[str], list[str], dict[str, np.ndarray]]:
        with self._lock:
            if not self._cache_ready:
                self._load_cache()
            return list(self._vecs), [k for k, _ in self._vecs.values()], {i: v for i, (_, v) in self._vecs.items()}

    def _event(self, action: str, memory: dict[str, Any]) -> None:
        self.events.append({"ts": time.time(), "action": action, "id": memory["id"], "text": memory["text"]})

    # ---- CRUD ----------------------------------------------------------
    def add(
        self,
        text: str,
        category: str = "fact",
        importance: float = 0.5,
        confidence: float = 0.7,
        source_conversation: str | None = None,
        origin: str = "auto",
    ) -> dict[str, Any]:
        text = (text or "").strip()
        if not text:
            raise ValueError("memory text cannot be empty")
        if len(text) > 500:
            raise ValueError("memory text must be at most 500 characters")
        category = category if category in CATEGORIES else "fact"
        kind, vecs = self.embedder.embed([text])
        now = time.time()
        mem_id = uuid.uuid4().hex
        self.db.execute(
            """INSERT INTO memories (id, text, category, importance, confidence, created_at, updated_at,
                                     source_conversation, embedding, embedding_kind, origin)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (mem_id, text, category, _clamp(importance, 0.5), _clamp(confidence, 0.7), now, now,
             source_conversation, vecs[0].tobytes(), kind, origin),
        )
        self._cache_set(mem_id, kind, vecs[0])
        mem = self.get(mem_id)
        self._event("added", mem)  # type: ignore[arg-type]
        return mem  # type: ignore[return-value]

    def get(self, mem_id: str) -> dict[str, Any] | None:
        row = self.db.one("SELECT * FROM memories WHERE id = ?", (mem_id,))
        return _public(row) if row else None

    def update(self, mem_id: str, **fields: Any) -> dict[str, Any] | None:
        current = self.db.one("SELECT * FROM memories WHERE id = ?", (mem_id,))
        if not current:
            return None
        sets: dict[str, Any] = {}
        if "text" in fields and fields["text"] is not None:
            text = str(fields["text"]).strip()
            if not text:
                raise ValueError("memory text cannot be empty")
            if len(text) > 500:
                raise ValueError("memory text must be at most 500 characters")
            if text != current["text"]:
                sets["text"] = text
                kind, vecs = self.embedder.embed([text])
                sets["embedding"] = vecs[0].tobytes()
                sets["embedding_kind"] = kind
        if "category" in fields and fields["category"] is not None:
            sets["category"] = fields["category"] if fields["category"] in CATEGORIES else current["category"]
        if "importance" in fields and fields["importance"] is not None:
            sets["importance"] = _clamp(fields["importance"], current["importance"])
        if "confidence" in fields and fields["confidence"] is not None:
            sets["confidence"] = _clamp(fields["confidence"], current["confidence"])
        if not sets:
            return _public(current)
        sets["updated_at"] = time.time()
        cols = ", ".join(f"{k} = ?" for k in sets)
        self.db.execute(f"UPDATE memories SET {cols} WHERE id = ?", (*sets.values(), mem_id))
        if "embedding" in sets and current["active"]:
            self._cache_set(mem_id, sets["embedding_kind"], np.frombuffer(sets["embedding"], dtype=np.float32))
        mem = self.get(mem_id)
        self._event("updated", mem)  # type: ignore[arg-type]
        return mem

    def delete(self, mem_id: str) -> bool:
        ok = self.db.execute("DELETE FROM memories WHERE id = ?", (mem_id,)).rowcount > 0
        self._cache_drop(mem_id)
        return ok

    def clear(self) -> int:
        n = self.db.execute("DELETE FROM memories").rowcount
        with self._lock:
            self._cache_ready = False
        return n

    def supersede(self, old_id: str, **new_fields: Any) -> dict[str, Any]:
        """Replace an older memory with a newer one; the old row is kept (inactive) for history."""
        new = self.add(**new_fields)
        self.db.execute(
            "UPDATE memories SET active = 0, superseded_by = ?, updated_at = ? WHERE id = ?",
            (new["id"], time.time(), old_id),
        )
        self._cache_drop(old_id)
        self._event("superseded", new)
        return new

    def reinforce(self, mem_id: str, importance: float | None = None) -> dict[str, Any] | None:
        row = self.db.one("SELECT importance FROM memories WHERE id = ?", (mem_id,))
        if not row:
            return None
        imp = max(row["importance"], _clamp(importance, 0.0)) if importance is not None else row["importance"]
        self.db.execute("UPDATE memories SET importance = ?, updated_at = ? WHERE id = ?", (imp, time.time(), mem_id))
        return self.get(mem_id)

    # ---- listing -------------------------------------------------------
    def list(
        self,
        q: str | None = None,
        category: str | None = None,
        include_inactive: bool = False,
        order: str = "updated",
        limit: int = 500,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        where, params = [], []
        if not include_inactive:
            where.append("active = 1")
        if category:
            where.append("category = ?")
            params.append(category)
        if q and q.strip():
            where.append("text LIKE ? ESCAPE '\\'")
            params.append("%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        order_sql = {"updated": "updated_at DESC", "created": "created_at DESC", "importance": "importance DESC, updated_at DESC"}.get(
            order, "updated_at DESC"
        )
        sql = "SELECT * FROM memories" + (" WHERE " + " AND ".join(where) if where else "")
        sql += f" ORDER BY {order_sql} LIMIT ? OFFSET ?"
        return [_public(r) for r in self.db.query(sql, (*params, limit, offset))]

    def count(self, include_inactive: bool = False) -> int:
        row = self.db.one("SELECT COUNT(*) AS n FROM memories" + ("" if include_inactive else " WHERE active = 1"))
        return int(row["n"]) if row else 0

    def active_texts(self) -> list[dict[str, Any]]:
        return [_public(r) for r in self.db.query("SELECT * FROM memories WHERE active = 1")]

    # ---- retrieval -----------------------------------------------------
    def _similarities(self, query: str) -> dict[str, float]:
        """Cosine similarity of the query to every active memory (hash fallback for stale vectors)."""
        ids, kinds, vecs = self._snapshot()
        if not ids:
            return {}
        qkind, qvec = self.embedder.embed([query], is_query=True)
        qv = qvec[0]
        hash_q = qv if qkind == HASH_KIND else hash_embed(query)
        sims: dict[str, float] = {}
        stale: list[str] = []
        for mem_id, kind in zip(ids, kinds):
            if kind == qkind:
                sims[mem_id] = float(np.dot(vecs[mem_id], qv))
            else:
                stale.append(mem_id)
        if stale:
            rows = self.db.query(
                f"SELECT id, text FROM memories WHERE id IN ({','.join('?' * len(stale))})", tuple(stale)
            )
            for r in rows:
                sims[r["id"]] = float(np.dot(hash_embed(r["text"]), hash_q))
        return sims

    def find_similar(self, text: str, top: int = 5, min_similarity: float = 0.0) -> list[dict[str, Any]]:
        sims = self._similarities(text)
        ranked = sorted(sims.items(), key=lambda kv: kv[1], reverse=True)[:top]
        out = []
        for mem_id, sim in ranked:
            if sim >= min_similarity:
                mem = self.get(mem_id)
                if mem:
                    mem["similarity"] = round(sim, 4)
                    out.append(mem)
        return out

    def search(self, query: str, limit: int = 6, min_similarity: float = 0.35, touch: bool = True) -> list[dict[str, Any]]:
        """Rank by semantic similarity, nudged by importance and recency. Core memories always qualify."""
        if limit <= 0 or not query.strip():
            return []
        sims = self._similarities(query)
        if not sims:
            return []
        rows = {r["id"]: r for r in self.db.query(
            f"SELECT * FROM memories WHERE id IN ({','.join('?' * len(sims))})", tuple(sims)
        )}
        now = time.time()
        scored: list[tuple[float, dict[str, Any], float]] = []
        for mem_id, sim in sims.items():
            row = rows.get(mem_id)
            if not row:
                continue
            core = row["importance"] >= 0.9
            if sim < min_similarity and not core:
                continue
            age_days = max(0.0, (now - (row["last_accessed"] or row["updated_at"])) / 86400.0)
            recency = 1.0 / (1.0 + age_days / 30.0)
            score = 0.75 * sim + 0.15 * row["importance"] + 0.10 * recency
            if sim < min_similarity:  # core memory without topical match: rank low, cap below
                score = 0.2 + 0.1 * row["importance"]
            scored.append((score, row, sim))
        scored.sort(key=lambda t: t[0], reverse=True)
        top = scored[:limit]
        results = []
        for score, row, sim in top:
            mem = _public(row)
            mem["score"] = round(score, 4)
            mem["similarity"] = round(sim, 4)
            results.append(mem)
        if touch and results:
            ids = [m["id"] for m in results]
            self.db.execute(
                f"UPDATE memories SET last_accessed = ?, access_count = access_count + 1 "
                f"WHERE id IN ({','.join('?' * len(ids))})",
                (now, *ids),
            )
        return results

    def reindex_stale(self, max_items: int = 200) -> int:
        """Re-embed memories stored in a different vector space than the current embedder uses."""
        kind = self.embedder.kind
        if kind == HASH_KIND:
            return 0
        rows = self.db.query(
            "SELECT id, text FROM memories WHERE active = 1 AND (embedding_kind IS NULL OR embedding_kind != ?) LIMIT ?",
            (kind, max_items),
        )
        done = 0
        for row in rows:
            new_kind, vecs = self.embedder.embed([row["text"]])
            if new_kind != kind:
                break  # embedder fell back mid-way; try again later
            self.db.execute(
                "UPDATE memories SET embedding = ?, embedding_kind = ? WHERE id = ?",
                (vecs[0].tobytes(), new_kind, row["id"]),
            )
            self._cache_set(row["id"], new_kind, vecs[0])
            done += 1
        return done

    def events_since(self, ts: float) -> list[dict[str, Any]]:
        return [e for e in list(self.events) if e["ts"] > ts]
