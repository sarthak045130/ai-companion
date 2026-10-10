"""Decides what is worth remembering, then stores / reinforces / supersedes memories.

Primary path: ask the local LLM (JSON mode) to extract durable facts, showing
the most similar existing memories so it can say which one a new fact replaces.

Fallback path (LLM unavailable or unparseable): conservative regex heuristics.
Like/dislike contradictions are also detected deterministically.

The extractor intentionally prefers forgetting over storing weak or temporary
information. A good long-term memory should remain useful weeks or months later.
"""

from __future__ import annotations

import json
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from ..ai.ollama_client import OllamaClient, OllamaError
from .store import CATEGORIES, MemoryStore

log = logging.getLogger("companion.memory")


_FILLER = {
    "lol",
    "lmao",
    "haha",
    "hehe",
    "ok",
    "okay",
    "k",
    "yes",
    "no",
    "yeah",
    "yep",
    "nope",
    "thanks",
    "thank you",
    "thx",
    "hi",
    "hello",
    "hey",
    "bye",
    "cool",
    "nice",
    "hmm",
    "hm",
    "sure",
    "wow",
    "oh",
    "idk",
    "good",
    "fine",
}


EXTRACTION_SYSTEM = """You manage the long-term memory of a personal AI companion.

Your job is NOT to record everything the USER says.

Given the latest exchange, decide whether anything is genuinely worth remembering
about the USER for weeks or months from now.

Only save information that would make the companion meaningfully better at
understanding or helping the user in future conversations.

## Good things to remember

- Stable personal facts or identity information.
- Strong or recurring preferences and dislikes.
- Important people and relationships in the user's life.
- Ongoing projects, ambitions, plans, or meaningful goals.
- Important life events or experiences.
- Recurring interests that are likely to come up again.
- Meaningful personal stories.
- Recurring inside jokes or shared references.
- Important statements that reveal something durable about the user.

## Usually do NOT remember

- Greetings, farewells, thanks, filler, or small talk.
- One-off questions.
- Temporary activities happening only right now.
- Questions about Minecraft, games, coding, homework, etc. unless the user
  reveals a durable preference, project, goal, or recurring interest.
- Facts that matter only to the current conversation.
- Things the ASSISTANT said.
- General facts about the world.
- Advice the assistant gave the user.
- Guesses or assumptions about the user.
- Temporary moods unless the user clearly describes an ongoing pattern.
- A passing opinion that does not appear meaningful or durable.
- Repetitions of information already covered by an existing memory.

## Important rule

Ask yourself:

"If I met this user again several weeks from now, would remembering this
actually help me understand them or continue a conversation naturally?"

If the answer is probably no, DO NOT store it.

When uncertain, prefer NOT remembering.

Do not create memories merely because a topic appeared in the conversation.

For example:

USER: "I'm playing Minecraft tonight."
Do NOT remember this by itself.

USER: "Minecraft has been my favorite game for years."
This is worth remembering.

USER: "I'm building a huge survival castle that I'm planning to keep working
on."
This may be worth remembering as an ongoing project.

USER: "Oak is my favorite building material."
This is worth remembering as a preference.

USER: "Should I use oak or cherry for this wall?"
Do NOT remember the question itself.

Write each memory as one short, self-contained sentence starting with "User".

Examples:
"User enjoys Minecraft and has played it for years."
"User prefers oak for Minecraft builds."
"User is working on a large survival castle in Minecraft."
"User's name is Sarthak."

If a new fact CONTRADICTS or UPDATES an existing memory listed below,
set "supersedes_id" to that memory's id.

If a fact is already covered by an existing memory, omit it.

Do not manufacture a more specific memory than the user's words support.

Reply with JSON only, in this exact shape:

{
  "memories": [
    {
      "text": "...",
      "category": "fact|preference|event|person|relationship|story|topic|joke|statement|goal",
      "importance": 0.0-1.0,
      "confidence": 0.0-1.0,
      "supersedes_id": null
    }
  ]
}

Use {"memories": []} when nothing is worth remembering.

## Importance guide

0.9-1.0:
Core identity or highly important long-term information.

Examples:
- name
- close family / important relationships
- major long-term life facts

0.7-0.89:
Strong preferences, major ongoing projects, important goals,
meaningful events, or recurring personal interests.

0.4-0.69:
Useful but less important information that may still help future conversations.

Below 0.4:
Usually not worth storing.

Do not lower your standards just to produce a memory.
"""


