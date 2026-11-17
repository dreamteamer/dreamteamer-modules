---
name: identifying-speakers
description: use when a transcribed meeting recording's speaker labels need people's names — after /transcribe-recording, when `dt next` offers /identify-speakers, when a person answers "who is Speaker 1", confirms, corrects or reverts a name on a transcript, or asks to see or delete a voice print (`prints forget`). The mechanics behind /identify-speakers — names from voice prints kept on this computer, one question at the end of the run, a person's reply applied.
---

# identifying speakers

**core principle:** a transcription writes no name. `/identify-speakers` names a recording's speaker labels
from **voice prints** kept on this computer, checked against the meeting's attendees, and asks a person
about the rest in **one question at the end of the run**. A person's answer is what teaches the voices:
**confirming a name stores a voice print** of that person, for them and for anyone else they name, with no
separate consent step.

**Only a person answers. An agent never answers the question itself and never calls `--answer` or
`--confirm` without a person's reply in the conversation.** Not from the transcript, not from the meeting's
attendee list, not because a proposal looks right, and not on a "yes" that was about something else.

## when to run

A `meeting-recordings` record with a `recording_file` and a `transcription`, whose `speaker_naming` is empty
(the step has not run on it) or `waiting` (a question is open) — `dt next meeting-recordings/<id>` offers
`/identify-speakers` exactly then. Run it after `/transcribe-recording`; `/process-new-meetings`
(`@dreamteamer/meeting-docs`) runs it as its own step after transcription.

**not for:** transcribing (`transcribing-recordings`), summarising a call, or naming a voice from what the
transcript says — a name comes from a voice print or from a person.

`speaker_naming` is written only by `identify`, and cleared when the recording is transcribed again:

| `speaker_naming` | the record |
|---|---|
| `waiting` | an open question: an unnamed label that can be asked about, a flagged label, a carried proposal, or a name written from a voice print that no person has been shown yet |
| `named` | every label has a name that is confirmed, unverified, or provisional and already shown — or was closed by a person ("nobody", "different people") |
| `closed` | nothing to name until it is transcribed again: collapsed to one label, or transcribed before voice prints |

## the run

Every command goes through the module's entry, run from the workspace root (it reads `.env`, resolves the
recording's meeting and attendees, and hands the Python one context file). Records are given as references.
Read **only the printed JSON**, never the transcript body.

1. **name what may be named.**
   ```bash
   node node_modules/@dreamteamer/recordings/bin/transcribe.mjs identify meeting-recordings/<id> [more refs…]
   ```
   Per record: `outcome`, `speaker_naming`, and one line per label in `labels` — named from a voice print
   (provisional, with its score), proposed, or why not. Report those lines. A name written from a voice print
   is **provisional**; it is still shown to a person with its two quotes, because a name cannot be confirmed
   on a score.

