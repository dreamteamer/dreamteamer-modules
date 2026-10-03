---
name: transcribing-recordings
description: use when a meeting recording (audio file), a pasted Gemini/Meet transcript, or unlabeled conversation text needs to land in its meeting-recordings record as a transcript. offline, Hebrew+English, diarized. transcription only — never summarizes or resolves speakers.
---

# transcribing recordings

**core principle:** the transcript lives **inside the recording record** — a `## Transcript` section in
the body of `data/meeting-recordings/<id>.meeting-recording.md`, plus a `transcription:` block in its
frontmatter. Never a separate transcript file, and never on the meeting: N recordings of one meeting
are N records with N transcripts, so nothing ever has to be merged by hand.

**this skill transcribes. it does not summarize, and it never guesses who a speaker is.**

## when to use

an audio recording needs transcribing; Gemini/Meet notes or a raw voice-note dump were pasted into the
session; a recording record has a `recording_file` but no `transcription:`.

**not for:** writing the summary or pulling out action items (`/summarize-meeting`,
`/extract-tasks-from-meetings`), creating the recording record (`ingesting-recordings`), linking it to a meeting
(`/match-recording-to-meeting`), or resolving `speaker_0` → a real person on thin evidence — leave it
unmapped and say so.

## paths — read before running anything

run from the workspace root, against the compiled copy of this skill. every command below assumes:

```bash
SK=.dreamteamer/skills/transcribing-recordings
export TRANSCRIBING_MODELS_DIR="$HOME/.cache/dreamteamer/transcribing-models"   # absolute; see below
cd "$SK" && uv sync && uv run python transcribe_meeting.py setup   # audio route only
```

setup provisions a pinned Python 3.12 venv and downloads the models (~1.6 GB) — only what is missing,
so it is safe to re-run; it needs system `ffmpeg`. text routes need only `uv sync`.

**keep the models outside the skill folder.** By default they go in `.models/` beside the skill, but
compile regenerates `.dreamteamer/skills/` and `npm ci` regenerates `node_modules/`, so weights kept in
either are downloaded again. `TRANSCRIBING_MODELS_DIR` moves them: the script reads it from the process
environment (not from `.env`), and it must be an absolute path — `~` is not expanded. The venv is cheap
to lose: `uv sync` rebuilds it from `uv.lock` in about a second off the local cache.

**this works anywhere, including a cloud session** — no credentials, no `.env`, no Drive, no mount.
Only `ffmpeg` + `uv` + outbound network for the first `setup`.

### where the models come from

`setup` fetches all three into the models folder. The sources, so nobody has to read the code to
find them:

| file | size | source |
|---|---|---|
| `whisper/` | ~1.5 GB | HuggingFace **`ivrit-ai/whisper-large-v3-turbo-ct2`**, pulled by faster-whisper (CTranslate2, int8) |
| `segmentation.onnx` | 5.7 MB | sherpa-onnx release `speaker-segmentation-models` → `sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`, the `model.onnx` member |
| `embedding.onnx` | 28 MB | sherpa-onnx release `speaker-recongition-models` → `wespeaker_en_voxceleb_CAM++_LM.onnx` |

`speaker-recongition-models` is spelled that way **upstream** — it is the real GitHub release tag.
Do not "fix" the typo.

On a machine that already has the weights, **copy the models folder — do not re-download it.** Use
`rsync -a` (or `cp -a`): the whisper cache is a HuggingFace hub layout whose snapshot files are
*relative symlinks* into `blobs/`, so a plain `cp` either doubles 1.5 GB or breaks the links. **Never
copy `.venv`** — it bakes absolute interpreter and project paths and will not run in a new location.
The lock carries manylinux wheels for every native dependency, so Linux resolves without a source build.

Model *resolution* reaches the network on every `run` unless `HF_HUB_OFFLINE=1` is set; only inference
is offline. Set it for a genuinely airgapped run against a warm cache.

**the recording record is the target.** Its `recording_file` template points at the archived copy of
the binary — render it with `npx dt resolve meeting-recordings/<id> recording_file`; the record's
template is the only pointer. Its `meeting:` points back at the meeting. The script takes the
**record path and the audio path** — it does not resolve refs, place binaries, or create records. Those
are `ingesting-recordings` and `/match-recording-to-meeting`.

## routing

| what the user provides | route |
|---|---|
| a `meeting-recordings` record with a `recording_file` | `run` |
| **an audio file uploaded into the session + who/when, no Drive, no inbox** | **direct upload**, below |
| text with `Name: text` speaker labels | `parse-labeled` → `log` |
| text without speaker labels | infer conservatively → build turns.json → `log` |

