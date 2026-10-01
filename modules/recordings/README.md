# @dreamteamer/recordings

Audio recordings of your meetings, each matched to its meeting and transcribed on your own machine:
Hebrew and English, speakers told apart.

```bash
npm install @dreamteamer/recordings @dreamteamer/meetings @dreamteamer/contacts @dreamteamer/companies @dreamteamer/users @dreamteamer/tags @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| recordings pulled from an inbox by content hash, matched to their meeting, transcribed; `meetings.recordings` stamped on | **meeting-docs** reads the transcript: summarise, extract tasks, critique |

| needs | for |
|---|---|
| `@dreamteamer/meetings` (and what it needs) | the meeting a recording belongs to |
| `ffmpeg`, `uv` and about 1.6 GB of models, downloaded once | transcribing audio; a pasted transcript needs only `uv` |
| `TRANSCRIBING_MODELS_DIR` in `.env` | where the models live when the module comes from npm; `npm ci` would delete them otherwise |
