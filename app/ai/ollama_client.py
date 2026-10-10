"""Minimal Ollama HTTP client (standard library only)."""
from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from typing import Any, Callable, Iterator


class OllamaError(Exception):
    code = "ollama_error"


class OllamaUnavailable(OllamaError):
    code = "ollama_unavailable"


class OllamaModelMissing(OllamaError):
    code = "model_missing"


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never proxy localhost


class OllamaClient:
    def __init__(self, base_url: Callable[[], str] | str = "http://localhost:11434"):
        self._base = base_url if callable(base_url) else (lambda: base_url)  # type: ignore[assignment]

    @property
    def base_url(self) -> str:
        return self._base().rstrip("/")

    # ---- plumbing ------------------------------------------------------
    def _open(self, path: str, payload: dict | None = None, timeout: float = 300.0, model: str = ""):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(
            self.base_url + path,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST" if data is not None else "GET",
        )
        try:
            return _OPENER.open(req, timeout=timeout)
        except urllib.error.HTTPError as exc:
            message = ""
            try:
                message = json.loads(exc.read().decode() or "{}").get("error", "")
            except Exception:  # noqa: BLE001
                pass
            message = message or f"Ollama returned HTTP {exc.code}"
            if exc.code == 404 or "not found" in message.lower():
                name = model or "the selected model"
                raise OllamaModelMissing(
                    f"Ollama doesn't have '{name}'. Install it with: ollama pull {name}"
                ) from None
            raise OllamaError(message) from None
        except (urllib.error.URLError, ConnectionError, socket.timeout, TimeoutError, OSError) as exc:
            raise OllamaUnavailable(
                f"Can't reach Ollama at {self.base_url}. Start the Ollama app (or run `ollama serve`) and try again."
            ) from exc

    # ---- API -----------------------------------------------------------
    def health(self) -> dict[str, Any]:
        try:
            with self._open("/api/version", timeout=2.0) as resp:
                info = json.loads(resp.read().decode() or "{}")
            return {"ok": True, "version": info.get("version", "")}
        except OllamaError as exc:
            return {"ok": False, "error": str(exc), "code": exc.code}

    def list_models(self) -> list[dict[str, Any]]:
        with self._open("/api/tags", timeout=5.0) as resp:
            body = json.loads(resp.read().decode() or "{}")
        models = []
        for m in body.get("models", []):
            details = m.get("details") or {}
            models.append(
                {
                    "name": m.get("name") or m.get("model"),
                    "size": m.get("size", 0),
                    "family": details.get("family", ""),
                    "parameter_size": details.get("parameter_size", ""),
                }
            )
        return [m for m in models if m["name"]]

    def chat_stream(
        self,
        model: str,
        messages: list[dict[str, str]],
        options: dict[str, Any] | None = None,
        fmt: str | None = None,
        think: bool | None = None,
    ) -> Iterator[tuple[str, Any]]:
        """Yield ("content" | "thinking", text) pieces, then ("done", final_object)."""
        payload: dict[str, Any] = {"model": model, "messages": messages, "stream": True}
        if options:
            payload["options"] = options
        if fmt:
            payload["format"] = fmt
        if think is not None:
            payload["think"] = think
        try:
            resp = self._open("/api/chat", payload, model=model)
        except OllamaModelMissing:
            raise
        except OllamaError as exc:
            # Some models/servers reject the `think` flag; retry once without it.
            if "think" in payload and "think" in str(exc).lower():
                payload.pop("think")
                resp = self._open("/api/chat", payload, model=model)
            else:
                raise
        try:
            for raw in resp:
                line = raw.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if "error" in obj:
                    err = str(obj["error"])
                    if "not found" in err.lower():
                        raise OllamaModelMissing(f"Ollama doesn't have '{model}'. Install it with: ollama pull {model}")
                    raise OllamaError(err)
                msg = obj.get("message") or {}
                if msg.get("thinking"):
                    yield "thinking", msg["thinking"]
                if msg.get("content"):
                    yield "content", msg["content"]
                if obj.get("done"):
                    yield "done", obj
                    return
        except (socket.timeout, TimeoutError, ConnectionError) as exc:
            raise OllamaUnavailable("The connection to Ollama was interrupted.") from exc
        finally:
            resp.close()

    def chat(
        self,
        model: str,
        messages: list[dict[str, str]],
        options: dict[str, Any] | None = None,
        fmt: str | None = None,
        think: bool | None = None,
    ) -> str:
        parts = [t for kind, t in self.chat_stream(model, messages, options, fmt, think) if kind == "content"]
        return "".join(parts)

    def embed(self, model: str, texts: list[str]) -> list[list[float]]:
        try:
            with self._open("/api/embed", {"model": model, "input": texts}, timeout=60.0, model=model) as resp:
                body = json.loads(resp.read().decode() or "{}")
            vectors = body.get("embeddings")
            if vectors and len(vectors) == len(texts):
                return vectors
        except OllamaModelMissing:
            raise
        except OllamaUnavailable:
            raise
        except OllamaError:
            pass  # older Ollama without /api/embed: fall through to the legacy endpoint
        out = []
        for text in texts:
            with self._open("/api/embeddings", {"model": model, "prompt": text}, timeout=60.0, model=model) as resp:
                out.append(json.loads(resp.read().decode() or "{}").get("embedding", []))
        if not all(out):
            raise OllamaError(f"Embedding model '{model}' returned no vectors.")
        return out
