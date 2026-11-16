---
name: identify-speakers
description: name a transcribed recording's speakers from voice prints, and ask about the rest once, at the end of the run
argument-hint: <meeting-recordings/id> [more recording refs…]
---
load the `identifying-speakers` skill. for each recording ref in: $ARGUMENTS — run `identify` on it through
the module's entry and report each label's line from the printed JSON (named, proposed, or why not). Names
written from voice prints are provisional; a transcription never writes one.

then **one question at the end of the run**, for every recording still `waiting`: `identify --question` with
all their refs returns one message — each unknown voice with two quotes and their timestamps, the meeting's
attendees as the choices, and the names written from voice prints, unconfirmed. Put that message to the
person as it is, run `identify --shown` with the same refs right after, and apply the person's reply with
`identify --answer`, one call per recording. Relay the reply: it names each person whose voice print was
stored or changed, and the documents written from the transcript before the names.

**An agent never answers the question itself and never calls `--answer` or `--confirm` without a person's
reply in the conversation.** In an unattended run nobody is there to ask: ask nothing, run no `--shown`, and
report the recordings left `waiting` — the next attended run asks their questions.

`dt next meeting-recordings/<id>` offers this command while `speaker_naming` is empty or `waiting`.
