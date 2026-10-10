from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from app.core import AppContext, create_context
from tests.fake_ollama import FakeOllama


class AppTestCase(unittest.TestCase):
    """Creates an isolated data dir and a fake Ollama for each test."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="companion-test-"))
        self.fake = FakeOllama()
        self.ctx = self.new_ctx()
        self.addCleanup(self.cleanup)

    def new_ctx(self, **kw) -> AppContext:
        ctx = create_context(self.tmp / "data", self.tmp / "personality.json", **kw)
        ctx.settings.update({"ai": {"base_url": self.fake.url, "model": "fake-chat:latest"}})
        return ctx

    def cleanup(self) -> None:
        try:
            self.ctx.close()
        except Exception:  # noqa: BLE001
            pass
        self.fake.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def restart(self, **kw) -> AppContext:
        """Simulate quitting and relaunching the app against the same data directory."""
        self.ctx.extractor.wait_idle()
        self.ctx.close()
        self.ctx = self.new_ctx(**kw)
        return self.ctx
