import json
import time

from tests.helpers import AppTestCase


def chat_requests(fake):
    return [r["body"] for r in fake.requests if r["path"] == "/api/chat" and r["body"].get("format") != "json"]


class PipelineTests(AppTestCase):
    def run_turn(self, text, conv_id=None):
        return list(self.ctx.companion.stream_reply(conv_id, text))

    def test_full_turn_events_persistence_and_async_extraction(self):
        self.fake.chat_reply = lambda body: "That sounds like a lovely walk."
        self.fake.extraction_reply = lambda body: json.dumps(
            {"memories": [{"text": "User enjoys walking around Marine Drive at night.", "category": "preference",
                           "importance": 0.7, "confidence": 0.9}]}
        )
        events = self.run_turn("I love walking around Marine Drive at night.")
        kinds = [e["type"] for e in events]
        self.assertEqual(kinds[0], "start")
        self.assertEqual(kinds[1], "memories")
        self.assertEqual(kinds[-1], "done")
        self.assertIn("token", kinds)
        reply = "".join(e["text"] for e in events if e["type"] == "token")
        self.assertEqual(reply, "That sounds like a lovely walk.")
        conv_id = events[0]["conversation"]["id"]
        self.assertEqual(events[-1]["conversation"]["title"], "I love walking around Marine Drive at night.")
        saved = self.ctx.convs.messages(conv_id)
        self.assertEqual([(m["role"], m["content"]) for m in saved],
                         [("user", "I love walking around Marine Drive at night."), ("assistant", reply)])
        # request actually sent to the model uses the configured model + options + personality
        req = chat_requests(self.fake)[0]
        self.assertEqual(req["model"], "fake-chat:latest")
        self.assertEqual(req["options"]["num_ctx"], 8192)
        self.assertIn("You are Nova", req["messages"][0]["content"])
        self.assertEqual(req["messages"][-1], {"role": "user", "content": "I love walking around Marine Drive at night."})
        # memory extraction ran in the background
        self.assertTrue(self.ctx.extractor.wait_idle())
        self.assertEqual([m["text"] for m in self.ctx.memory.list()], ["User enjoys walking around Marine Drive at night."])

    def test_extraction_does_not_block_reply(self):
        def slow(body):
            time.sleep(0.6)
            return json.dumps({"memories": []})

        self.fake.extraction_reply = slow
        t0 = time.time()
        events = self.run_turn("I really enjoy listening to jazz while cooking dinner.")
        elapsed = time.time() - t0
        self.assertEqual(events[-1]["type"], "done")
        self.assertLess(elapsed, 0.5)
        self.assertGreaterEqual(self.ctx.extractor.pending, 1)
        self.assertTrue(self.ctx.extractor.wait_idle())

    def test_memory_is_retrieved_into_prompt_in_a_later_conversation(self):
        self.ctx.memory.add("User enjoys walking around Marine Drive at night.", "preference", 0.7)
        self.ctx.memory.add("User likes pizza with extra cheese.", "preference", 0.5)
        ctx = self.restart()
        events = list(ctx.companion.stream_reply(None, "I'm thinking about going somewhere tonight"))
        used = [m["text"] for m in next(e for e in events if e["type"] == "memories")["items"]]
        self.assertEqual(used, ["User enjoys walking around Marine Drive at night."])
        system = chat_requests(self.fake)[-1]["messages"][0]["content"]
        self.assertIn("Marine Drive", system)
        self.assertNotIn("pizza", system)

    def test_memory_disabled(self):
        self.ctx.memory.add("User enjoys walking around Marine Drive at night.", "preference", 0.7)
        self.ctx.settings.update({"memory": {"enabled": False}})
        self.run_turn("I'm thinking about going somewhere tonight, I love night walks")
        self.assertNotIn("Marine Drive", chat_requests(self.fake)[-1]["messages"][0]["content"])
        self.ctx.extractor.wait_idle()
        self.assertEqual(self.ctx.memory.count(), 1)  # nothing new saved
        self.assertFalse([r for r in self.fake.requests if r["body"].get("format") == "json"])

    def test_stop_midstream_keeps_partial_reply_and_skips_extraction(self):
        self.fake.chat_reply = lambda body: " ".join(f"word{i}" for i in range(50))
        self.fake.token_delay = 0.01
        gen = self.ctx.companion.stream_reply(None, "Tell me a long story please")
        seen = []
        for e in gen:
            seen.append(e)
            if sum(1 for x in seen if x["type"] == "token") >= 5:
                break
        gen.close()  # what happens when the browser aborts the request
        conv_id = seen[0]["conversation"]["id"]
        msgs = self.ctx.convs.messages(conv_id)
        self.assertEqual(msgs[-1]["role"], "assistant")
        self.assertTrue(msgs[-1]["meta"]["interrupted"])
        self.assertTrue(msgs[-1]["content"].startswith("word0"))
        self.ctx.extractor.wait_idle()
        self.assertFalse([r for r in self.fake.requests if r["body"].get("format") == "json"])

    def test_model_missing_and_ollama_down_give_useful_errors(self):
        self.ctx.settings.update({"ai": {"model": "ghost"}})
        events = self.run_turn("hello there friend")
        self.assertEqual(events[-1]["type"], "error")
        self.assertEqual(events[-1]["code"], "model_missing")
        self.assertIn("ollama pull ghost", events[-1]["message"])
        conv_id = events[0]["conversation"]["id"]
        self.assertEqual([m["role"] for m in self.ctx.convs.messages(conv_id)], ["user"])  # user msg kept, no fake reply
        self.ctx.settings.update({"ai": {"base_url": "http://127.0.0.1:9", "model": "fake-chat:latest"}})
        events = self.run_turn("hello again", conv_id)
        self.assertEqual(events[-1]["code"], "ollama_unavailable")
        self.assertIn("Start the Ollama app", events[-1]["message"])

    def test_empty_reply_and_think_blocks(self):
        self.fake.chat_reply = lambda body: ""
        self.assertEqual(self.run_turn("hello there")[-1]["code"], "empty_reply")
        self.fake.chat_reply = lambda body: "<think>let me plan</think>\n\nHi there!"
        events = self.run_turn("hello again!")
        self.assertEqual(events[-1]["message"]["content"], "Hi there!")

    def test_history_is_trimmed_to_context_budget(self):
        conv = self.ctx.convs.create("Long")
        for i in range(30):
            self.ctx.convs.add_message(conv["id"], "user" if i % 2 == 0 else "assistant", f"msg{i} " + "x" * 800)
        self.ctx.settings.update({"ai": {"context_length": 2048, "max_tokens": 512, "history_messages": 40}})
        self.run_turn("final question here", conv["id"])
        sent = chat_requests(self.fake)[-1]["messages"]
        self.assertEqual(sent[-1]["content"], "final question here")
        self.assertLess(len(sent), 20)
        self.assertTrue(any("msg29" in m["content"] for m in sent))  # newest kept
        self.assertFalse(any("msg0 " in m["content"] for m in sent))  # oldest dropped
