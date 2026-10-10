# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files

ROOT = Path(SPECPATH)

a = Analysis(
    [str(ROOT / "launch_nova.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        (str(ROOT / "app" / "frontend"), "app/frontend"),
        (str(ROOT / "personality" / "personality.json"), "personality"),
    ] + collect_data_files("faster_whisper", includes=["assets/silero_vad_v6.onnx"]),
    hiddenimports=[
        "webview",
        "webview.platforms.cocoa",
        "objc",
        "AVFoundation",
        "Cocoa",
        "Quartz",
        "sounddevice",
        "faster_whisper",
        "ctranslate2",
        "huggingface_hub",
        "tokenizers",
        "av",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Nova",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Nova",
)

app = BUNDLE(
    coll,
    name="Nova.app",
    icon=None,
    bundle_identifier="com.sarthak.nova",
    version="1.0.0",
    info_plist={
        "CFBundleDisplayName": "Nova",
        "NSCameraUsageDescription": "Nova uses the camera during a video call when you choose to turn it on.",
        "NSMicrophoneUsageDescription": "Nova uses the microphone when you choose voice input.",
        "LSMinimumSystemVersion": "12.0",
    },
)