2. **one question at the end of the run** — after every recording of the run is identified, together with the
   run's other end-of-run questions, never one recording at a time:
   ```bash
   node node_modules/@dreamteamer/recordings/bin/transcribe.mjs identify --question meeting-recordings/<id> [more refs…]
   ```
   It prints one JSON object, `{message, records}`, or nothing when nothing is open (then there is nothing to
   ask). `message` is the whole question: each unknown voice with **two quotes and their timestamps** (from
   the two parts of the label that sound least alike), the meeting's **attendees** as the choices with the
   proposal first (with no linked meeting, the workspace's users), then someone else, these two quotes are
   different people, nobody I can name, skip; the names written from voice prints under `Named from voice
   prints, unconfirmed:`; names already on the record that no person confirmed; and the line that naming a
   voice stores a voice print. Put `message` to the person **as it is** — no paraphrase, no choice of your own
   added or preselected.

3. **right after asking**, stamp what was shown:
   ```bash
   node node_modules/@dreamteamer/recordings/bin/transcribe.mjs identify --shown meeting-recordings/<id> [the same refs…]
   ```
   This is what lets a record leave `waiting`: a provisional name shown and not answered stays provisional and
   is not asked again; a label the person skips stays open. Run it only when the message really was put to a
   person in this conversation.

4. **apply the person's reply**, one call per recording, with only the labels they answered:
   ```bash
   node node_modules/@dreamteamer/recordings/bin/transcribe.mjs identify --answer meeting-recordings/<id> speaker_1=contacts/sam-diaz speaker_2=nobody
   ```
   The values are the `answer` strings in `records[].labels[].choices`:

   | the person says | answer |
   |---|---|
   | one of the listed people | `<label>=<their reference>` |
   | someone else, and names them | `<label>=someone:<name>` |
   | these two quotes are different people | `<label>=different` — and if they also say who it mostly is, `<label>=different:<person>` (named, kept out of the voice print) |
   | nobody I can name | `<label>=nobody` — the label stays `Speaker N` and is not asked again |
   | skip, or nothing about that label | `<label>=skip`, or leave the label out — the question stays open |
   | "correct" on a name written from a voice print, or on an unconfirmed name | `<label>=correct` |

   An unclear reply is asked again, never guessed.

5. **relay the reply** (`reply` in the printed JSON). It names each person whose voice print was stored or
   changed, each label kept out of a voice print and why (their voice is never kept, under 20 seconds of
   speech, a turn over five minutes, a second voice in it, it sounded unlike their print so far and was kept
   aside), and the documents written from this transcript before the names — the meeting's summary, analysis
   and tasks, now stale. `/process-new-meetings` writes those again itself; run on its own, say which they are.

**Unattended** — no person in the conversation: run step 1, ask nothing, run no `--shown` and no `--answer`.
The records stay `waiting`, `dt next` keeps offering them, and the next attended run asks their questions.

## how a voice print learns

Confirming a name is the enrolment. The name is always written, because the person said it; whether the
label's voice joins the person's voice print is checked first, and the reply says when it does not.

- A person confirmed once is **proposed** on their next recording — the preselected choice in the question.
- A person is **written without asking**, provisional and shown with two quotes, once their voice print is
  trusted: **two recordings that match each other, with a minute of their speech between them**.
- A name written from a voice print that the person corrects switches that voice print back to proposing.
- With no calibration for the speaker model, `identify` proposes and writes no name.

## confirm, correct, revert — each on a person's word

| command | what it does |
|---|---|
| `identify --confirm <ref> <label>…` | confirms provisional or unverified names. **Name the labels the person confirmed; never run `--confirm` bare.** It confirms only a label whose two quotes were shown (`--question`, then `--shown`): for any other it prints the quotes and confirms nothing — show them, run `--shown`, and confirm after the person has heard them |
| `identify --correct <ref> <label> <person>` | the person says a name is wrong; the right person is named and the voice print that wrote the wrong name stops naming on its own |
| `identify --revert <ref>` | removes every provisional name, its questions and `identification`; keeps confirmed and unverified names |
| `identify --revert --person <ref>` | the same, across this workspace's recordings, for one person's provisional names |

A name with no `speaker_sources` entry, or whose text differs from its entry's `name`, is **unverified** — every
name written before voice prints, and any name edited by hand. It is kept and never overwritten, and it
teaches nothing until a person confirms it.

## what each line means

| a line says | what it means | what the person can do |
|---|---|---|
| transcribed before voice prints; transcribe it again to name or confirm its voices | no diarisation id: `closed`, no name, no question, not offered again | `/transcribe-recording` again; its old names come back as proposals, carried from the earlier transcript |
| the only speaker label but N speakers are expected … transcribe again with `--speakers N` | collapsed: no name, no question, `closed` | transcribe again with the right count |
| no known voice matched | no voice print fits; the label is asked about | answer the question |
| a mixed diarisation is suspected | two labels sound alike, or both resemble one voice print: no name on either; both asked, flagged | answer, or transcribe again with the right count |
| may hold more than one voice | a turn over five minutes, most of the speech, or two voices in its windows: never named from a voice print; asked | answer; a name given here stores no voice print |
| conflicts with Speaker N | the person is already named on another label | answer |
| sounds like X, who was not invited | reported only; nothing written | — |
| resembles a voice print from another workspace | the voice matches someone another workspace knows by another name | `prints link <person>` if they are one person |
| made with another speaker model, or has no voice for the active model … run `prints rebuild` | the voice prints predate the active speaker model or its calibration, so they name nobody | `prints rebuild` |
| no voice signature of this diarisation on this machine | the recording was transcribed elsewhere | transcribe it again here |
| … first recording may hold two voices; `prints reseed <person>` | a person's first source holds two voices, so their print never becomes trusted | `prints reseed <person>`, only on their say-so |

A store the module refuses — inside a repository, the workspace, a `FILES_FOLDER` or `INBOX_FOLDERS` root, or a
synced or cloud folder — stops naming with the reason; set `VOICE_PRINTS_HOME` in `.env` to a folder outside them.

## voice prints

```bash
node node_modules/@dreamteamer/recordings/bin/transcribe.mjs prints list | forget <person> | never <person> | forget-recording <ref> | link <person> | rebuild | reseed <person>
```

Each on a person's request. `list` shows this workspace's people only, never a vector. `forget` deletes the
person's voice print and their voice from the recordings it was built from and from this workspace's
recordings that name them, leaves their name on transcripts, says how many other workspaces still know them
(run it there too) and offers `identify --revert --person`. `never` is `forget` plus never storing them again.
`forget-recording` deletes one recording's voices. The README's "Voice prints" section is what to show a
person who asks what is kept, where, and what remains after a forget.

## common mistakes

| mistake | reality |
|---|---|
| answering the question from the attendee list, the transcript or a proposal | only a person answers; an agent never calls `--answer` or `--confirm` on its own |
| asking per recording, or in the middle of a run | one question at the end of the run, for every recording `waiting` |
| `--answer` without `--shown` first | the record stays `waiting`; run `--shown` right after putting the message to the person |
| `--shown` in an unattended run | nobody was shown anything; the next attended run must ask |
| `--confirm` with no label | name the labels the person confirmed |
| writing a name into `transcription.speakers` by hand | it is unverified and teaches nothing; answer the question instead |
| re-running `/transcribe-recording` to fix one wrong name | `identify --correct` |
