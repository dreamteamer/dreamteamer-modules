# @dreamteamer/recordings

Audio recordings of your meetings, each matched to its meeting and transcribed on your own machine:
Hebrew and English, speakers told apart.

```bash
npm install @dreamteamer/recordings @dreamteamer/meetings @dreamteamer/contacts @dreamteamer/companies @dreamteamer/users @dreamteamer/assets
npx dreamteamer compile
```

## the flow

1. Drop audio into `<an INBOX_FOLDERS root>/meeting-recordings/`, named `[date] [who]` where you can
   (`2026 08 30 1500 Northwind weekly.m4a`, `Dana Oren jul22.m4a`; a Hebrew month name works too).
2. `/fetch-new-recordings` — dedupes by content hash, archives each new file under
   `${env:FILES_FOLDER}/meeting-recordings/`, moves the original to the inbox root's `trash/`, and
   creates a `meeting-recordings` record.
3. `/match-recording-to-meeting` — links each recording to its meeting.
4. `/transcribe-recording` — writes the transcript into the recording record. On Apple Silicon with
   `whisper-cli`, recognition runs on the GPU (`--engine auto`, the default); elsewhere on the CPU.

A file handed straight to a session, or a pasted transcript, skips the inbox: the
`transcribing-recordings` skill covers both.

| alone | with others |
|---|---|
| recordings pulled from an inbox by content hash, matched to their meeting, transcribed; each meeting's `recordings` list generated from the recordings that point at it | **meeting-docs** reads the transcript: summarise, extract tasks, critique |

| needs | for |
|---|---|
| `@dreamteamer/meetings` (and what it needs) | the meeting a recording belongs to |
| `INBOX_FOLDERS` and `FILES_FOLDER`, declared in your workspace's `dreamteamer.vars` | where recordings arrive (a newline-separated list of roots) and where they are archived (a local folder) |
| `ffmpeg`, `ffprobe`, `uv` and about 1.6 GB of models, downloaded once | transcribing audio; a pasted transcript needs only `uv` |
| optional: `TRANSCRIPTION_HOME`, default `~/.cache/dreamteamer/transcription` | the one folder the transcriber keeps outside the package: `models/` (`diarization/`, `whisper-ct2/`, `whisper-ggml/`), `venv/` (reaching uv as `UV_PROJECT_ENVIRONMENT`, which the skill's preamble exports) and `asr/`, the raw recognizer output of each run. Copy `models/` to bring a machine up; delete the folder to uninstall |
| optional, on Apple Silicon: `whisper-cli` (`brew install whisper-cpp`) and 1.6 GB more of weights, which the model download fetches when the binary is there | the GPU pass — recognition on Metal, four to five times faster than the CPU pass on an M4 Pro; without it the CPU pass runs as before, and `auto` says why in one line, the summary and the record |

## setup

Recording records, inbox ingestion and matching work with no setup. Transcribing audio needs this
machine prepared once, and the module declares that as its setup unit, `recordings`:

```bash
npx dreamteamer setup recordings --input files_folder=<folder> --allow download --allow machine
npx dreamteamer setup recordings --verify --allow machine    # one CPU transcription of a shipped synthetic clip
npx dreamteamer status                                       # the unit's line: configured, blocked or ready
```

`ffmpeg` and `uv` have to be on PATH first; the unit reads `blocked` until they are. The first command
writes `FILES_FOLDER` and `TRANSCRIPTION_HOME` into `.env` (and `INBOX_FOLDERS`, given
`--input inbox_folders=…`), provisions the Python environment and downloads the models; each download
or machine change waits for its own `--allow`. [SETUP.md](SETUP.md) lists the inputs, the checks and
what each status means, and the `ingesting-recordings` and `transcribing-recordings` skills carry the
procedures behind the three slash commands of the flow.

## 0.5.1 — the nav is nav.yaml (cr-dt-008)

`display.nav.order` and `display.nav.section` removed from its descriptor — the nav is `nav.yaml` at the workspace root (engine 0.49), which you arrange; `display.nav.icon` stays. Nothing to do.

## 0.5.0 — on engine 0.48.0: the engine writes `.env` (CR-dt-007)

Nothing to do but `dt update @dreamteamer/recordings` on dreamteamer 0.48.0 or later, then `dt compile`; nothing a
workspace's records do changes. `set-home` is now an env action the engine writes into `.env` (a multi-line `INBOX_FOLDERS` is left as it is when nothing changed); `apply` runs the venv, the download and the CPU check only. Also in this release: hub-cache weights kept as a snapshot symlink read as on disk, and `set-home` no longer reports a write on every run when `INBOX_FOLDERS` is a multi-line quoted value.

## 0.4.0 — on engine 0.47.0 (CLI-first module lifecycle, CR-dt-006)

Nothing to do but `dt compile` after `dt update @dreamteamer/recordings` on dreamteamer 0.47.0 or later (the engine floor is `>=0.47.0`). New: the `recordings` setup unit: `dt install @dreamteamer/recordings --input files_folder=… --allow download --allow machine` provisions the venv and the models under TRANSCRIPTION_HOME (outside the workspace — a home inside it is refused); `dt setup recordings --verify --allow machine` transcribes a shipped synthetic clip on the CPU and writes the receipt.