# ---------------------------------------------------------------------------
# Heuristics
# ---------------------------------------------------------------------------


def is_trivial(text: str) -> bool:
    t = text.strip().lower().strip("!.?~ ")

    if len(t) < 8 or t in _FILLER:
        return True

    return not re.search(r"[a-z]{3}", t)


def _clean_obj(obj: str) -> str:
    obj = re.split(
        r"\s+(?:but|because|since|although|though|so that)\s+|[,;.!?]",
        obj,
        maxsplit=1,
    )[0]

    return re.sub(r"\s+", " ", obj).strip(" \"'")[:90]


_POS = {
    "love": "loves",
    "adore": "loves",
    "like": "likes",
    "enjoy": "enjoys",
}


_HEURISTICS: list[
    tuple[re.Pattern[str], Callable[[re.Match[str]], str | None], str, float]
] = [
    (
        re.compile(
            r"\bmy name is ([A-Za-z][\w'-]{1,30})",
            re.I,
        ),
        lambda m: f"User's name is {m.group(1).title()}",
        "fact",
        0.95,
    ),
    (
        re.compile(
            r"\bcall me ([A-Za-z][\w'-]{1,30})",
            re.I,
        ),
        lambda m: f"User likes to be called {m.group(1).title()}",
        "fact",
        0.9,
    ),
    (
        re.compile(
            r"\bi (?:really |absolutely |just )?(?:don't|do not|never) "
            r"(?:really )?(?:like|enjoy|love)\s+(.+)",
            re.I,
        ),
        lambda m: (
            f"User dislikes {_clean_obj(m.group(1))}"
            if _clean_obj(m.group(1))
            else None
        ),
        "preference",
        0.65,
    ),
    (
        re.compile(
            r"\bi (?:really |absolutely |just )?(?:hate|dislike|despise|can't stand)"
            r"\s+(.+)",
            re.I,
        ),
        lambda m: (
            f"User dislikes {_clean_obj(m.group(1))}"
            if _clean_obj(m.group(1))
            else None
        ),
        "preference",
        0.65,
    ),
    (
        re.compile(
            r"\bi(?:'ve| have)? (?:started|begun|come) "
            r"(?:to )?(?:like|liking|love|loving|enjoy|enjoying)\s+(.+)",
            re.I,
        ),
        lambda m: (
            f"User likes {_clean_obj(m.group(1))}"
            if _clean_obj(m.group(1))
            else None
        ),
        "preference",
        0.65,
    ),
    (
        re.compile(
            r"\bi (?:really |absolutely |just )?(love|adore|like|enjoy)\s+(.+)",
            re.I,
        ),
        lambda m: (
            f"User {_POS[m.group(1).lower()]} {_clean_obj(m.group(2))}"
            if _clean_obj(m.group(2))
            else None
        ),
        "preference",
        0.65,
    ),
    (
        re.compile(
            r"\bi (?:really |would really )?"
            r"(?:want|wanna|hope|plan|would love|'d love) to ([^.!?]+)",
            re.I,
        ),
        lambda m: (
            f"User wants to {_clean_obj(m.group(1))}"
            if _clean_obj(m.group(1))
            else None
        ),
        "goal",
        0.6,
    ),
    (
        re.compile(
            r"\bi live in ([^.,!?]+)",
            re.I,
        ),
        lambda m: f"User lives in {_clean_obj(m.group(1))}",
        "fact",
        0.8,
    ),
    (
        re.compile(
            r"\bi work (as|at|in|for) ([^.,!?]+)",
            re.I,
        ),
        lambda m: (
            f"User works {m.group(1).lower()} {_clean_obj(m.group(2))}"
        ),
        "fact",
        0.75,
    ),
    (
        re.compile(
            r"\bmy "
            r"(best friend|friend|sister|brother|mom|mother|dad|father|"
            r"wife|husband|girlfriend|boyfriend|dog|cat)"
            r"(?:'s name)? (?:is|was) (?:named |called )?"
            r"([A-Z][\w'-]{1,30})"
        ),
        lambda m: (
            f"User's {m.group(1).lower()} is named {m.group(2)}"
        ),
        "relationship",
        0.8,
    ),
]


