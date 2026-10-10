#!/usr/bin/env bash
# Optional: downloads Google's MediaPipe face + hand models so the video call can read facial expressions and
# real hand gestures (thumbs-up, peace sign, hand-based waving). Without it, wave detection still works from motion.
# Needs internet once; afterwards everything runs offline. Run from the project folder:  bash scripts/fetch_vision_models.sh
set -euo pipefail
DEST="app/frontend/avatar/vendor/mediapipe"; VER="0.10.14"
mkdir -p "$DEST/wasm"; rm -f "$DEST/READY"
CDN="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@$VER"
curl -fL "$CDN/vision_bundle.mjs" -o "$DEST/vision_bundle.mjs"
for f in vision_wasm_internal.js vision_wasm_internal.wasm vision_wasm_nosimd_internal.js vision_wasm_nosimd_internal.wasm; do
  curl -fL "$CDN/wasm/$f" -o "$DEST/wasm/$f"
done
curl -fL "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task" -o "$DEST/face_landmarker.task"
curl -fL "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" -o "$DEST/hand_landmarker.task"
echo ok > "$DEST/READY"; echo "Done. Restart the app, then start a video call with the camera on."
