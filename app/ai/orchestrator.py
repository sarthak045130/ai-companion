"""The response pipeline:

user message -> conversation context -> retrieve memories -> personality -> LLM (streamed)
-> save reply -> background memory extraction.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Iterator

from ..config.personality import PersonalityStore
from ..config.settings import SettingsStore
from ..database.conversations import ConversationStore
from ..memory.extractor import MemoryExtractor
from ..memory.store import MemoryStore
from .ollama_client import OllamaClient, OllamaError

log = logging.getLogger("companion.ai")


class ThinkStripper:
    """Removes <think>...</think> blocks from a token stream, even when tags are split across chunks."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self) -> None:
        self.buf = ""
        self.inside = False
        self._emitted = False

    def _out(self, text: str) -> str:
        if not self._emitted:
            text = text.lstrip()
            if text:
                self._emitted = True
        return text

    def feed(self, chunk: str) -> str:
        self.buf += chunk
        out: list[str] = []

        while True:
            if self.inside:
                i = self.buf.find(self.CLOSE)

                if i == -1:
                    keep = len(self.CLOSE) - 1
                    self.buf = self.buf[-keep:] if len(self.buf) > keep else self.buf
                    break

                self.buf = self.buf[i + len(self.CLOSE):]
                self.inside = False

            else:
                i = self.buf.find(self.OPEN)

                if i == -1:
                    hold = 0

                    for n in range(
                        min(len(self.OPEN) - 1, len(self.buf)),
                        0,
                        -1,
                    ):
                        if self.OPEN.startswith(self.buf[-n:]):
                            hold = n
                            break

                    out.append(self.buf[: len(self.buf) - hold])
                    self.buf = self.buf[len(self.buf) - hold:]
                    break

                out.append(self.buf[:i])
                self.buf = self.buf[i + len(self.OPEN):]
                self.inside = True

        return self._out("".join(out))

    def flush(self) -> str:
        rest = "" if self.inside else self.buf
        self.buf = ""
        return self._out(rest)


