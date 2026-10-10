import os
import stat
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from app.voice.stt import SAMPLE_RATE, SpeechToText, VoiceError
from app.voice.tts import TTS, clean_for_speech, parse_say_voices

SAY_OUTPUT = (
    "Alex                en_US    # Most people recognize me by my voice.\n"
    "Eddy (English (US)) en_US    # Hello, my name is Eddy.\n"
    "Kyoko               ja_JP    # こんにちは\n"
)


class TextTests(unittest.TestCase):
    def test_parse_voices(self):
        voices = parse_say_voices(SAY_OUTPUT)
        self.assertEqual([v["name"] for v in voices], ["Alex", "Eddy (English (US))", "Kyoko"])
        self.assertEqual(voices[2]["lang"], "ja-JP")

    def test_clean_for_speech(self):
        text = "Hey **there** 😊! See https://example.com and `code`.\n```py\nprint(1)\n```\n- item one"
        out = clean_for_speech(text)
        self.assertNotIn("**", out)
        self.assertNotIn("😊", out)
        self.assertNotIn("https", out)
        self.assertIn("code omitted", out)
        self.assertNotIn("print(1)", out)


class TTSTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        script = self.tmp / "say"
        script.write_text(
            "#!/bin/sh\n"
            'if [ "$1" = "-v" ] && [ "$2" = "?" ]; then printf \'%s\' "$FAKE_VOICES"; exit 0; fi\n'
            'echo "$@" > "$TMPD/args"\ncat > "$TMPD/stdin"\nsleep "${FAKE_SLEEP:-0}"\n'
        )
        script.chmod(script.stat().st_mode | stat.S_IEXEC)
        env = {"PATH": f"{self.tmp}:{os.environ['PATH']}", "TMPD": str(self.tmp), "FAKE_VOICES": SAY_OUTPUT}
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.settings = {"tts_voice": "", "tts_rate": 175}
        self.tts = TTS(lambda: self.settings)

    def wait_file(self, name):
        path = self.tmp / name
        for _ in range(100):
            if path.exists() and path.read_text():
                return path.read_text()
            time.sleep(0.02)
        self.fail(f"{name} was never written")

    def test_speak_uses_voice_rate_and_stdin(self):
        self.assertTrue(self.tts.available)
        self.assertEqual(self.tts.backend, "say")
        self.assertTrue(self.tts.speak("Hello **world** 😊", voice="Alex", rate=210))
        self.assertEqual(self.wait_file("args").strip(), "-v Alex -r 210 -f -")
        self.assertEqual(self.wait_file("stdin").strip(), "Hello world")

    def test_unknown_voice_never_reaches_command_line(self):
        self.tts.speak("hi there", voice="--evil-flag")
        args = self.wait_file("args")
        self.assertNotIn("evil", args)
        self.assertNotIn("-v", args)

    def test_stop_terminates_playback(self):
        with mock.patch.dict(os.environ, {"FAKE_SLEEP": "5"}):
            self.tts.speak("a long sentence to speak")
            self.wait_file("args")
            self.assertTrue(self.tts.speaking)
            self.tts.stop()
            self.assertFalse(self.tts.speaking)

    def test_unavailable_engine(self):
        with mock.patch.dict(os.environ, {"PATH": "/nonexistent"}):
            tts = TTS(lambda: self.settings)
            self.assertFalse(tts.available)
            self.assertFalse(tts.speak("hi"))


class FakeRecorder:
    def __init__(self, audio):
        self.audio, self.recording, self.level = audio, False, 0.0

    def start(self, device=None):
        self.recording = True

    def stop(self):
        self.recording = False
        return self.audio

    def cancel(self):
        self.recording = False

    def devices(self):
        return [{"index": 0, "name": "Fake Mic"}]


class FakeTranscriber:
    def __init__(self, text="hello from the mic"):
        self.text = text

    def available(self):
        return True

    def transcribe(self, audio):
        return self.text


def tone(seconds, amp=3000):
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    return (amp * np.sin(2 * np.pi * 220 * t)).astype(np.int16)


class STTTests(unittest.TestCase):
    def make(self, audio, text="hello from the mic"):
        return SpeechToText(lambda: {"input_device": None}, FakeRecorder(audio), FakeTranscriber(text))

    def test_success(self):
        stt = self.make(tone(1.0))
        stt.start()
        self.assertTrue(stt.recorder.recording)
        self.assertEqual(stt.stop_and_transcribe(), "hello from the mic")

    def test_silence_points_to_permissions(self):
        with self.assertRaises(VoiceError) as cm:
            self.make(np.zeros(SAMPLE_RATE, dtype=np.int16)).stop_and_transcribe()
        self.assertIn("permission", str(cm.exception).lower())

    def test_too_short_and_no_speech(self):
        with self.assertRaises(VoiceError):
            self.make(tone(0.1)).stop_and_transcribe()
        with self.assertRaises(VoiceError):
            self.make(tone(1.0), text="").stop_and_transcribe()

    def test_cancel(self):
        stt = self.make(tone(1.0))
        stt.start()
        stt.cancel()
        self.assertFalse(stt.recorder.recording)


if __name__ == "__main__":
    unittest.main()
