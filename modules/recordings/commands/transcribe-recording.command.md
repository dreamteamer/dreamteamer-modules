---
name: transcribe-recording
description: transcribe a recording's audio into its transcript (offline, HE+EN, diarized)
argument-hint: <meeting-recordings/id> [more recording refs…]
---
load the `transcribing-recordings` skill. for each recording ref in: $ARGUMENTS — transcribe its
`recording_file` into **that recording record**: the `## Transcript` body plus the `transcription:` provenance block,
caveats in `transcription.notes`. Names are written by `/identify-speakers`; transcription leaves `speakers` empty
— run `/identify-speakers` next.

speaker count, in order: the linked meeting's `attendees_contacts | length`; no meeting or a free/busy stub →
default 2; and **never block on the number** — if the diarizer finds materially more clusters than
expected, re-run with the observed count and note the correction in `transcription.notes`.

transcription only — never summarize, and never write a person's name on `speaker_0`: that is
`/identify-speakers`, from voice prints and a person's answers.
