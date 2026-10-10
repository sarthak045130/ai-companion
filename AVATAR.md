# Video-call characters (new)

Click the camera icon at the top of the chat. Pick a character, press **Start call**.

- **Characters**: original anime-style girls and women, 15 of them: Nova, Mio, Aiko, Luna, Hana, Yuki, Rin, Sora, Kaede, Mei, Sayo, Neko, Ayame, Elara, Kira (3D, built from simple shapes; auto-falls back to a 2D look if WebGL is missing). Switch any time from the top bar. Add your own by copying an entry in `app/frontend/avatar/characters.js`.
- **They talk**: replies are spoken with your existing voice setting (the call turns voice on and restores it when you hang up). Lips follow the text, the face matches the mood of each sentence, and hands gesture (wave, nod, shrug, think...).
- **You talk**: mic button (uses the app's own mic/Whisper flow) or type in the call bar.
- **Camera (optional)**: wave and they wave back and say hi in the chat. With `bash scripts/fetch_vision_models.sh` run once, they also read your expression (smile, sad, surprised, frown) and hand gestures (thumbs-up, peace). Frames are processed on your computer and never saved or sent.

Changed existing files (2 lines total): `app/frontend/index.html` (one script tag) and `app/backend/server.py` (CSP now allows WebAssembly, needed only for the optional models). Everything else is new, in `app/frontend/avatar/`.
The prebuilt `dist/` and `build/` folders are untouched, so rebuild the app to include this feature (or run from source).
