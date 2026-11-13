# Setting up recordings

Recording records, inbox ingestion and matching work with no setup. Offline transcription needs this
machine prepared, and the module declares that as its **setup unit** (`dt status` lists it as
`recordings`); the engine drives it — nothing here is a command to type by hand except these:

```bash
dt install @dreamteamer/recordings --input files_folder=<folder> --allow download --allow machine
dt setup recordings --verify --allow machine        # one CPU transcription of the shipped clip
```

- **Inputs:** `files_folder` (FILES_FOLDER, required — where recordings are archived), `inbox_folders`
  (INBOX_FOLDERS, optional), `transcription_home` (TRANSCRIPTION_HOME, default
  `~/.cache/dreamteamer/transcription` — the models and the venv, outside the workspace and outside
  `node_modules`, so neither compile nor npm touches them).
- **Checks:** `ffmpeg` and `uv` on PATH (blocked until they are — `brew install ffmpeg uv`); the three
  keys in `.env`; the venv; the CPU pass's three model files; the CPU run's receipt.
- **Actions and their effects:** `set-home` writes the keys into `.env` (workspace-files);
  `provision-venv` runs `uv sync` (machine); `download-models` fetches ~1.6 GB (download);
  `verify-cpu` transcribes `lib/clip.wav` — generated speech, nobody's voice — on the CPU and keeps a
  dated receipt (machine). The GPU pass is not set up here.
- **Reading `dt status`:** `configured` with "CPU run unverified" means the models are on disk and
  never ran; `ready · verified <date>` means they did, on this computer, that day.

Every command runs through `bin/transcribe.mjs`, which reads `.env` and sets `UV_PROJECT_ENVIRONMENT`
before spawning uv; the skill's commands go through the same entry.
