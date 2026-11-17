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
   `whisper-cli`, recognition runs on the GPU (`--engine auto`, the default); elsewhere on the CPU. It writes
   no name.
5. `/identify-speakers` — names the speakers from voice prints kept on this computer, checked against the
   meeting's attendees, and asks about the rest in one question at the end of the run. See
   [Voice prints](#voice-prints) before the first answer.

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
| optional: `VOICE_PRINTS_HOME`, default per platform (below) | the voice-print store, one folder per user shared by all their workspaces; a workspace whose `.env` sets its own value has its own store, and then its workspaces no longer know each other's voices |
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
what each status means, and the `ingesting-recordings`, `transcribing-recordings` and `identifying-speakers`
skills carry the procedures behind the slash commands of the flow.

## Voice prints

This module can name the speakers in a transcript by their voices.

- **Confirming a name stores a voice print.** When you tell the module who a speaker is, it writes the name
  on the transcript and stores a *voice print* of that person on this computer, so it can recognise them in
  later recordings. It does this for you and for anyone else you name. It does not ask the person, and it does
  not ask you a second time. The reply to each confirmation says whose voice print was stored or changed.
- **A voice print is biometric data.** It is a numeric summary of a person's voice. It identifies them, and
  unlike a password it cannot be changed. In many places storing one is regulated and may need the person's
  agreement. **You are responsible for having the right to store a voice print of each person you name, under
  the law where you and they live.** This module does not check.
- **What the folder holds.** One folder under your user account (`VOICE_PRINTS_HOME`; the defaults are listed
  below), shared by all your workspaces. It holds, for each person you named: their voice print, the name and
  reference each workspace knows them by, and which recordings it was built from. And for **every speaker of
  every recording you transcribe, named or not**: numeric summaries of their voice, with the workspace and
  record name of the recording.
- **Any of your workspaces can use what another stored.** A person you named in one workspace can be
  recognised in another. A workspace's messages name only the people that workspace knows.
- **This module sends the folder nowhere.** It is never written to a record, to git or to an export. The
  module refuses to use a folder inside a repository or inside a folder it can recognise as synced or
  cloud-backed, and on a Mac it excludes the folder from Time Machine. It cannot stop another backup tool, a
  disk clone or a migration to a new computer from copying it. That is yours to check.
- **To delete one person:** `prints forget <person>`. It deletes their voice print, and their voice from the
  recordings it was built from and from this workspace's recordings that name them. It leaves their name on
  your transcripts, and their voice in recordings of other workspaces where they were never confirmed; it tells
  you how many such workspaces there are, and you run it there too. After it, no workspace can rebuild their
  voice print from confirmations made before, and transcribing one of this workspace's recordings again stores
  nothing of them. Someone else who only shares their name is not affected. To also make sure they are never
  stored again: `prints never <person>`.
- **To delete one recording's voices:** `prints forget-recording <recording>`. To delete everything, delete the
  folder.
- **When a name is written without asking.** A person you confirmed once is proposed in your later recordings.
  Their name is written without asking only once their voice print is trusted: two recordings that match each
  other, with a minute of their speech between them.
- **A name written by the module is unconfirmed** until you confirm it, and says so wherever it is used. When
  the module is not sure, it writes no name and asks you.
- **Where the thresholds come from.** They were measured by the module's developer on his own recordings:
  [counts from the shipped file]. That is a small sample from one person's calls, and most of what it measured
  is recognising his own voice. The module checks each voice print against your own recordings before it
  writes a name from it.
- **The same call saved as two different files** is two recordings to the store.

| platform | where the folder is, unless `VOICE_PRINTS_HOME` says otherwise |
|---|---|
| macOS | `~/Library/Application Support/dreamteamer/voice-prints` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/dreamteamer/voice-prints` |
| Windows | `%LOCALAPPDATA%\dreamteamer\voice-prints` |

The commands — `prints list`, `prints forget <person>`, `prints never <person>`, `prints forget-recording
<recording>` — run through the module's entry from the workspace root
(`node node_modules/@dreamteamer/recordings/bin/transcribe.mjs prints …`); the `identifying-speakers` skill
carries them, and an agent runs them when you ask. Only a person answers who a voice is: an agent never
answers the question for you.

## 0.5.3 — matching a recording without the calendar sync (cr-modules-018)

Wording only; nothing to do. From core 0.13.0 the `fetching-meetings` skill ships with
`@dreamteamer/connectors-google-workspace`, not with core: `/match-recording-to-meeting` rung 2 now says that where it
is not installed, the ladder goes to rung 3 (a shim meeting) and says why, and the `ingesting-recordings` skill
describes the `<original> (English gloss)` name convention in place.

## 0.5.2 — INBOX_FOLDERS from the setup prompt is read as a list

Nothing to do. The setup asks for the inbox roots comma-separated, and 0.5.1 wrote that line into `.env` as it was,
so `/fetch-new-recordings` read it as one root that does not exist. A comma list given to `dt setup recordings` is
now stored one root per line, the documented format, and a comma list already in `.env` is read as its roots. A
folder whose name holds a comma stays one root. `/fetch-meeting-screenshots` (`@dreamteamer/meetings`) still reads
one root per line: if 0.5.1 stored yours with commas, put one root per line in `.env`.

## 0.5.1 — the nav is nav.yaml (cr-dt-008)

`display.nav.order` and `display.nav.section` removed from its descriptor — the nav is `nav.yaml` at the workspace root (engine 0.49), which you arrange; `display.nav.icon` stays. Nothing to do.

## 0.5.0 — on engine 0.48.0: the engine writes `.env` (CR-dt-007)

Nothing to do but `dt update @dreamteamer/recordings` on dreamteamer 0.48.0 or later, then `dt compile`; nothing a
workspace's records do changes. `set-home` is now an env action the engine writes into `.env` (a multi-line `INBOX_FOLDERS` is left as it is when nothing changed); `apply` runs the venv, the download and the CPU check only. Also in this release: hub-cache weights kept as a snapshot symlink read as on disk, and `set-home` no longer reports a write on every run when `INBOX_FOLDERS` is a multi-line quoted value.

## 0.4.0 — on engine 0.47.0 (CLI-first module lifecycle, CR-dt-006)

Nothing to do but `dt compile` after `dt update @dreamteamer/recordings` on dreamteamer 0.47.0 or later (the engine floor is `>=0.47.0`). New: the `recordings` setup unit: `dt install @dreamteamer/recordings --input files_folder=… --allow download --allow machine` provisions the venv and the models under TRANSCRIPTION_HOME (outside the workspace — a home inside it is refused); `dt setup recordings --verify --allow machine` transcribes a shipped synthetic clip on the CPU and writes the receipt.
