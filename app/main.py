"""Desktop entry point: starts the local backend and opens it in a native window."""
from __future__ import annotations

import argparse
import logging
import sys
import threading
import webbrowser

from .backend.server import Server
from .core import create_context


def _make_server(ctx, port: int) -> Server:
    try:
        return Server(ctx, port=port)
    except OSError:
        return Server(ctx, port=0)  # preferred port busy: take any free one


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ai-companion")
    parser.add_argument("--port", type=int, default=8765, help="preferred local port (default 8765)")
    parser.add_argument("--data-dir", help="where conversations, memories and settings are stored")
    parser.add_argument("--personality", help="path to a personality.json")
    parser.add_argument("--no-window", action="store_true", help="run the backend only and open your browser")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(name)s: %(message)s")
    ctx = create_context(args.data_dir, args.personality)
    server = _make_server(ctx, args.port)
    server.start()
    ctx.background_startup()
    print(f"AI Companion running at {server.url}  (data: {ctx.data_dir})", flush=True)

    try:
        if args.no_window:
            webbrowser.open(server.url)
            threading.Event().wait()
        else:
            try:
                import webview  # type: ignore  # pywebview
            except ImportError:
                print("pywebview isn't installed, opening your browser instead (pip install pywebview).", file=sys.stderr)
                webbrowser.open(server.url)
                threading.Event().wait()
            else:
                webview.create_window(
                    "AI Companion", server.url, width=1200, height=800, min_size=(860, 580), background_color="#0d0f14"
                )
                webview.start()
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