def heuristic_extract(user_text: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    for sentence in re.split(r"(?<=[.!?])\s+|\n+", user_text):
        sentence = sentence.strip()

        if not sentence or sentence.endswith("?"):
            continue

        for pattern, fmt, category, importance in _HEURISTICS:
            m = pattern.search(sentence)

            if m:
                text = fmt(m)

                if text:
                    out.append(
                        {
                            "text": text.rstrip(".") + ".",
                            "category": category,
                            "importance": importance,
                            "confidence": 0.6,
                            "supersedes_id": None,
                        }
                    )

                break  # one memory per sentence

    return out


# like / dislike contradiction detection --------------------------------------

_PREF = re.compile(
    r"^User (likes|loves|enjoys|dislikes) (.+?)\.?$",
    re.I,
)


def _norm_obj(obj: str) -> str:
    obj = re.sub(r"\b(the|a|an|to)\b", " ", obj.lower())
    obj = re.sub(r"[^a-z0-9 ]", "", obj)
    obj = re.sub(r"\s+", " ", obj).strip()

    return obj[:-1] if obj.endswith("s") and len(obj) > 3 else obj


def parse_preference(text: str) -> tuple[bool, str] | None:
    m = _PREF.match(text.strip())

    if not m:
        return None

    return (
        m.group(1).lower() != "dislikes",
        _norm_obj(m.group(2)),
    )


# ---------------------------------------------------------------------------
# Memory extractor
# ---------------------------------------------------------------------------


class MemoryExtractor:
    def __init__(
        self,
        store: MemoryStore,
        client: OllamaClient,
        settings_getter: Callable[[], dict[str, Any]],
        chat_model_getter: Callable[[], str],
    ):
        self.store = store
        self.client = client
        self._memory_settings = settings_getter
        self._chat_model = chat_model_getter

        self._pool = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="memory-extract",
        )

        self._pending = 0
        self._lock = threading.Lock()
        self.last_error: str | None = None

    @property
    def pending(self) -> int:
        return self._pending

    def submit(
        self,
        conversation_id: str,
        user_text: str,
        assistant_text: str,
    ) -> None:
        """Run extraction in the background so replies are never delayed."""

        with self._lock:
            self._pending += 1

        def job() -> None:
            try:
                self.process(
                    conversation_id,
                    user_text,
                    assistant_text,
                )
            except Exception:  # noqa: BLE001
                log.exception("memory extraction failed")
            finally:
                with self._lock:
                    self._pending -= 1

        self._pool.submit(job)

    def wait_idle(self, timeout: float = 30.0) -> bool:
        import time

        end = time.time() + timeout

        while self._pending and time.time() < end:
            time.sleep(0.02)

        return self._pending == 0

    def shutdown(self) -> None:
        self._pool.shutdown(
            wait=True,
            cancel_futures=False,
        )

    # ---- core ------------------------------------------------------------

    def process(
        self,
        conversation_id: str,
        user_text: str,
        assistant_text: str,
    ) -> list[dict[str, Any]]:
        cfg = self._memory_settings()

        if not cfg.get("enabled") or is_trivial(user_text):
            return []

        candidates = self._llm_extract(
            cfg,
            user_text,
            assistant_text,
        )

        if candidates is None:
            candidates = heuristic_extract(user_text)

        threshold = float(
            cfg.get("importance_threshold", 0.4)
        )

        actions = []

        for item in candidates:
            action = self._apply(
                item,
                threshold,
                conversation_id,
            )

            if action:
                actions.append(action)

        return actions

    def _llm_extract(
        self,
        cfg: dict[str, Any],
        user_text: str,
        assistant_text: str,
    ) -> list[dict[str, Any]] | None:
        model = cfg.get("extraction_model") or self._chat_model()

        if not model:
            return None

        similar = self.store.find_similar(
            user_text,
            top=5,
            min_similarity=0.15,
        )

        # Embeddings can miss a contradiction, so also show the few
        # most recently touched memories.
        seen = {m["id"] for m in similar}

        recent = [
            m
            for m in self.store.list(
                order="updated",
                limit=3,
            )
            if m["id"] not in seen
        ]

        existing = (
            "\n".join(
                f'- id={m["id"]}: {m["text"]}'
                for m in [*similar, *recent]
            )
            or "(none)"
        )

        prompt = (
            f"Existing memories (most related first):\n{existing}\n\n"
            f"Latest exchange:\n"
            f"USER: {user_text.strip()[:2000]}\n"
            f"ASSISTANT: {assistant_text.strip()[:1000]}\n\n"
            "Return the JSON now."
        )

        try:
            raw = self.client.chat(
                model,
                [
                    {
                        "role": "system",
                        "content": EXTRACTION_SYSTEM,
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    },
                ],
                options={
                    "temperature": 0.1,
                    "num_predict": 1500,
                },
                fmt="json",
                think=False,
            )

        except OllamaError as exc:
            self.last_error = str(exc)
            return None

        return self._parse(raw)

    @staticmethod
    def _parse(raw: str) -> list[dict[str, Any]] | None:
        raw = re.sub(
            r"<think>.*?</think>",
            "",
            raw,
            flags=re.S,
        ).strip()

        start = raw.find("{")
        end = raw.rfind("}")

        if start == -1 or end <= start:
            return None

        try:
            data = json.loads(
                raw[start : end + 1]
            )
        except ValueError:
            return None

        items = (
            data.get("memories")
            if isinstance(data, dict)
            else None
        )

        if not isinstance(items, list):
            return None

        return [
            i
            for i in items
            if isinstance(i, dict)
            and isinstance(i.get("text"), str)
        ]

    def _apply(
        self,
        item: dict[str, Any],
        threshold: float,
        conversation_id: str,
    ) -> dict[str, Any] | None:
        text = re.sub(
            r"\s+",
            " ",
            str(item.get("text", "")),
        ).strip()

        if not text or len(text) > 300:
            return None

        category = (
            item.get("category")
            if item.get("category") in CATEGORIES
            else "fact"
        )

        try:
            importance = max(
                0.0,
                min(
                    1.0,
                    float(item.get("importance", 0.5)),
                ),
            )

            confidence = max(
                0.0,
                min(
                    1.0,
                    float(item.get("confidence", 0.7)),
                ),
            )

        except (TypeError, ValueError):
            importance, confidence = 0.5, 0.7

        if importance < threshold:
            return {
                "action": "ignored",
                "reason": "below importance threshold",
                "text": text,
            }

        fields = dict(
            text=text,
            category=category,
            importance=importance,
            confidence=confidence,
            source_conversation=conversation_id,
        )

        # 1. Explicit supersede from the LLM.
        old_id = item.get("supersedes_id")

        if old_id:
            old = self.store.get(str(old_id))

            if old and old["active"]:
                return {
                    "action": "superseded",
                    "memory": self.store.supersede(
                        old["id"],
                        **fields,
                    ),
                    "old": old,
                }

        # 2. Deterministic like/dislike contradiction or duplicate.
        pref = parse_preference(text)
        active = self.store.active_texts()

        if pref:
            for old in active:
                old_pref = parse_preference(old["text"])

                if old_pref and old_pref[1] == pref[1]:
                    if old_pref[0] != pref[0]:
                        return {
                            "action": "superseded",
                            "memory": self.store.supersede(
                                old["id"],
                                **fields,
                            ),
                            "old": old,
                        }

                    return {
                        "action": "reinforced",
                        "memory": self.store.reinforce(
                            old["id"],
                            importance,
                        ),
                    }

        # 3. Near-duplicate by meaning.
        for sim in self.store.find_similar(
            text,
            top=1,
        ):
            if (
                sim["similarity"] >= 0.92
                or _norm_text(sim["text"]) == _norm_text(text)
            ):
                return {
                    "action": "reinforced",
                    "memory": self.store.reinforce(
                        sim["id"],
                        importance,
                    ),
                }

        return {
            "action": "added",
            "memory": self.store.add(**fields),
        }


def _norm_text(text: str) -> str:
    return re.sub(
        r"[^a-z0-9 ]",
        "",
        text.lower(),
    ).strip()