def make_title(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()

    if len(text) <= 48:
        return text or "New chat"

    return text[:48].rsplit(" ", 1)[0].rstrip(",.;:") + "…"


class Companion:
    def __init__(
        self,
        convs: ConversationStore,
        memory: MemoryStore,
        extractor: MemoryExtractor,
        personality: PersonalityStore,
        settings: SettingsStore,
        client: OllamaClient,
    ):
        self.convs = convs
        self.memory = memory
        self.extractor = extractor
        self.personality = personality
        self.settings = settings
        self.client = client

    # ---- prompt assembly -----------------------------------------------

    def build_messages(
        self,
        user_text: str,
        history: list[dict[str, Any]],
        memories: list[dict[str, Any]],
        older_context: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, str]]:
        ai = self.settings.section("ai")

        system = self.personality.build_context(
            ai.get("system_prompt_extra", "")
        )

        system += (
            f"\n\nCurrent date and time: "
            f"{datetime.now().strftime('%A, %d %B %Y, %H:%M')}"
        )

        if memories:
            system += (
                "\n\n## What you remember about the user "
                "(from earlier conversations)\n"
                + "\n".join(f"- {m['text']}" for m in memories)
                + "\nUse these naturally and only when relevant; "
                "don't recite them as a list or announce that you "
                "are 'accessing memory'. If the user contradicts a "
                "memory, trust the user."
            )

        # Older messages are supplied separately from the normal recent
        # conversation history so the model can distinguish them.
        if older_context:
            system += (
                "\n\n## Relevant earlier messages from this conversation\n"
                "These are older messages retrieved because they may be "
                "relevant to what the user is asking now. Treat them as "
                "conversation context, not as permanent memories. "
                "Use them only when they actually help answer the current "
                "message.\n"
                + "\n".join(
                    f"- {m['role']}: {m['content']}"
                    for m in older_context
                )
            )

        budget = (
            int((ai["context_length"] - ai["max_tokens"]) * 3.2)
            - len(system)
            - len(user_text)
        )

        kept: list[dict[str, str]] = []
        used = 0

        for msg in reversed(history):
            if msg["role"] not in ("user", "assistant"):
                continue

            used += len(msg["content"]) + 8

            if used > budget and kept:
                break

            kept.append(
                {
                    "role": msg["role"],
                    "content": msg["content"],
                }
            )

        kept.reverse()

        return [
            {"role": "system", "content": system},
            *kept,
            {"role": "user", "content": user_text},
        ]

    # ---- main entry ------------------------------------------------------

    def stream_reply(
        self,
        conversation_id: str | None,
        user_text: str,
    ) -> Iterator[dict[str, Any]]:
        user_text = (user_text or "").strip()

        if not user_text:
            yield {
                "type": "error",
                "code": "empty",
                "message": "Message is empty.",
            }
            return

        conv = (
            self.convs.get(conversation_id)
            if conversation_id
            else None
        )

        if conv is None:
            conv = self.convs.create()

        ai = self.settings.section("ai")
        mem_cfg = self.settings.section("memory")

        # Recent conversation context.
        history = self.convs.messages(
            conv["id"],
            limit=ai["history_messages"],
        )

        is_first = not history and conv["title"] == "New chat"

        user_msg = self.convs.add_message(
            conv["id"],
            "user",
            user_text,
        )

        if is_first:
            conv = self.convs.rename(
                conv["id"],
                make_title(user_text),
            ) or conv

        yield {
            "type": "start",
            "conversation": conv,
            "user_message": user_msg,
        }

        # ---------------------------------------------------------------
        # Retrieve older relevant messages from this SAME conversation.
        #
        # Recent history is already supplied above. This search only
        # supplements it when an older message may be relevant.
        # ---------------------------------------------------------------

        older_context: list[dict[str, Any]] = []

        try:
            total_messages = self.convs.message_count(conv["id"])

            if total_messages > len(history) + 1:
                older_context = self.convs.search_messages(
                    conv["id"],
                    user_text,
                    limit=6,
                )

                # Don't duplicate anything already present in recent
                # history. Compare using message IDs.
                recent_ids = {
                    m["id"]
                    for m in history
                    if "id" in m
                }

                older_context = [
                    m
                    for m in older_context
                    if m.get("id") not in recent_ids
                ]

        except Exception:  # noqa: BLE001
            log.exception("conversation context retrieval failed")

        # ---------------------------------------------------------------
        # Long-term memory retrieval.
        # ---------------------------------------------------------------

        memories: list[dict[str, Any]] = []

        if mem_cfg["enabled"] and mem_cfg["retrieval_limit"] > 0:
            # Build a compact semantic query from the recent conversation.
            # This helps resolve references like "that", "again",
            # "the other one", etc.
            recent_context = [
                m["content"].strip()
                for m in history[-6:]
                if m["role"] in ("user", "assistant")
                and m["content"].strip()
            ]

            query_parts = recent_context + [user_text]
            query = "\n".join(query_parts)[-1800:]

            try:
                memories = self.memory.search(
                    query,
                    limit=mem_cfg["retrieval_limit"],
                    min_similarity=mem_cfg["min_similarity"],
                )
            except Exception:  # noqa: BLE001
                log.exception("memory retrieval failed")

        yield {
            "type": "memories",
            "items": [
                {
                    "id": m["id"],
                    "text": m["text"],
                    "category": m["category"],
                    "score": m["score"],
                }
                for m in memories
            ],
        }

        messages = self.build_messages(
            user_text,
            history,
            memories,
            older_context,
        )

        options = {
            "num_ctx": ai["context_length"],
            "temperature": ai["temperature"],
            "top_p": ai["top_p"],
            "num_predict": ai["max_tokens"],
        }

        stripper = ThinkStripper()
        parts: list[str] = []
        completed = False
        error: OllamaError | None = None

        try:
            for kind, payload in self.client.chat_stream(
                ai["model"],
                messages,
                options,
                think=False,
            ):
                if kind == "content":
                    text = stripper.feed(payload)

                    if text:
                        parts.append(text)
                        yield {
                            "type": "token",
                            "text": text,
                        }

                elif kind == "done":
                    break

            tail = stripper.flush()

            if tail:
                parts.append(tail)
                yield {
                    "type": "token",
                    "text": tail,
                }

            completed = True

        except OllamaError as exc:
            error = exc

        finally:
            # Also runs when the client disconnects mid-stream
            # (Stop button): keep what was generated.
            reply = "".join(parts).strip()
            saved = None

            if reply:
                saved = self.convs.add_message(
                    conv["id"],
                    "assistant",
                    reply,
                    meta={
                        "model": ai["model"],
                        "memories_used": [
                            m["id"]
                            for m in memories
                        ],
                        "context_messages_used": [
                            m["id"]
                            for m in older_context
                        ],
                        "interrupted": not completed,
                    },
                )

                if completed:
                    self.extractor.submit(
                        conv["id"],
                        user_text,
                        reply,
                    )

        conv = self.convs.get(conv["id"]) or conv

        if error is not None:
            yield {
                "type": "error",
                "code": error.code,
                "message": str(error),
                "message_saved": saved,
            }

        elif saved is None:
            yield {
                "type": "error",
                "code": "empty_reply",
                "message": "The model returned an empty reply. Try again.",
            }

        else:
            yield {
                "type": "done",
                "message": saved,
                "conversation": conv,
            }