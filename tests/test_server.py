import http.client
import json
import time
from unittest import mock

import numpy as np

from app.backend.server import Server
from app.voice.stt import SAMPLE_RATE, SpeechToText
from tests.helpers import AppTestCase
from tests.test_voice import FakeRecorder, FakeTranscriber


class FakeTTS:
    available = True
    backend = "fake"

    def __init__(self):
        self.spoken, self.speaking = [], False

    def voices(self):
        return [{"name": "Alex", "lang": "en-US"}]

    def speak(self, text, voice=None, rate=None):
        self.spoken.append((text, voice, rate))
        self.speaking = True
        return True

    def stop(self):
        self.speaking = False


class ApiTestCase(AppTestCase):
    def setUp(self):
        super().setUp()
        self.start_server()

    def start_server(self):
        audio = (3000 * np.sin(np.arange(SAMPLE_RATE) / 5)).astype(np.int16)
        self.tts = FakeTTS()
        self.stt = SpeechToText(lambda: self.ctx.settings.section("voice"), FakeRecorder(audio), FakeTranscriber())
        self.ctx.tts, self.ctx.stt = self.tts, self.stt
        self.server = Server(self.ctx, port=0)
        self.server.start()
        self.addCleanup(self.server.stop)

    def call(self, method, path, body=None, token=True, headers=None, raw=False):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.port, timeout=10)
        hdrs = dict(headers or {})
        if token:
            hdrs["X-Companion-Token"] = self.server.token
        data = None
        if body is not None:
            data = json.dumps(body)
            hdrs["Content-Type"] = "application/json"
        conn.request(method, path, body=data, headers=hdrs)
        resp = conn.getresponse()
        payload = resp.read()
        conn.close()
        if raw:
            return resp.status, payload, resp
        return resp.status, (json.loads(payload) if payload else None)

    def chat(self, message, conversation_id=None):
        status, payload, _ = self.call("POST", "/api/chat", {"message": message, "conversation_id": conversation_id}, raw=True)
        events = []
        for block in payload.decode().split("\n\n"):
            if block.startswith("data: "):
                events.append(json.loads(block[6:]))
        return status, events


