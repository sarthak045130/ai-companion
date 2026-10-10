"""Local HTTP API + static frontend (standard library only).

Privacy/security: binds to 127.0.0.1 only, validates the Host and Origin headers (blocks DNS-rebinding and
cross-site requests) and requires a random per-launch token on every /api call. The token is injected
into the page the app itself serves, so other web pages and local processes cannot call the API.
"""
from __future__ import annotations

import json
import logging
import mimetypes
import re
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, unquote, urlparse

from ..ai.ollama_client import OllamaError
from ..config.settings import DEFAULTS
from ..core import AppContext
from ..memory.store import CATEGORIES
from ..voice.stt import VoiceError

log = logging.getLogger("companion.server")
import sys

if getattr(sys, "frozen", False):
    FRONTEND_DIR = Path(sys._MEIPASS) / "app" / "frontend"
else:
    FRONTEND_DIR = Path(__file__).resolve().parents[1] / "frontend"
MAX_BODY = 5 * 1024 * 1024
STREAMED = object()
TOKEN_PLACEHOLDER = "__COMPANION_TOKEN__"


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "bad_request"):
        super().__init__(message)
        self.status, self.code = status, code


class Request:
    def __init__(self, handler: BaseHTTPRequestHandler, method: str, query: dict[str, str], match: re.Match[str]):
        self.handler, self.method, self.query, self.match = handler, method, query, match

    def json(self) -> dict[str, Any]:
        length = int(self.handler.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError("Request body too large", 413, "too_large")
        raw = self.handler.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except ValueError:
            raise ApiError("Request body must be valid JSON") from None
        if not isinstance(data, dict):
            raise ApiError("Request body must be a JSON object")
        return data


def _num(value: str | None, default: float) -> float:
    try:
        return float(value) if value is not None else default
    except ValueError:
        return default


class Api:
    def __init__(self, ctx: AppContext):
        self.ctx = ctx
        self.routes: list[tuple[str, re.Pattern[str], Callable[[Request], Any]]] = []
        for method, pattern, fn in [
            ("GET", r"/api/status", self.status),
            ("GET", r"/api/models", self.models),
            ("GET", r"/api/settings", self.get_settings),
            ("PUT", r"/api/settings", self.put_settings),
            ("GET", r"/api/personality", self.get_personality),
            ("PUT", r"/api/personality", self.put_personality),
            ("POST", r"/api/personality/reload", self.reload_personality),
            ("GET", r"/api/conversations", self.list_conversations),
            ("POST", r"/api/conversations", self.create_conversation),
            ("GET", r"/api/conversations/(?P<id>[0-9a-f]+)", self.get_conversation),
            ("PATCH", r"/api/conversations/(?P<id>[0-9a-f]+)", self.rename_conversation),
            ("DELETE", r"/api/conversations/(?P<id>[0-9a-f]+)", self.delete_conversation),
            ("POST", r"/api/chat", self.chat),
            ("GET", r"/api/memories", self.list_memories),
            ("POST", r"/api/memories", self.create_memory),
            ("DELETE", r"/api/memories", self.clear_memories),
            ("GET", r"/api/memories/events", self.memory_events),
            ("PATCH", r"/api/memories/(?P<id>[0-9a-f]+)", self.update_memory),
            ("DELETE", r"/api/memories/(?P<id>[0-9a-f]+)", self.delete_memory),
            ("GET", r"/api/voice/status", self.voice_status),
            ("GET", r"/api/voice/voices", self.voice_voices),
            ("GET", r"/api/voice/devices", self.voice_devices),
            ("POST", r"/api/voice/speak", self.voice_speak),
            ("POST", r"/api/voice/stop", self.voice_stop),
            ("POST", r"/api/voice/record/start", self.record_start),
            ("POST", r"/api/voice/record/stop", self.record_stop),
            ("POST", r"/api/voice/record/cancel", self.record_cancel),
            ("GET", r"/api/voice/level", self.record_level),
            ("POST", r"/api/open-url", self.open_url),
        ]:
            self.routes.append((method, re.compile(pattern), fn))

    # ---- status / models -----------------------------------------------------
    def status(self, req: Request) -> dict[str, Any]:
        c = self.ctx
        health = c.client.health()
        models: list[str] = []
        installed = None
        model = c.settings.value("ai", "model")
        if health["ok"]:
            try:
                models = [m["name"] for m in c.client.list_models()]
            except OllamaError:
                pass
            installed = model in models or f"{model}:latest" in models
        return {
            "companion_name": c.personality.name,
            "ollama": health,
            "model": model,
            "model_installed": installed,
            "models": models,
            "memory_count": c.memory.count(),
            "extraction_pending": c.extractor.pending,
            "embedding": {"kind": c.embedder.kind, "last_error": c.embedder.last_error},
            "personality_error": c.personality.error,
            "settings_error": c.settings.load_error,
            "voice": {
                "tts_available": c.tts.available,
                "tts_backend": c.tts.backend,
                "speaking": c.tts.speaking,
                **{f"stt_{k}": v for k, v in c.stt.status().items()},
            },
        }

    def models(self, req: Request) -> dict[str, Any]:
        try:
            self.ctx.ensure_model()
            return {"models": self.ctx.client.list_models(), "selected": self.ctx.settings.value("ai", "model")}
        except OllamaError as exc:
            raise ApiError(str(exc), 503, exc.code) from None

    # ---- settings / personality -------------------------------------------------
    def get_settings(self, req: Request) -> dict[str, Any]:
        return {"settings": self.ctx.settings.get(), "defaults": DEFAULTS}

    def put_settings(self, req: Request) -> dict[str, Any]:
        before = self.ctx.settings.section("memory")["embedding_model"]
        updated = self.ctx.settings.update(req.json())
        if updated["memory"]["embedding_model"] != before:
            threading.Thread(target=self.ctx.memory.reindex_stale, daemon=True).start()
        return {"settings": updated}

    def get_personality(self, req: Request) -> dict[str, Any]:
        return {"personality": self.ctx.personality.get(), "error": self.ctx.personality.error,
                "path": str(self.ctx.personality.path)}

    def put_personality(self, req: Request) -> dict[str, Any]:
        body = req.json()
        return {"personality": self.ctx.personality.save(body.get("personality", body))}

    def reload_personality(self, req: Request) -> dict[str, Any]:
        self.ctx.personality.reload()
        return {"personality": self.ctx.personality.get(), "error": self.ctx.personality.error}

    # ---- conversations ------------------------------------------------------------
    def list_conversations(self, req: Request) -> dict[str, Any]:
        return {"conversations": self.ctx.convs.list(req.query.get("q"))}

    def create_conversation(self, req: Request) -> tuple[int, dict[str, Any]]:
        title = str(req.json().get("title") or "New chat")
        return 201, {"conversation": self.ctx.convs.create(title)}

    def _conv_or_404(self, conv_id: str) -> dict[str, Any]:
        conv = self.ctx.convs.get(conv_id)
        if not conv:
            raise ApiError("Conversation not found", 404, "not_found")
        return conv

    def get_conversation(self, req: Request) -> dict[str, Any]:
        conv = self._conv_or_404(req.match["id"])
        return {"conversation": conv, "messages": self.ctx.convs.messages(conv["id"])}

    def rename_conversation(self, req: Request) -> dict[str, Any]:
        conv = self._conv_or_404(req.match["id"])
        title = req.json().get("title")
        if not isinstance(title, str) or not title.strip():
            raise ApiError("title is required")
        return {"conversation": self.ctx.convs.rename(conv["id"], title)}

    def delete_conversation(self, req: Request) -> dict[str, Any]:
        self._conv_or_404(req.match["id"])
        self.ctx.convs.delete(req.match["id"])
        return {"ok": True}

    # ---- chat (Server-Sent Events) ---------------------------------------------------
    def chat(self, req: Request) -> Any:
        body = req.json()
        message = body.get("message")
        if not isinstance(message, str) or not message.strip():
            raise ApiError("message is required")
        if len(message) > 20000:
            raise ApiError("message is too long (20,000 character limit)")
        conv_id = body.get("conversation_id")
        if conv_id is not None:
            if not isinstance(conv_id, str):
                raise ApiError("conversation_id must be text")
            self._conv_or_404(conv_id)
        h = req.handler
        h.send_response(200)
        h.send_header("Content-Type", "text/event-stream; charset=utf-8")
        h.send_header("Cache-Control", "no-store")
        h.send_header("X-Accel-Buffering", "no")
        h.send_header("Connection", "close")
        h.end_headers()
        gen = self.ctx.companion.stream_reply(conv_id, message)
        try:
            for event in gen:
                h.wfile.write(b"data: " + json.dumps(event, ensure_ascii=False).encode("utf-8") + b"\n\n")
                h.wfile.flush()
        except OSError:  # client went away (Stop button / window closed): saves partial reply in the generator
            gen.close()
        return STREAMED

    # ---- memories --------------------------------------------------------------------------
    def list_memories(self, req: Request) -> dict[str, Any]:
        q = req.query
        mems = self.ctx.memory.list(
            q=q.get("q"),
            category=q.get("category") or None,
            include_inactive=q.get("include_inactive") == "1",
            order=q.get("order", "updated"),
            limit=int(_num(q.get("limit"), 500)),
            offset=int(_num(q.get("offset"), 0)),
        )
        return {"memories": mems, "count": self.ctx.memory.count(), "categories": list(CATEGORIES)}

    def create_memory(self, req: Request) -> tuple[int, dict[str, Any]]:
        b = req.json()
        mem = self.ctx.memory.add(
            text=str(b.get("text", "")),
            category=str(b.get("category", "fact")),
            importance=b.get("importance", 0.7),
            confidence=1.0,
            origin="manual",
        )
        return 201, {"memory": mem}

    def update_memory(self, req: Request) -> dict[str, Any]:
        b = req.json()
        mem = self.ctx.memory.update(
            req.match["id"], **{k: b[k] for k in ("text", "category", "importance", "confidence") if k in b}
        )
        if not mem:
            raise ApiError("Memory not found", 404, "not_found")
        return {"memory": mem}

    def delete_memory(self, req: Request) -> dict[str, Any]:
        if not self.ctx.memory.delete(req.match["id"]):
            raise ApiError("Memory not found", 404, "not_found")
        return {"ok": True}

    def clear_memories(self, req: Request) -> dict[str, Any]:
        if req.query.get("confirm") != "yes":
            raise ApiError("Pass ?confirm=yes to delete ALL memories")
        return {"deleted": self.ctx.memory.clear()}

    def memory_events(self, req: Request) -> dict[str, Any]:
        events = self.ctx.memory.events_since(_num(req.query.get("since"), 0.0))
        return {"events": events, "count": self.ctx.memory.count(), "pending": self.ctx.extractor.pending}

    # ---- voice -------------------------------------------------------------------------------
    def voice_status(self, req: Request) -> dict[str, Any]:
        c = self.ctx
        return {
            "tts": {"available": c.tts.available, "backend": c.tts.backend, "speaking": c.tts.speaking},
            "stt": c.stt.status(),
        }

    def voice_voices(self, req: Request) -> dict[str, Any]:
        return {"voices": self.ctx.tts.voices(), "backend": self.ctx.tts.backend}

    def voice_devices(self, req: Request) -> dict[str, Any]:
        try:
            return {"devices": self.ctx.stt.recorder.devices()}
        except VoiceError as exc:
            raise ApiError(str(exc), 503, "voice_error") from None

    def voice_speak(self, req: Request) -> dict[str, Any]:
        b = req.json()
        text = b.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ApiError("text is required")
        if not self.ctx.tts.available:
            raise ApiError("No text-to-speech engine found on this system.", 503, "tts_unavailable")
        rate = b.get("rate")
        ok = self.ctx.tts.speak(text, voice=b.get("voice"), rate=int(rate) if rate else None)
        return {"ok": ok}

    def voice_stop(self, req: Request) -> dict[str, Any]:
        self.ctx.tts.stop()
        return {"ok": True}

    def record_start(self, req: Request) -> dict[str, Any]:
        self.ctx.tts.stop()  # don't record the companion talking
        try:
            self.ctx.stt.start()
        except VoiceError as exc:
            raise ApiError(str(exc), 503, "voice_error") from None
        return {"ok": True}

    def record_stop(self, req: Request) -> dict[str, Any]:
        try:
            return {"text": self.ctx.stt.stop_and_transcribe()}
        except VoiceError as exc:
            raise ApiError(str(exc), 422, "voice_error") from None

    def record_cancel(self, req: Request) -> dict[str, Any]:
        self.ctx.stt.cancel()
        return {"ok": True}

    def record_level(self, req: Request) -> dict[str, Any]:
        rec = self.ctx.stt.recorder
        return {"recording": rec.recording, "level": round(getattr(rec, "level", 0.0), 4)}

    def open_url(self, req: Request) -> dict[str, Any]:
        """Links in replies open in the user's default browser, never inside the app window."""
        url = req.json().get("url")
        if not isinstance(url, str) or not re.fullmatch(r"https?://[^\s]+", url):
            raise ApiError("A web address starting with http:// or https:// is required")
        webbrowser.open(url)
        return {"ok": True}


class Server:
    def __init__(self, ctx: AppContext, host: str = "127.0.0.1", port: int = 0, frontend_dir: Path = FRONTEND_DIR):
        self.ctx = ctx
        self.api = Api(ctx)
        self.token = secrets.token_urlsafe(24)
        self.frontend_dir = frontend_dir
        server = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "Companion/0.1"

            def log_message(self, fmt: str, *args: Any) -> None:  # quiet
                log.debug("%s - %s", self.address_string(), fmt % args)

            def _json(self, status: int, payload: Any) -> None:
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def _allowed_hosts(self) -> set[str]:
                p = server.port
                return {f"127.0.0.1:{p}", f"localhost:{p}", f"[::1]:{p}"}

            def _dispatch(self, method: str) -> None:
                try:
                    if self.headers.get("Host", "") not in self._allowed_hosts():
                        return self._json(403, {"error": "Forbidden host", "code": "forbidden"})
                    parsed = urlparse(self.path)
                    path = unquote(parsed.path)
                    if path.startswith("/api/"):
                        origin = self.headers.get("Origin")
                        if origin and origin.replace("http://", "") not in self._allowed_hosts():
                            return self._json(403, {"error": "Forbidden origin", "code": "forbidden"})
                        supplied = self.headers.get("X-Companion-Token", "")
                        if not secrets.compare_digest(supplied, server.token):
                            return self._json(401, {"error": "Missing or invalid token", "code": "unauthorized"})
                        query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
                        allowed_methods = set()
                        for m, pattern, fn in server.api.routes:
                            match = pattern.fullmatch(path)
                            if not match:
                                continue
                            allowed_methods.add(m)
                            if m != method:
                                continue
                            result = fn(Request(self, method, query, match))
                            if result is STREAMED:
                                return
                            status, payload = result if isinstance(result, tuple) else (200, result)
                            return self._json(status, payload)
                        if allowed_methods:
                            return self._json(405, {"error": "Method not allowed", "code": "method_not_allowed"})
                        return self._json(404, {"error": "Not found", "code": "not_found"})
                    if method != "GET":
                        return self._json(405, {"error": "Method not allowed", "code": "method_not_allowed"})
                    self._static(path)
                except ApiError as exc:
                    self._json(exc.status, {"error": str(exc), "code": exc.code})
                except OllamaError as exc:
                    self._json(503, {"error": str(exc), "code": exc.code})
                except ValueError as exc:
                    self._json(400, {"error": str(exc), "code": "invalid"})
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception as exc:  # noqa: BLE001
                    log.exception("unhandled error for %s %s", method, self.path)
                    try:
                        self._json(500, {"error": f"Internal error: {exc}", "code": "internal"})
                    except OSError:
                        pass

            def _static(self, path: str) -> None:
                rel = "index.html" if path in ("", "/") else path.lstrip("/")
                target = (server.frontend_dir / rel).resolve()
                root = server.frontend_dir.resolve()
                if root not in target.parents or not target.is_file():
                    return self._json(404, {"error": "Not found", "code": "not_found"})
                data = target.read_bytes()
                ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                if target.name == "index.html":
                    data = data.replace(TOKEN_PLACEHOLDER.encode(), server.token.encode())
                self.send_response(200)
                self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith(("text/", "application/javascript")) else ""))
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
                    "connect-src 'self'; frame-ancestors 'none'",
                )
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self) -> None: self._dispatch("GET")
            def do_POST(self) -> None: self._dispatch("POST")
            def do_PUT(self) -> None: self._dispatch("PUT")
            def do_PATCH(self) -> None: self._dispatch("PATCH")
            def do_DELETE(self) -> None: self._dispatch("DELETE")

        self.httpd = ThreadingHTTPServer((host, port), Handler)
        self.httpd.daemon_threads = True
        self.host = host
        self.port = self.httpd.server_address[1]
        self._thread: threading.Thread | None = None

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/"

    def start(self) -> None:
        self._thread = threading.Thread(target=self.httpd.serve_forever, name="http", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
