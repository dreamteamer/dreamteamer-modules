---
name: transcribing-recordings
description: use when a meeting recording (audio file), a pasted Gemini/Meet transcript, or unlabeled conversation text needs to land in its meeting-recordings record as a transcript. offline, Hebrew+English, diarized. transcription only — never summarizes or resolves speakers.
---

# transcribing recordings

**core principle:** the transcript lives **inside the recording record** — a `## Transcript` section in
the body of `data/meeting-recordings/<id>.meeting-recording.md`, plus a `transcription:` block in its
frontmatter. Never a separate transcript file, and **no longer on the meeting**: it moved to the
recording on 2026-07-28 (migration M2) so that N recordings of one meeting are N records with N
transcripts instead of one body somebody has to merge by hand.

**this skill transcribes. it does not summarize, and it never guesses who a speaker is.**

## when to use

an audio recording needs transcribing; the operator pasted Gemini/Meet notes or a raw voice-note dump; a
`process-recording` workflow step calls for it; a recording record has a `recording_file` but no `transcription:`.

**not for:** writing the summary or pulling out action items (`/summarize-meeting`,
`/extract-tasks-from-meetings`), creating the recording record (`ingesting-recordings`), linking it to a meeting
(`/match-recording-to-meeting`), or resolving `speaker_0` → a real person on thin evidence — leave it
unmapped and say so.

## paths — read before running anything

this skill executes from its **source folder**, not the generated `.claude/skills/` copy (that copy is
overwritten and pruned by compile; the venv, models and caches live only here, dot-prefixed so compile
skips them). every command below assumes:

```bash
SK=<extensions>/modules/recordings/skills/transcribing-recordings
cd "$SK" && uv sync && uv run python transcribe_meeting.py setup   # once, audio route only
```

setup provisions a pinned Python 3.12 venv; models (~1.6 GB) in `.models/` beside the skill — or wherever
`TRANSCRIBING_MODELS_DIR` points, which is REQUIRED when the skill arrives through npm (`npm ci` wipes
`node_modules`, so weights kept there are re-downloaded on every install) — (downloads only what's
missing, and is safe to re-run); needs system `ffmpeg`. text routes need only `uv sync`.

**this works anywhere, including Claude Code web** — no credentials, no `.env`, no Drive, no mount.
Only `ffmpeg` + `uv` + outbound network for the first `setup`. `npm run doctor` reports the
transcription row on its own.

### where the models come from

`.models/` is gitignored, so a fresh clone has none and `setup` fetches all three. The sources, so
nobody has to read the code to find them:

| file | size | source |
|---|---|---|
| `.models/whisper/` | ~1.5 GB | HuggingFace **`ivrit-ai/whisper-large-v3-turbo-ct2`**, pulled by faster-whisper (CTranslate2, int8) |
| `.models/segmentation.onnx` | 5.7 MB | sherpa-onnx release `speaker-segmentation-models` → `sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`, the `model.onnx` member |
| `.models/embedding.onnx` | 28 MB | sherpa-onnx release `speaker-recongition-models` → `wespeaker_en_voxceleb_CAM++_LM.onnx` |

⚠ `speaker-recongition-models` is spelled that way **upstream** — it is the real GitHub release tag.
Do not "fix" the typo.

⚠ On a machine that already has the weights, **copy `.models/` — do not re-download it.** `rsync -a`
(or `cp -a`): the whisper cache is a HuggingFace hub layout whose snapshot files are *relative
symlinks* into `blobs/`, so a plain `cp` either doubles 1.5 GB or breaks the links. **Never copy
`.venv`** — it bakes absolute interpreter and project paths (27 files did) and will not run in a new
location. `uv sync` rebuilds it from `uv.lock` in under a second off the local cache, and the lock
carries manylinux wheels for every native dependency, so Linux resolves without a source build.

⚠ Model *resolution* reaches the network on every `run` unless `HF_HUB_OFFLINE=1` is set; only
inference is offline. Set it if you want a genuinely airgapped run against a warm cache.

