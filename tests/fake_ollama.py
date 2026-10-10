"""A tiny stand-in for the Ollama HTTP API, used only by tests. NOT part of the shipped app."""
from __future__ import annotations

import json
import re
import threading
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

import numpy as np

# Concept buckets so "tonight" ~ "night", "walking" ~ "walk" etc. (stands in for a real embedding model)
CONCEPTS = {
    "night": {"night", "tonight", "evening", "midnight", "late"},
    "walk": {"walk", "walking", "stroll", "outside", "somewhere", "go", "going"},
    "place": {"marine", "drive", "somewhere", "beach", "place"},
    "movie": {"movie", "movies", "film", "horror", "cinema"},
    "food": {"pizza", "eat", "dinner", "food", "hungry"},
    "travel": {"japan", "travel", "visit", "trip"},
    "residence": {"live", "lives", "living", "moved", "move", "home"},
}


def concept_embed(text: str, dim: int = 64) -> list[float]:
    vec = np.zeros(dim, dtype=np.float32)
    words = re.findall(r"[a-z]+", text.lower())
    for w in words:
        hit = False
        for concept, members in CONCEPTS.items():
            if w in members:
                vec[zlib.crc32(concept.encode()) % dim] += 1.0
                hit = True
        if not hit and len(w) > 3:
            vec[zlib.crc32(w.encode()) % dim] += 0.3
    n = float(np.linalg.norm(vec))
    return (vec / n if n else vec).tolist()


class FakeOllama:
    def __init__(self, models: list[str] | None = None):
        self.models = models or ["fake-chat:latest", "nomic-embed-text:latest"]
        self.requests: list[dict[str, Any]] = []
        self.chat_reply: Callable[[dict[str, Any]], str] = lambda body: "Hello! I'm listening."
        self.extraction_reply: Callable[[dict[str, Any]], str] = lambda body: json.dumps({"memories": []})
        self.embed_available = True
        self.chat_error: tuple[int, str] | None = None
        self.token_delay = 0.0
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a: Any) -> None:
                pass

            def _send(self, status: int, obj: Any) -> None:
                data = json.dumps(obj).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self) -> None:
                if self.path == "/api/version":
                    return self._send(200, {"version": "0.0.0-fake"})
                if self.path == "/api/tags":
                    return self._send(200, {"models": [{"name": n, "size": 1, "details": {"family": "fake"}} for n in fake.models]})
                self._send(404, {"error": "not found"})

            def do_POST(self) -> None:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                fake.requests.append({"path": self.path, "body": body})
                if self.path == "/api/embed":
                    if not fake.embed_available:
                        return self._send(404, {"error": "model 'nomic-embed-text' not found"})
                    return self._send(200, {"embeddings": [concept_embed(t) for t in body["input"]]})
                if self.path == "/api/chat":
                    if fake.chat_error:
                        return self._send(*fake.chat_error[:1], {"error": fake.chat_error[1]})
                    if body["model"] not in fake.models and f"{body['model']}:latest" not in fake.models:
                        return self._send(404, {"error": f"model '{body['model']}' not found"})
                    text = (fake.extraction_reply if body.get("format") == "json" else fake.chat_reply)(body)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/x-ndjson")
                    self.end_headers()
                    import time

                    try:
                        for piece in re.findall(r"\S+\s*", text):
                            self.wfile.write(json.dumps({"message": {"role": "assistant", "content": piece}, "done": False}).encode() + b"\n")
                            self.wfile.flush()
                            if fake.token_delay:
                                time.sleep(fake.token_delay)
                        self.wfile.write(json.dumps({"message": {"role": "assistant", "content": ""}, "done": True}).encode() + b"\n")
                    except (BrokenPipeError, ConnectionResetError):
                        pass  # client aborted the stream (Stop button)
                    return
                self._send(404, {"error": "not found"})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=lambda: self.httpd.serve_forever(poll_interval=0.02), daemon=True).start()

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