class SecurityTests(ApiTestCase):
    def test_token_host_and_origin_are_enforced(self):
        self.assertEqual(self.call("GET", "/api/status", token=False)[0], 401)
        self.assertEqual(self.call("GET", "/api/status", headers={"X-Companion-Token": "wrong"}, token=False)[0], 401)
        self.assertEqual(self.call("GET", "/api/status")[0], 200)
        # DNS-rebinding style request: right token but foreign Host header
        self.assertEqual(self.call("GET", "/api/status", headers={"Host": "evil.example"})[0], 403)
        # cross-site page: foreign Origin is refused even with the token
        self.assertEqual(self.call("POST", "/api/conversations", {}, headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.call("POST", "/api/conversations", {}, headers={"Origin": f"http://127.0.0.1:{self.server.port}"})[0], 201)
        self.assertEqual(self.server.httpd.server_address[0], "127.0.0.1")

    def test_static_files_and_token_injection(self):
        status, body, resp = self.call("GET", "/", token=False, raw=True)
        html = body.decode()
        self.assertEqual(status, 200)
        self.assertIn(self.server.token, html)
        self.assertNotIn("__COMPANION_TOKEN__", html)
        self.assertIn("default-src 'self'", resp.getheader("Content-Security-Policy"))
        for path, ctype in [("/app.js", "javascript"), ("/style.css", "text/css"), ("/render.js", "javascript")]:
            s, b, r = self.call("GET", path, token=False, raw=True)
            self.assertEqual(s, 200, path)
            self.assertIn(ctype, r.getheader("Content-Type"))
        self.assertNotIn(self.server.token, self.call("GET", "/app.js", token=False, raw=True)[1].decode())
        self.assertEqual(self.call("GET", "/../core.py", token=False)[0], 404)
        self.assertEqual(self.call("GET", "/%2e%2e/core.py", token=False)[0], 404)
        self.assertEqual(self.call("POST", "/", {}, token=False)[0], 405)

    def test_external_link_opener_only_accepts_web_urls(self):
        with mock.patch("app.backend.server.webbrowser.open") as opened:
            self.assertEqual(self.call("POST", "/api/open-url", {"url": "https://example.com/x"})[0], 200)
            opened.assert_called_once_with("https://example.com/x")
            self.assertEqual(self.call("POST", "/api/open-url", {"url": "file:///etc/passwd"})[0], 400)
            self.assertEqual(self.call("POST", "/api/open-url", {"url": "javascript:alert(1)"})[0], 400)
            self.assertEqual(opened.call_count, 1)


class ApiTests(ApiTestCase):
    def test_status_with_and_without_ollama(self):
        s, d = self.call("GET", "/api/status")
        self.assertTrue(d["ollama"]["ok"])
        self.assertTrue(d["model_installed"])
        self.assertEqual(d["companion_name"], "Nova")
        self.assertTrue(d["voice"]["tts_available"])
        self.ctx.settings.update({"ai": {"base_url": "http://127.0.0.1:9"}})
        s, d = self.call("GET", "/api/status")
        self.assertFalse(d["ollama"]["ok"])
        self.assertIn("ollama", d["ollama"]["error"].lower())
        s, d = self.call("GET", "/api/models")
        self.assertEqual(s, 503)
        self.assertEqual(d["code"], "ollama_unavailable")

    def test_ensure_model_picks_installed_default_but_respects_explicit_choice(self):
        self.ctx.settings.update({"ai": {"model": "qwen3:8b"}})  # the untouched default, not installed
        self.fake.models = ["nomic-embed-text:latest", "llama3.2:latest"]
        s, d = self.call("GET", "/api/models")
        self.assertEqual(d["selected"], "llama3.2:latest")
        self.ctx.settings.update({"ai": {"model": "my-explicit-choice"}})
        s, d = self.call("GET", "/api/models")
        self.assertEqual(d["selected"], "my-explicit-choice")

    def test_settings_and_personality(self):
        s, d = self.call("PUT", "/api/settings", {"ai": {"temperature": 5, "model": "x:1"}, "appearance": {"theme": "light"}})
        self.assertEqual(d["settings"]["ai"]["temperature"], 2.0)
        self.assertEqual(self.call("PUT", "/api/settings", {"ai": {"bogus": 1}})[0], 400)
        self.assertEqual(self.call("PUT", "/api/settings", {"appearance": {"theme": "neon"}})[0], 400)
        s, d = self.call("PUT", "/api/personality", {"personality": {"name": "Mira", "traits": ["calm"], "boundaries": ["no spoilers"]}})
        self.assertEqual(d["personality"]["name"], "Mira")
        self.assertEqual(self.call("PUT", "/api/personality", {"personality": {"name": ""}})[0], 400)
        s, d = self.call("GET", "/api/status")
        self.assertEqual(d["companion_name"], "Mira")
        self.assertIn("path", self.call("GET", "/api/personality")[1])

    def test_conversation_crud(self):
        s, d = self.call("POST", "/api/conversations", {"title": "Trip"})
        self.assertEqual(s, 201)
        cid = d["conversation"]["id"]
        self.assertEqual(self.call("PATCH", f"/api/conversations/{cid}", {"title": "Japan trip"})[1]["conversation"]["title"], "Japan trip")
        self.assertEqual(self.call("PATCH", f"/api/conversations/{cid}", {"title": " "})[0], 400)
        self.assertEqual(len(self.call("GET", "/api/conversations?q=japan")[1]["conversations"]), 1)
        self.assertEqual(self.call("GET", "/api/conversations/" + "0" * 32)[0], 404)
        self.assertEqual(self.call("DELETE", f"/api/conversations/{cid}")[0], 200)
        self.assertEqual(self.call("GET", f"/api/conversations/{cid}")[0], 404)
        self.assertEqual(self.call("GET", "/api/nothing")[0], 404)
        self.assertEqual(self.call("PUT", "/api/conversations", {})[0], 405)

    def test_chat_stream_then_everything_survives_restart(self):
        self.fake.chat_reply = lambda body: "Marine Drive at night sounds wonderful."
        self.fake.extraction_reply = lambda body: json.dumps(
            {"memories": [{"text": "User enjoys walking around Marine Drive at night.", "category": "preference", "importance": 0.8}]}
        )
        status, events = self.chat("I love walking around Marine Drive at night.")
        self.assertEqual(status, 200)
        self.assertEqual([e["type"] for e in events][:2], ["start", "memories"])
        self.assertEqual(events[-1]["type"], "done")
        cid = events[0]["conversation"]["id"]
        self.assertTrue(self.ctx.extractor.wait_idle())
        s, d = self.call("GET", "/api/memories/events?since=0")
        self.assertEqual([e["action"] for e in d["events"]], ["added"])

        # full "quit and relaunch": new context, new server, same data directory
        self.server.stop()
        self.ctx.extractor.wait_idle()
        self.ctx.close()
        self.ctx = self.new_ctx()
        self.start_server()
        s, d = self.call("GET", "/api/conversations")
        self.assertEqual(d["conversations"][0]["id"], cid)
        s, d = self.call("GET", f"/api/conversations/{cid}")
        self.assertEqual([m["role"] for m in d["messages"]], ["user", "assistant"])
        s, d = self.call("GET", "/api/memories")
        self.assertEqual([m["text"] for m in d["memories"]], ["User enjoys walking around Marine Drive at night."])
        # and the restored memory is used in a brand-new conversation
        status, events = self.chat("I'm thinking about going somewhere tonight")
        used = next(e for e in events if e["type"] == "memories")["items"]
        self.assertEqual([m["text"] for m in used], ["User enjoys walking around Marine Drive at night."])

    def test_chat_validation_and_errors(self):
        self.assertEqual(self.call("POST", "/api/chat", {"message": "  "})[0], 400)
        self.assertEqual(self.call("POST", "/api/chat", {"message": "hi", "conversation_id": "0" * 32})[0], 404)
        self.assertEqual(self.call("POST", "/api/chat", {"message": "x" * 20001})[0], 400)
        self.ctx.settings.update({"ai": {"model": "ghost"}})
        status, events = self.chat("hello there")
        self.assertEqual(events[-1]["code"], "model_missing")

    def test_memory_management_endpoints(self):
        s, d = self.call("POST", "/api/memories", {"text": "User likes jazz.", "category": "preference", "importance": 0.9})
        self.assertEqual(s, 201)
        mid = d["memory"]["id"]
        self.assertEqual(d["memory"]["origin"], "manual")
        self.assertEqual(self.call("POST", "/api/memories", {"text": "  "})[0], 400)
        s, d = self.call("PATCH", f"/api/memories/{mid}", {"text": "User loves live jazz.", "importance": 0.5})
        self.assertEqual(d["memory"]["text"], "User loves live jazz.")
        self.assertEqual(self.call("GET", "/api/memories?q=jazz")[1]["count"], 1)
        self.assertEqual(self.call("GET", "/api/memories?category=event")[1]["memories"], [])
        self.assertEqual(self.call("PATCH", "/api/memories/" + "f" * 32, {"text": "x"})[0], 404)
        self.assertEqual(self.call("DELETE", "/api/memories")[0], 400)  # needs explicit confirmation
        self.assertEqual(self.call("DELETE", f"/api/memories/{mid}")[0], 200)
        self.assertEqual(self.call("DELETE", f"/api/memories/{mid}")[0], 404)
        self.call("POST", "/api/memories", {"text": "A"})
        self.call("POST", "/api/memories", {"text": "B"})
        self.assertEqual(self.call("DELETE", "/api/memories?confirm=yes")[1]["deleted"], 2)

    def test_voice_endpoints(self):
        s, d = self.call("GET", "/api/voice/status")
        self.assertTrue(d["tts"]["available"])
        self.assertEqual(self.call("GET", "/api/voice/voices")[1]["voices"][0]["name"], "Alex")
        self.assertEqual(self.call("GET", "/api/voice/devices")[1]["devices"][0]["name"], "Fake Mic")
        self.assertEqual(self.call("POST", "/api/voice/speak", {"text": "hello", "rate": 200})[0], 200)
        self.assertEqual(self.tts.spoken[-1], ("hello", None, 200))
        self.assertEqual(self.call("POST", "/api/voice/speak", {"text": ""})[0], 400)
        self.call("POST", "/api/voice/stop", {})
        self.assertFalse(self.tts.speaking)
        # record -> transcribe
        self.assertEqual(self.call("POST", "/api/voice/record/start", {})[0], 200)
        self.assertTrue(self.call("GET", "/api/voice/level")[1]["recording"])
        s, d = self.call("POST", "/api/voice/record/stop", {})
        self.assertEqual(d["text"], "hello from the mic")
        # cancel path
        self.call("POST", "/api/voice/record/start", {})
        self.call("POST", "/api/voice/record/cancel", {})
        self.assertFalse(self.call("GET", "/api/voice/level")[1]["recording"])
        # silence gives an actionable error
        self.stt.recorder.audio = np.zeros(SAMPLE_RATE, dtype=np.int16)
        s, d = self.call("POST", "/api/voice/record/stop", {})
        self.assertEqual(s, 422)
        self.assertIn("permission", d["error"].lower())