**the recording record is the target.** Its `recording_file` template points at the binary's durable Drive
copy — render it with `dt resolve meeting-recordings/<id> recording_file` (there is NO `file` field and
NO `media/` folder since 2026-08-23; the record's template is the only pointer). Its `meeting:` points
back at the meeting. The script takes the **record path and the audio path** — it does not resolve
refs, place binaries, or create records. Those are `ingesting-recordings` and
`/match-recording-to-meeting`.

## routing

| what the user provides | route |
|---|---|
| a `meeting-recordings` record with a `recording_file` | `run` |
| **an audio file uploaded into the session + who/when, no Drive, no inbox** | **direct upload**, below |
| text with `Name: text` speaker labels | `parse-labeled` → `log` |
| text without speaker labels | infer conservatively → build turns.json → `log` |

### direct upload — the everywhere route

For a file handed straight to the session (Claude Code web or mobile, or any local path) where the
operator supplies the meeting details in the message rather than in Drive. **Three commands, no
credentials, no mount, no inbox.** `run` already takes an arbitrary audio path — nothing validates or
prefixes it — so the only new part is minting the record first.

```bash
# 1. the record. It is the transcript's home; no field is required, and `recording_file` may stay empty.
npm run --silent dt -- add meeting-recordings --name "<who and what>" --date YYYY-MM-DD --origin audio

# 2. OPTIONAL, DESKTOP ONLY — keep the bytes. MOVES the original into
#    ${env:FILES_FOLDER}/meeting-recordings/<year>/<month>/ and prints the recording_file to set on the record.
node <extensions>/modules/recordings/skills/ingesting-recordings/bin/detect.mjs import <uploaded-file> \
     --id <recording-id>

# 3. transcribe. <audio> is the uploaded path, or the printed recording_file if you ran step 2.
cd <extensions>/modules/recordings/skills/transcribing-recordings && uv run python transcribe_meeting.py \
     run "<abs/record.meeting-recording.md>" "<abs/audio>" --speakers N --language he|en
```

⚠ **`import` MOVES the source, and there is no `media/` copy any more (retired 2026-08-23).** What
actually happens: the bytes are sha256-fingerprinted and the original is renamed into
`${env:FILES_FOLDER}/meeting-recordings/<year>/<month>/` — both segments taken from the recording id. So step 2
is what gives an uploaded file a durable home, and the `recording_file` it prints belongs on the record.
(Until 22/08 import copied into `media/` and left the original; until 23/08 it copied AND moved. Both
behaviours are gone — the Drive archive is the only copy.)

⚠ **Step 2 needs a LOCAL `FILES_FOLDER`, so it does not run on the web.** A cloud session's value is
a `gdrive://…` address and `import` refuses it by design rather than silently creating directories
inside the repo. Steps 1 and 3 are the everywhere part of this route.

⚠ There is no `ingested/`/`processed/` staging to worry about any more — those folders were retired
22/08/2026 in favour of a `<filename>.log` sidecar, and `import` files the original in one move. A
file attached straight to this message never sat in an inbox at all, so no log is involved either.

⚠ On the web, step 2 being unavailable costs little: the **transcript** is what gets committed, and it
is the durable artifact. Say so rather than implying the audio was kept.

full script usage: `setup | run <record.md> <audio> [--date YYYY-MM-DD] [--speakers N] [--language en|he] | log
<record.md> <turns.json> [--date YYYY-MM-DD] | parse-labeled <text-file>`.

## audio route

1. **resolve.** the recording record and its `recording_file`, rendered to a local path with
   `dt resolve meeting-recordings/<id> recording_file`. If the record has no `recording_file`, stop —
   there is nothing to transcribe (that is why the binding's `can-enter` is `recording_file._nempty`).
2. **decide the language, and pass it when you know it.** `--language en` / `--language he`. A
   recording often **opens in Hebrew** (a spoken announcement, a greeting) even when the call is English, and faster-whisper
   detects the language from **one** window (`language_detection_segments=1`) and applies it to the
   whole file — so an English call is pinned to `he` by its own first sentence. Measured on a
   39-minute English call with a Hebrew intro, first 6 minutes, Hebrew:Latin character
   ratio:

   | settings | ratio |
   |---|---|
   | conditioning on, no language *(the pre-2026-08-04 behaviour)* | **0.980** — unusable |
   | `condition_on_previous_text=False` | 0.439 |
   | `condition_on_previous_text=False` + `--language en` | **0.131** |

   `condition_on_previous_text=False` is now the **default for every call** — Whisper was feeding each
   window's decoded text as the next window's prompt, which kept dragging the decoder back to the
   opening language. Leave `--language` off for the ordinary Hebrew call; pass it whenever the meeting
   is predominantly one language and that language is **not** Hebrew. **Check the attendees before
   choosing:** a non-Israeli domain on the invite (`@harbor-mutual.example`, a UK/US counterparty) means English.
   The frontmatter records which it was as `transcription.language_source: forced | detected`.

   ⚠ **A code-switched call still degrades**, just far less — 0.131 is not 0. Where a call genuinely
   mixes both, expect Hebrew-script renderings of English terms and set `confidence: low`.

3. **decide the speaker count**, in this order:
   - the linked meeting's `attendees | length` — `dt get meetings/<id>`, the ideal path
   - no meeting, a free/busy stub, or fewer than 2 attendees → **pass `--speakers 2`**; the operator's
     calls are mostly 1:1s
   - a genuinely solo recording (a voice memo, a dictated note) → **pass `--speakers 1`**, which skips
     diarization entirely rather than inventing a second voice
   - passing nothing at all leaves diarization unconstrained, which is the script's own fallback and is
     better than a confidently wrong 2 on a ten-person room

   ⚠ **Do not read the count as cosmetic — it used to decide whether the run survived.** sherpa-onnx
   1.10.46 raises **SIGBUS, not an exception**, whenever clustering resolves to a *single* speaker.
   Measured 2026-08-13 on this exact stack: `--speakers 1` crashed, `threshold=0.9` crashed, and the
   unconstrained default crashed on 45 s of one dominant voice while succeeding on the same call's
   first 5 minutes once both voices were present. The audio route accumulated 72 clean records only
   because this list always produced N ≥ 2. **Fixed by isolation, not by prediction:** diarization now
   runs in a child process, so a crash is an exit code and the run continues with a single-speaker
   transcript and a loud warning; `--speakers 1` skips sherpa altogether. You will see
   `⚠ diarization failed (exit -10) — falling back to a single speaker` — that is the guard working,
   and the transcript is still complete. It is worth passing a real count anyway: the fallback loses
   speaker turns, it does not lose words.
4. **transcribe.** read **only the printed JSON summary** — never the transcript body:
   ```bash
   cd "$SK" && uv run python transcribe_meeting.py run <abs/record.meeting-recording.md> "<abs/audio>" --speakers N
   ```
   raw ASR JSON goes to the gitignored `.cache/asr/`.
5. **check the count against reality.** If `speaker_count` in the printed summary is materially higher
   than what you passed, the number was wrong, not the audio: re-run with the observed count and note
   the correction in `transcription.notes`. **Never block a transcription on not knowing the number.**
6. **fill the speaker name-map.** skim just enough to map labels to people; edit
   `transcription.speakers:` (`speaker_0: Alice`). unsure → leave unmapped, say why in
   `transcription.notes:`.
7. **commit** (`dreamteamer: meeting-recordings set <id>`) and **report** language(s), duration,
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
file — because the transcript has to hang off *something*, and the recording is that something. 35 of
this vault's transcripts are exactly that.

## provenance + conventions

`transcription:` carries only source-relevant fields: `engine`/`diarization`/`duration` (audio),
`source`/`method` (text), plus `language`, `speaker_count`, `speakers` (you fill), `generated`, and
free-text `notes` (you fill — caveats, confidence, attribution issues). `[mm:ss]` timestamps appear in
the body for audio only. the body keeps raw `Speaker N` labels; real names live only in
`transcription.speakers:`. Notes *about the meeting* belong on the meeting's `description:`, not here.
The recording also carries the provenance quad (`author`, `creation_context`, `source`, `confidence`) —
Hebrew ASR that came out rough is `confidence: low` with the reason in `creation_context`.

**several recordings of one meeting need no merging any more.** Each is its own recording record with its
own transcript and its own speaker map, and the meeting's `recordings:` array lists them all in date
order. (Before M2 this section documented a `transcription.parts.*` hand-merge into a single meeting
body — that whole procedure is gone. If you find yourself merging transcripts, you are on the old path.)

after transcribing, run `npm run check` — the recording must validate, and the symmetric-ref rule fails a
recording whose `meeting:` is not mirrored by that meeting's `recordings:`. tests:
`cd "$SK" && uv run pytest -q`.

## common mistakes

| mistake | reality |
|---|---|
| writing the transcript onto the meeting | it lives on the RECORDING since M2; the meeting body is its prep brief now |
| running from `.claude/skills/transcribing-recordings/` | no venv, no models there — and compile overwrites it. run from `$SK`. |
| reading the transcript body after `run` | read the JSON summary; skim only far enough to map speakers. |
| letting the language be DETECTED on a call that isn't Hebrew | detection reads one window, and the operator's own Hebrew intro is that window — pass `--language`. |
| guessing `speaker_0: <name>` from thin evidence | leave it unmapped and say so in `transcription.notes:`. |
| blocking because the attendee count is unknown | pass 2, let the diarizer disagree, re-run if it does. |
| merging several recordings into one transcript | N recordings = N records. the merge procedure is gone. |
| `recording_file` on the meeting | the meeting has `recordings:` (refs); the recording holds the path template. |
| re-running `run`/`log` over a hand-filled speaker map | it replaces the block. warn first. |
| summarizing or extracting tasks here | different commands, different steps. transcription only. |
| committing the audio, `.models/` or `.cache/` | gitignored on purpose — binaries never get committed. |
