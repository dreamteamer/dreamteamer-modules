# @dreamteamer/recordings

Audio recordings of your meetings, each matched to its meeting and transcribed on your own machine:
Hebrew and English, speakers told apart. Screenshots taken during a call are filed beside it. Adds
the transcript-gated steps to the meeting pipeline: summarise, extract tasks, critique.

```bash
npm install @dreamteamer/recordings @dreamteamer/meetings @dreamteamer/contacts @dreamteamer/tasks @dreamteamer/users @dreamteamer/assets
npx dreamteamer compile
```

| needs | for |
|---|---|
| `@dreamteamer/meetings` (and what it needs) | the meeting a recording belongs to |
| `ffmpeg`, `uv` and about 1.6 GB of models, downloaded once | transcribing audio; a pasted transcript needs only `uv` |
| `TRANSCRIBING_MODELS_DIR` in `.env` | where the models live when the module comes from npm — `npm ci` would delete them otherwise |