### direct upload — the everywhere route

For a file handed straight to the session (a cloud or mobile session, or any local path) where the
meeting details come in the message. **Three commands, no credentials, no mount, no inbox.** `run`
takes any audio path ffmpeg can open, so the only new part is minting the record first.

```bash
# 1. the record. It is the transcript's home; `recording_file` may stay empty.
npx dt add meeting-recordings --name "<who and what>" --date YYYY-MM-DD --origin audio

# 2. OPTIONAL, LOCAL FILES_FOLDER ONLY — keep the bytes. Copies the file to
#    ${env:FILES_FOLDER}/meeting-recordings/<id>.<ext>, verifies it, and prints the recording_file to set on the record.
node .dreamteamer/skills/ingesting-recordings/bin/detect.mjs import <uploaded-file> \
     --id <recording-id>

# 3. transcribe. <audio> is the uploaded path, or the printed recording_file if you ran step 2.
cd "$SK" && uv run python transcribe_meeting.py \
     run "<abs/record.meeting-recording.md>" "<abs/audio>" --speakers N --language he|en
```

**What `import` does:** it sha256-fingerprints the bytes, copies them to
`${env:FILES_FOLDER}/meeting-recordings/<id>.<ext>`, verifies the copy, and moves the original into a
`trash/` folder beside it. So step 2 is what gives an uploaded file a durable home, and the
`recording_file` it prints belongs on the record.

**Step 2 needs a LOCAL `FILES_FOLDER`.** Where its value is a `gdrive://…` address, `import` refuses
rather than silently creating directories inside the repo. Steps 1 and 3 are the everywhere part of this
route, and skipping step 2 costs little: the **transcript** is what gets committed, and it is the
durable artifact. Say so rather than implying the audio was kept.

full script usage: `setup | run <record.md> <audio> [--date YYYY-MM-DD] [--speakers N] [--language en|he] | log
<record.md> <turns.json> [--date YYYY-MM-DD] | parse-labeled <text-file>`.

## audio route

1. **resolve.** the recording record and its `recording_file`, rendered to a local path with
   `npx dt resolve meeting-recordings/<id> recording_file`. If the record has no `recording_file`, stop —
   there is nothing to transcribe (that is why the binding's `can-enter` is `recording_file._nempty`).
2. **decide the language, and pass it when you know it.** `--language en` / `--language he`. A
   recording often **opens in Hebrew** (a spoken announcement, a greeting) even when the call is
   English, and faster-whisper detects the language from **one** window (`language_detection_segments=1`)
   and applies it to the whole file — so an English call is pinned to `he` by its own first sentence.
   Measured on a 39-minute English call with a Hebrew intro, first 6 minutes, Hebrew:Latin character
   ratio:

   | settings | ratio |
   |---|---|
   | conditioning on, no language | **0.980** — unusable |
   | `condition_on_previous_text=False` | 0.439 |
   | `condition_on_previous_text=False` + `--language en` | **0.131** |

   `condition_on_previous_text=False` is the **default for every call** — otherwise Whisper feeds each
   window's decoded text as the next window's prompt, which keeps dragging the decoder back to the
   opening language. Leave `--language` off for the ordinary Hebrew call; pass it whenever the meeting
   is predominantly one language and that language is **not** Hebrew. **Check the attendees before
   choosing:** a non-Israeli domain among the meeting's `attendees` (`@harbor-mutual.example`, a UK/US
   counterparty) means English.
   The frontmatter records which it was as `transcription.language_source: forced | detected`.

   **A code-switched call still degrades**, just far less — 0.131 is not 0. Where a call genuinely
   mixes both, expect Hebrew-script renderings of English terms and set `confidence: low`.

3. **decide the speaker count**, in this order:
   - the linked meeting's `attendees_contacts | length` — `npx dt get meetings/<id>`, the ideal path
     (the people resolved to contacts; the raw `attendees` list also counts people who declined)
   - no meeting, a free/busy stub, or fewer than 2 attendees → **pass `--speakers 2`**; a 1:1 is the
     commonest call
   - a genuinely solo recording (a voice memo, a dictated note) → **pass `--speakers 1`**, which skips
     diarization entirely rather than inventing a second voice
   - passing nothing at all leaves diarization unconstrained, which is the script's own fallback and is
     better than a confidently wrong 2 on a ten-person room

   **The count is not cosmetic.** The pinned sherpa-onnx raises **SIGBUS, not an exception**, whenever
   clustering resolves to a *single* speaker. Diarization therefore runs in a child process: a crash
   is an exit code, and the run continues with a single-speaker transcript and a warning on stderr
   (`diarization failed (exit -10) — falling back to a single speaker`). That is the guard working, and
   the transcript is still complete; `--speakers 1` skips sherpa altogether. Pass a real count anyway:
   the fallback loses speaker turns, not words.
