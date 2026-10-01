# @dreamteamer/recordings

Audio recordings of your meetings, each matched to its meeting and transcribed on your own machine:
Hebrew and English, speakers told apart.

```bash
npm install @dreamteamer/recordings @dreamteamer/meetings @dreamteamer/contacts @dreamteamer/companies @dreamteamer/users @dreamteamer/tags @dreamteamer/assets
npx dreamteamer compile
```

## the flow

1. Drop audio into `<an INBOX_FOLDERS root>/meeting-recordings/`, named `[date] [who]` where you can
   (`2026 08 30 1500 Northwind weekly.m4a`, `Dana Oren jul22.m4a`; a Hebrew month name works too).
2. `/fetch-new-recordings` — dedupes by content hash, archives each new file under
   `${env:FILES_FOLDER}/meeting-recordings/`, moves the original to the inbox root's `trash/`, and
   creates a `meeting-recordings` record.
3. `/match-recording-to-meeting` — links each recording to its meeting.
4. `/transcribe-recording` — writes the transcript into the recording record.

A file handed straight to a session, or a pasted transcript, skips the inbox: the
`transcribing-recordings` skill covers both.

| alone | with others |
|---|---|
| recordings pulled from an inbox by content hash, matched to their meeting, transcribed; `meetings.recordings` stamped on | **meeting-docs** reads the transcript: summarise, extract tasks, critique |

| needs | for |
|---|---|
| `@dreamteamer/meetings` (and what it needs) | the meeting a recording belongs to |
| `INBOX_FOLDERS` and `FILES_FOLDER`, declared in your workspace's `dreamteamer.vars` | where recordings arrive (a newline-separated list of roots) and where they are archived (a local folder) |
| `ffmpeg`, `ffprobe`, `uv` and about 1.6 GB of models, downloaded once | transcribing audio; a pasted transcript needs only `uv` |
| `TRANSCRIBING_MODELS_DIR`, an absolute path exported in the environment that runs the transcriber | where the models live; without it they sit inside the skill folder, which compile and `npm ci` regenerate |
