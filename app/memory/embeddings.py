"""Embeddings: Ollama embedding model when available, deterministic hashing fallback otherwise."""
from __future__ import annotations

import re
import threading
import time
import zlib
from typing import Callable

import numpy as np

from ..ai.ollama_client import OllamaClient, OllamaError

HASH_DIM = 256
HASH_KIND = "hash"

_STOPWORDS = frozenset(
    "a an the and or but if of to in on at for with about around from by is are was were be been being am i me my "
    "you your it its this that these those as so do does did have has had will would can could should just very "
    "really also than then there here what which who whom user users".split()
)
_SYNONYMS = {
    "tonight": "night", "evening": "night", "nights": "night", "midnight": "night",
    "love": "like", "enjoy": "like", "adore": "like", "prefer": "like", "fond": "like", "favorite": "like",
    "hate": "dislike", "despise": "dislike", "detest": "dislike",
    "walk": "walk", "walking": "walk", "stroll": "walk", "wander": "walk",
    "film": "movie", "cinema": "movie",
    "trip": "travel", "visit": "travel", "vacation": "travel", "holiday": "travel",
    "mom": "mother", "mum": "mother", "dad": "father",
}
_TOKEN = re.compile(r"[a-z0-9']+")


def _stem(tok: str) -> str:
    tok = tok.replace("'", "")
    for suffix in ("ing", "ed", "es", "s"):
        if len(tok) > len(suffix) + 2 and tok.endswith(suffix):
            tok = tok[: -len(suffix)]
            break
    return _SYNONYMS.get(tok, tok)


def tokens(text: str) -> list[str]:
    return [_stem(t) for t in _TOKEN.findall(text.lower()) if t not in _STOPWORDS]


def hash_embed(text: str) -> np.ndarray:
    vec = np.zeros(HASH_DIM, dtype=np.float32)
    for tok in tokens(text):
        h = zlib.crc32(tok.encode())
        vec[h % HASH_DIM] += 1.0 if (h >> 16) & 1 else -1.0
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm else vec


def _normalize(rows: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(rows, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (rows / norms).astype(np.float32)


class Embedder:
    """Returns (kind, vectors). `kind` identifies the vector space so vectors are never mixed."""

    RETRY_AFTER = 60.0

    def __init__(self, client: OllamaClient, settings_getter: Callable[[], dict]):
        self.client = client
        self._settings = settings_getter
        self._fail_until = 0.0
        self._lock = threading.Lock()
        self.last_error: str | None = None

    def _ollama_model(self) -> str | None:
        cfg = self._settings()
        if not cfg.get("use_ollama_embeddings"):
            return None
        return cfg.get("embedding_model") or None

    @property
    def kind(self) -> str:
        model = self._ollama_model()
        if model and time.time() >= self._fail_until:
            return f"ollama:{model}"
        return HASH_KIND

    def embed(self, texts: list[str], is_query: bool = False) -> tuple[str, np.ndarray]:
        model = self._ollama_model()
        if model and time.time() >= self._fail_until:
            try:
                prefix = ""
                if "nomic" in model.lower():
                    prefix = "search_query: " if is_query else "search_document: "
                raw = self.client.embed(model, [prefix + t for t in texts])
                self.last_error = None
                return f"ollama:{model}", _normalize(np.asarray(raw, dtype=np.float32))
            except OllamaError as exc:
                self.last_error = str(exc)
                with self._lock:
                    self._fail_until = time.time() + self.RETRY_AFTER
        return HASH_KIND, np.stack([hash_embed(t) for t in texts]) if texts else np.zeros((0, HASH_DIM), np.float32)