4. **transcribe.** read **only the printed JSON summary** — never the transcript body:
   ```bash
   cd "$SK" && uv run python transcribe_meeting.py run <abs/record.meeting-recording.md> "<abs/audio>" --speakers N
   ```
   raw ASR JSON goes to the gitignored `.cache/asr/`.
5. **check the count against reality.** If `speaker_count` in the printed summary is materially higher
   than what you passed, the number was wrong, not the audio: re-run with the observed count and note
   the correction in `transcription.notes`. **Never block a transcription on not knowing the number.**
6. **fill the speaker name-map.** skim just enough to map labels to people; edit
   `transcription.speakers:` (`speaker_0: Dana Oren`). unsure → leave unmapped, say why in
   `transcription.notes:`.
7. **commit** (`npx dt commit meeting-recordings/<id>`) and **report** language(s), duration,
   speaker count, recording id, meeting id, speaker map — no transcript body in the report.

## text routes

**labeled paste** — parse, review/fix the auto-filled speakers map in turns.json, then log:

```bash
cd "$SK" && uv run python transcribe_meeting.py parse-labeled /tmp/transcript.txt > /tmp/turns.json
cd "$SK" && uv run python transcribe_meeting.py log <abs/record.meeting-recording.md> /tmp/turns.json
```

**unlabeled paste** — default to **single speaker** (`speaker_0`, method `verbatim-single`) unless there
are clear dialogue cues; on clear evidence split in order of appearance (`llm-inferred-speakers`). when
unsure stay single-speaker and note "speaker attribution needs user review" in `transcription.notes:`.
hand-build `/tmp/turns.json`, then `log` as above:

```json
{ "source": "pasted", "method": "verbatim-single", "language": ["en"],
  "speakers": {}, "turns": [{ "speaker": "speaker_0", "text": "…" }] }
```

A pasted transcript with no audio still gets a recording record — `origin: pasted`, a recording without a
file — because the transcript has to hang off *something*, and the recording is that something.

## provenance + conventions

`transcription:` carries only source-relevant fields: `engine`/`diarization`/`duration` (audio),
`source`/`method` (text), plus `language`, `speaker_count`, `speakers` (you fill), `generated`, and
free-text `notes` (you fill — caveats, confidence, attribution issues). `[mm:ss]` timestamps appear in
the body for audio only. the body keeps raw `Speaker N` labels; real names live only in
`transcription.speakers:`. Notes *about the meeting* belong on the meeting's `description:`, not here.
The recording also carries the provenance quad (`author`, `creation_context`, `source`, `confidence`) —
Hebrew ASR that came out rough is `confidence: low` with the reason in `creation_context`.

**several recordings of one meeting need no merging.** Each is its own recording record with its own
transcript and its own speaker map, and the meeting's `recordings:` array lists them all in date order.
If you find yourself merging transcripts, stop.

after transcribing, run `npx dt check` — the recording must validate. The meeting's `recordings:`
is generated from each recording's `meeting:`, so the link is written once, on the recording.

## common mistakes

| mistake | reality |
|---|---|
| writing the transcript onto the meeting | it lives on the RECORDING; the meeting's body is its own |
| running from `.claude/skills/transcribing-recordings/` | a harness copy, regenerated by compile. run from `$SK`. |
| reading the transcript body after `run` | read the JSON summary; skim only far enough to map speakers. |
| letting the language be DETECTED on a call that isn't Hebrew | detection reads one window, and a Hebrew intro is that window — pass `--language`. |
| guessing `speaker_0: <name>` from thin evidence | leave it unmapped and say so in `transcription.notes:`. |
| blocking because the attendee count is unknown | pass 2, let the diarizer disagree, re-run if it does. |
| merging several recordings into one transcript | N recordings = N records; never merge them. |
| `recording_file` on the meeting | the meeting has `recordings:` (refs); the recording holds the path template. |
| re-running `run`/`log` over a hand-filled speaker map | it replaces the block. warn first. |
| summarizing or extracting tasks here | different commands, different steps. transcription only. |
| committing the audio, the models or `.cache/` | binaries never get committed. |
