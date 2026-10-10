import json

from app.memory.extractor import heuristic_extract, is_trivial, parse_preference
from tests.helpers import AppTestCase


class HeuristicTests(AppTestCase):
    def test_trivial_filter(self):
        for t in ["lol", "ok", "Thanks!", "hi", "hmm", "😂😂😂😂😂😂😂😂"]:
            self.assertTrue(is_trivial(t), t)
        self.assertFalse(is_trivial("I love walking around Marine Drive at night."))

    def test_extraction_patterns(self):
        got = heuristic_extract("I love walking around Marine Drive at night. What time is it?")
        self.assertEqual([g["text"] for g in got], ["User loves walking around Marine Drive at night."])
        self.assertEqual(heuristic_extract("Can you help me with my homework?"), [])
        self.assertEqual(heuristic_extract("lol that's funny")[:], [])
        names = heuristic_extract("my name is rahul and I live in Mumbai")
        self.assertEqual(names[0]["text"], "User's name is Rahul.")
        self.assertEqual(parse_preference("User dislikes crowded places."), (False, "crowded place"))


class MemoryStoreTests(AppTestCase):
    def test_marine_drive_scenario_end_to_end(self):
        """Conversation 1 stores it; after a restart, an unrelated-wording message retrieves it."""
        self.fake.extraction_reply = lambda body: json.dumps(
            {"memories": [{"text": "User enjoys walking around Marine Drive at night.", "category": "preference",
                           "importance": 0.7, "confidence": 0.9, "supersedes_id": None}]}
        )
        conv = self.ctx.convs.create()
        actions = self.ctx.extractor.process(conv["id"], "I love walking around Marine Drive at night.", "That sounds peaceful!")
        self.assertEqual(actions[0]["action"], "added")
        self.ctx.memory.add("User likes pizza with extra cheese.", "preference", 0.5)
        self.ctx.memory.add("User wants to visit Japan.", "goal", 0.6)
        ctx = self.restart()  # memories must survive a restart, including the vector index
        hits = ctx.memory.search("I'm thinking about going somewhere tonight", limit=3, min_similarity=0.3)
        self.assertTrue(hits, "expected a relevant memory")
        self.assertIn("Marine Drive", hits[0]["text"])
        self.assertNotIn("pizza", " ".join(h["text"] for h in hits))
        self.assertEqual(ctx.memory.get(hits[0]["id"])["access_count"], 1)

    def test_not_everything_is_saved(self):
        conv = self.ctx.convs.create()
        for text in ["lol", "what time is it?", "ok thanks"]:
            self.assertEqual(self.ctx.extractor.process(conv["id"], text, "..."), [])
        self.assertEqual(self.ctx.memory.count(), 0)

    def test_importance_threshold(self):
        self.fake.extraction_reply = lambda body: json.dumps(
            {"memories": [{"text": "User asked about the weather once.", "importance": 0.2},
                          {"text": "User is allergic to peanuts.", "category": "fact", "importance": 0.9}]}
        )
        conv = self.ctx.convs.create()
        acts = self.ctx.extractor.process(conv["id"], "I'm allergic to peanuts, also weather is nice", "ok")
        self.assertEqual([a["action"] for a in acts], ["ignored", "added"])
        self.assertEqual(self.ctx.memory.count(), 1)
        self.ctx.settings.update({"memory": {"importance_threshold": 0.1}})
        self.fake.extraction_reply = lambda body: json.dumps({"memories": [{"text": "User asked about weather.", "importance": 0.2}]})
        self.assertEqual(self.ctx.extractor.process(conv["id"], "How is the weather today in general", "x")[0]["action"], "added")

    def test_dislike_then_like_supersedes_via_heuristics(self):
        self.fake.extraction_reply = lambda body: "this is not json at all"  # forces heuristic fallback
        conv = self.ctx.convs.create()
        a = self.ctx.extractor.process(conv["id"], "I don't like coffee.", "noted")
        self.assertEqual(a[0]["memory"]["text"], "User dislikes coffee.")
        b = self.ctx.extractor.process(conv["id"], "Actually I've started liking coffee!", "nice")
        self.assertEqual(b[0]["action"], "superseded")
        active = [m["text"] for m in self.ctx.memory.list()]
        self.assertEqual(active, ["User likes coffee."])
        history = self.ctx.memory.list(include_inactive=True)
        self.assertEqual(len(history), 2)
        old = next(m for m in history if not m["active"])
        self.assertEqual(old["superseded_by"], b[0]["memory"]["id"])
        # repeating the same preference reinforces instead of duplicating
        c = self.ctx.extractor.process(conv["id"], "I really like coffee, honestly.", "yes")
        self.assertEqual(self.ctx.memory.count(), 1, c)

    def test_llm_supersedes_by_id_and_dedupes(self):
        m = self.ctx.memory.add("User lives in Pune.", "fact", 0.8)

        def reply(body):
            prompt = body["messages"][-1]["content"]
            assert m["id"] in prompt  # the model is shown the related existing memory
            return json.dumps({"memories": [{"text": "User lives in Mumbai.", "category": "fact", "importance": 0.8,
                                              "supersedes_id": m["id"]}]})

        self.fake.extraction_reply = reply
        conv = self.ctx.convs.create()
        r = self.ctx.extractor.process(conv["id"], "I moved to Mumbai last month, I live in Mumbai now", "congrats")
        self.assertEqual(r[0]["action"], "superseded")
        self.assertEqual([x["text"] for x in self.ctx.memory.list()], ["User lives in Mumbai."])
        # exact duplicate -> reinforced, not added
        self.fake.extraction_reply = lambda body: json.dumps({"memories": [{"text": "User lives in Mumbai.", "importance": 0.8}]})
        r2 = self.ctx.extractor.process(conv["id"], "Yeah, still living in Mumbai these days", "ok")
        self.assertEqual(r2[0]["action"], "reinforced")
        self.assertEqual(self.ctx.memory.count(), 1)

    def test_manual_edit_delete_and_search(self):
        m = self.ctx.memory.add("User likes jazz.", "preference", 0.5, origin="manual")
        edited = self.ctx.memory.update(m["id"], text="User loves live jazz.", importance=0.9, category="bogus")
        self.assertEqual(edited["text"], "User loves live jazz.")
        self.assertEqual(edited["category"], "preference")  # invalid category ignored
        self.assertEqual([x["id"] for x in self.ctx.memory.list(q="live jazz")], [m["id"]])
        self.assertEqual([x["id"] for x in self.ctx.memory.list(q="100%")], [])
        self.assertTrue(self.ctx.memory.delete(m["id"]))
        self.assertEqual(self.ctx.memory.search("jazz music", min_similarity=0.0), [])
        with self.assertRaises(ValueError):
            self.ctx.memory.add("   ")

    def test_fallback_embeddings_and_reindex(self):
        """Without the embedding model memory still works (hash vectors) and upgrades itself later."""
        self.fake.embed_available = False
        self.ctx.memory.add("User loves watching horror movies.", "preference", 0.6)
        row = self.ctx.db.one("SELECT embedding_kind FROM memories")
        self.assertEqual(row["embedding_kind"], "hash")
        hits = self.ctx.memory.search("recommend a horror movie", min_similarity=0.2)
        self.assertEqual(len(hits), 1)
        self.fake.embed_available = True
        self.ctx.embedder._fail_until = 0  # retry window elapsed
        self.assertEqual(self.ctx.memory.reindex_stale(), 1)
        self.assertEqual(self.ctx.db.one("SELECT embedding_kind FROM memories")["embedding_kind"], "ollama:nomic-embed-text")
        self.assertEqual(len(self.ctx.memory.search("recommend a horror movie", min_similarity=0.2)), 1)

    def test_core_memory_always_available_and_limit(self):
        self.ctx.memory.add("User's name is Rahul.", "fact", 0.95)
        for i in range(8):
            self.ctx.memory.add(f"User likes topic number {i} about movies.", "preference", 0.5)
        hits = self.ctx.memory.search("what movie should I watch", limit=4, min_similarity=0.3)
        self.assertLessEqual(len(hits), 4)
        self.assertTrue(any("Rahul" in h["text"] for h in self.ctx.memory.search("random unrelated words", limit=4)))
