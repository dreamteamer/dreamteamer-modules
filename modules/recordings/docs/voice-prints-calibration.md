# Voice prints — the calibration session

The developer's session of design section 13, step by step: about 40 minutes of listening, which can be
two sittings, after some unattended machine time. A user never does this; its result ships with the
module, and until it has run no release of this feature writes a name.

It runs on the developer's own machine, in **the workspace that holds his recordings**, from the
worktree of the `cr-modules-019` branch (increment 1 is not tagged or published). Every command below is
run **from that workspace's root**. Placeholders:

| placeholder | what it stands for |
|---|---|
| `<worktree>` | the absolute path of the branch's worktree (`dreamteamer-modules` checked out on `feat/cr-modules-019-voice-prints`, `npm install` done) |
| `<record>` | a recording's id, as `dt list meeting-recordings` prints it; the commands take it as `meeting-recordings/<record>` |
| `<pilot>` | the pilot's 40-minute recording, the known mixed case |
| `<N>` | the number of people who spoke in that recording |
| `<store>` | the voice-print store: `VOICE_PRINTS_HOME`, or on macOS `~/Library/Application Support/dreamteamer/voice-prints` |

Nothing here leaves the machine. The store holds voice signatures of every speaker of every recording
transcribed again; it is never written to a record, to git or to an export, and the calibration file the
session ends with holds numbers and counts only.

## Before: link the worktree, fetch both speaker models

```bash
node <worktree>/scripts/preview.mjs link <worktree>
node <worktree>/modules/recordings/bin/transcribe.mjs sync
node <worktree>/modules/recordings/bin/transcribe.mjs setup --speaker-models all
```

- `link` points `git_modules/dreamteamer-modules` at the worktree and recompiles, so
  `.dreamteamer/skills/transcribing-recordings` is the branch's transcriber. While it is linked, the guard
  it installs refuses a commit touching `data/`: commit the transcripts of step 0 after `unlink` (below).
- Always call the entry as `node <worktree>/modules/recordings/bin/transcribe.mjs`: the published
  `node_modules/@dreamteamer/recordings` does not know `label` or `evaluate-speakers`.
- `setup --speaker-models all` fetches both registered speaker models (CAM++ and ERES2NetV2, about 100 MB)
  into `$TRANSCRIPTION_HOME/models/speaker/`, each checked against its sha256. The evaluation measures
  both; it stops and names `setup` when one is missing.

## Step 0 — transcribe the chosen recordings again (machine time, unattended)

They were transcribed before this feature: no diarisation id, no voice signature. Transcribing again
gives both; the names already on them move to `previous_speakers`, which is where the evaluation reads the
hand maps it prints as a silver second look. For each recording (step 2 says which, but every recording
you might label can be done now; the pilot too):

```bash
node <worktree>/modules/recordings/bin/transcribe.mjs run meeting-recordings/<record> "$(npx dt resolve meeting-recordings/<record> recording_file)" --speakers <N>
```

