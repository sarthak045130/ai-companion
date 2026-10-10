import json
import unittest

from app.ai.ollama_client import OllamaClient, OllamaModelMissing, OllamaUnavailable
from app.ai.orchestrator import ThinkStripper, make_title
from app.config.personality import PersonalityStore
from app.config.settings import SettingsError, SettingsStore
from tests.helpers import AppTestCase


class SettingsTests(AppTestCase):
    def test_defaults_clamp_persist_and_reject(self):
        s = self.ctx.settings
        s.update({"ai": {"temperature": 99, "context_length": 4096}, "appearance": {"theme": "light"}})
        self.assertEqual(s.value("ai", "temperature"), 2.0)
        with self.assertRaises(SettingsError):
            s.update({"ai": {"nope": 1}})
        with self.assertRaises(SettingsError):
            s.update({"appearance": {"theme": "neon"}})
        # all-or-nothing: the failed update above must not have changed anything
        self.assertEqual(s.value("appearance", "theme"), "light")
        again = SettingsStore(self.tmp / "data" / "settings.json")
        self.assertEqual(again.value("ai", "context_length"), 4096)
        self.assertEqual(again.value("ai", "model"), "fake-chat:latest")

    def test_corrupt_settings_file_falls_back_to_defaults(self):
        path = self.tmp / "bad.json"
        path.write_text("{not json")
        s = SettingsStore(path)
        self.assertIsNotNone(s.load_error)
        self.assertEqual(s.value("ai", "temperature"), 0.8)


class PersonalityTests(AppTestCase):
    def test_edit_json_without_code_changes(self):
        p = self.ctx.personality
        self.assertEqual(p.name, "Nova")
        data = json.loads((self.tmp / "personality.json").read_text())
        data["name"] = "Mira"
        data["traits"] = ["sarcastic", "kind"]
        (self.tmp / "personality.json").write_text(json.dumps(data))
        p.reload()
        ctx = p.build_context("Always answer in two sentences.")
        self.assertIn("You are Mira", ctx)
        self.assertIn("sarcastic, kind", ctx)
        self.assertIn("not a human being", ctx)
        self.assertIn("Always answer in two sentences.", ctx)

    def test_invalid_file_is_not_overwritten(self):
        path = self.tmp / "personality.json"
        path.write_text("{broken")
        p = PersonalityStore(path)
        self.assertIsNotNone(p.error)
        self.assertEqual(path.read_text(), "{broken")  # user's file untouched
        self.assertEqual(p.name, "Nova")  # still usable

    def test_save_validates(self):
        with self.assertRaises(ValueError):
            self.ctx.personality.save({"name": "  "})
        saved = self.ctx.personality.save({"name": "Ash", "traits": "calm, dry"})
        self.assertEqual(saved["traits"], ["calm", "dry"])


class ConversationTests(AppTestCase):
    def test_crud_search_and_restart(self):
        c = self.ctx.convs
        a = c.create("Holiday plans")
        b = c.create("Work")
        c.add_message(a["id"], "user", "I want to visit Kyoto in spring")
        c.add_message(a["id"], "assistant", "Sounds lovely.")
        c.add_message(b["id"], "user", "Quarterly report is 100% done")
        self.assertEqual([x["id"] for x in c.list("kyoto")], [a["id"]])
        self.assertEqual([x["id"] for x in c.list("100%")], [b["id"]])  # LIKE wildcards escaped
        self.assertEqual(c.list("%"), [x for x in c.list("%")])  # no crash
        c.rename(b["id"], "Work stuff")
        ctx = self.restart()
        msgs = ctx.convs.messages(a["id"])
        self.assertEqual([m["role"] for m in msgs], ["user", "assistant"])
        self.assertEqual(ctx.convs.get(b["id"])["title"], "Work stuff")
        self.assertTrue(ctx.convs.delete(a["id"]))
        self.assertEqual(ctx.convs.messages(a["id"]), [])  # cascade


class ThinkStripperTests(unittest.TestCase):
    def run_chunks(self, chunks):
        t = ThinkStripper()
        out = "".join(t.feed(c) for c in chunks) + t.flush()
        return out

    def test_variants(self):
        self.assertEqual(self.run_chunks(["Hello ", "world"]), "Hello world")
        self.assertEqual(self.run_chunks(["<think>secret</think>\n\nHi"]), "Hi")
        self.assertEqual(self.run_chunks(["<th", "ink>plan", " more</th", "ink>Answer <b>ok</b>"]), "Answer <b>ok</b>")
        self.assertEqual(self.run_chunks(["a < b and <t", "able>"]), "a < b and <table>")
        self.assertEqual(self.run_chunks(["<think>never closed"]), "")

    def test_title(self):
        self.assertEqual(make_title("hi"), "hi")
        self.assertTrue(make_title("word " * 30).endswith("…"))


class OllamaClientTests(AppTestCase):
    def test_health_models_stream(self):
        client = self.ctx.client
        self.assertTrue(client.health()["ok"])
        self.assertIn("fake-chat:latest", [m["name"] for m in client.list_models()])
        self.fake.chat_reply = lambda body: "one two three"
        parts = list(client.chat_stream("fake-chat", [{"role": "user", "content": "x"}]))
        self.assertEqual("".join(t for k, t in parts if k == "content").strip(), "one two three")
        self.assertEqual(parts[-1][0], "done")

    def test_missing_model_and_unreachable(self):
        with self.assertRaises(OllamaModelMissing) as cm:
            list(self.ctx.client.chat_stream("ghost", [{"role": "user", "content": "x"}]))
        self.assertIn("ollama pull ghost", str(cm.exception))
        dead = OllamaClient("http://127.0.0.1:9")
        self.assertFalse(dead.health()["ok"])
        with self.assertRaises(OllamaUnavailable) as cm2:
            dead.list_models()
        self.assertIn("Start the Ollama app", str(cm2.exception))

    def test_think_flag_rejected_is_retried(self):
        calls = []
        orig = self.fake.chat_error

        def reply(body):
            calls.append("think" in body)
            return "ok"

        self.fake.chat_reply = reply
        # server accepts think here; verify the flag is sent when requested
        list(self.ctx.client.chat_stream("fake-chat", [{"role": "user", "content": "x"}], think=False))
        self.assertEqual(calls, [True])


if __name__ == "__main__":
    unittest.main()