Add `--language en` for a call held in English (see the transcribing-recordings skill). The printed
summary must say `"signatures": "kept — campp-en-voxceleb-lm, …"`; `not kept` names what to fix (most
often the store's location, or `setup`). The ASR cache of each run stays in `$TRANSCRIPTION_HOME/asr/`:
`label` and `evaluate-speakers` read the diarisation from it, so do not clear it before step 5.

## Step 1 — the solo memo

Record a voice memo of about two minutes, alone, and bring it in as a recording the usual way
(`/fetch-new-recordings`). Then:

```bash
node <worktree>/modules/recordings/bin/transcribe.mjs run meeting-recordings/<record> "$(npx dt resolve meeting-recordings/<record> recording_file)" --speakers 1
```

## Step 2 — the plan

```bash
node <worktree>/modules/recordings/bin/transcribe.mjs evaluate-speakers plan --pilot meeting-recordings/<pilot>
```

It reads every recording that has a diarisation id and lists **14**: you in all of them; at least three
other people who each appear in at least two (three or more preferred); eight 1:1 calls, four with three
or more speakers, two recorded in a room. A room is a meeting whose `location` is not a URL; name one by
hand with `--room meeting-recordings/<record>` (repeatable). Apart from the 14 it lists the solo memo (the
newest recording transcribed with `--speakers 1`) and the pilot: **16 items to label**. A line `short of
the session's mix` says what is missing — transcribe more recordings (step 0) and run the plan again. It
writes nothing.

## Step 3 — label (about 40 minutes)

For each of the 16:

```bash
node <worktree>/modules/recordings/bin/transcribe.mjs label meeting-recordings/<record>
```

It plays six windows of 4 to 8 seconds per speaker label — always one in the first, middle and last third
of any turn longer than five minutes — shuffled, without saying which label a window is from. Answer:

| key | meaning |
|---|---|
| `1`…`9` | that attendee (the list is printed with each question) |
| `x` | unsure, overlap, noise, or someone not listed |
| `r` | play it again |

About 15 windows a recording, a little over 200 in all. Sound comes from `afplay` (macOS) or `ffplay`;
each window is cut by `ffmpeg` into a temp file removed after. The answers are written after every one,
to `<store>/calibration-labels/<audio>/<diarization>.json`: an interrupted recording keeps what was heard
— label it again to start that recording over.

## Step 4 — evaluate

```bash
node <worktree>/modules/recordings/bin/transcribe.mjs evaluate-speakers --pilot meeting-recordings/<pilot>
```

Per speaker model it prints, before anything else: the purity of each label (the share of its heard
windows the majority speaker holds; under 0.80 is heard as mixed, mostly `x` is unheard — neither is a
trial); check 4's hits and misses; the genuine (true match) and impostor (false match) scores, closed set
and open set; the thresholds fitted on all labelled recordings; then one line per judged recording — the
prints and thresholds that judged it were rebuilt and fitted without it, and the line says on how many
recordings and trials — and the replay's totals. Last, the verdict line, and beside it the names written
(`n`), the bound `3/n`, the fit counts per fold, and that the judged recording was in none of them.

The **silver** section lists unheard hand maps that disagree with the prints. Listen to each:

```bash
node <worktree>/modules/recordings/bin/transcribe.mjs label meeting-recordings/<record> --only speaker_<n>
```

and run step 4 again; a silver label you heard is gold from then on. `--only <model id>` evaluates one
model. A model with no signature file for a recording is embedded from the audio once, written to the
store as `run` writes one, and read from there the next time; the folds themselves replay prints in a
temporary store and write nothing to yours.

## Step 5 — write the calibration

```bash
node <worktree>/modules/recordings/bin/transcribe.mjs evaluate-speakers --write --pilot meeting-recordings/<pilot>
```

It prints the evaluation again, then the file's path:

```
written: <store>/calibration-labels/calibration-<model id>.json
```

The file holds the chosen model's id and sha256, the six thresholds, `print_closed` and `print_open`,
`split_weak` and the counts (`recordings`, `people`, `genuine`, `impostor`, `written`, `wrong`) and the
bound — numbers and counts only. When the evidence is insufficient it writes nothing and says to label
more. When no model qualifies it still writes the file, with both switches `propose`. Adding
`--install-local` also writes `<store>/<model id>/calibration.json`, this machine's local override, so
naming can be tried here before the file ships.

## After: unlink, commit, hand back

```bash
node <worktree>/scripts/preview.mjs unlink
```

Then commit the transcripts step 0 rewrote, as any transcript (`dt commit meeting-recordings/<record>`).

Hand back to the build:

1. the file `<store>/calibration-labels/calibration-<model id>.json` — copying it unchanged into the
   skill's `calibration/` folder is the release step (plan task 14);
2. the verdict line and the lines beside it, as printed by step 5.

Keep the rest of the printout to yourself: its per-label lines name your recordings and the people in
them, and nothing of it belongs in this repository.
