---
name: analyze-meetings
description: review a call critically — validate and scrutinise what was said, and write ONE `meeting-analyses` record for the arc
argument-hint: <meetings/id> [more meeting refs…] [lens]
---
load `analyzing-meetings`. write ONE `meeting-analyses` record covering every meeting ref in:
$ARGUMENTS — one report per arc, not per call, so two calls with the same client on the same day are a
single record with both refs in `meetings`.

**First, read each meeting's `privacy`.** A meeting with `privacy: restricted` is not reviewed: leave
it out of the record and say so in one line — *"`meetings/<id>` has `privacy: restricted`: not
reviewed"*. When every ref is restricted, write nothing. A meeting with no `privacy` value is `open`.

**Read the raw transcripts off the recordings, not the summaries.** On each recording, read
`transcription.speakers` (the map from transcript labels to people), `transcription.notes` (the
transcriber's own caveats) and the recording's top-level `notes` (a person's note about the capture)
before anything else, and set `evidence_quality` from them; never attribute a line through a
label the map does not name, or in a recording whose notes say attribution is unusable. The summaries
come last, and only to make sure you have not rewritten them.

Write the review in the language the meetings were held in — the transcript's
`transcription.language`.

**Verify the checkable claims** — credentials, standards, market and legal facts. WebSearch when your
knowledge may be stale or the claim's truth changes the advice. Unverified assertions dressed as
findings are worse than no findings.

Anchor every finding to a `[MM:SS]` timestamp with the words quoted, and give every finding its cheap
fix. Split the suggestions into *the engagement* and *you*, and mark the highest-leverage one.

If a lens was passed after the refs, weight the review toward it. Default lens: objective validation and
scrutiny of everything you said — technical accuracy, compliance and factual framing, and
commercial posture.

Set `about` to the `engagements/<id>` the meetings belong to (it takes an engagement, never a
company), `meetings` to every ref reviewed, `summaries` to the summaries you checked against,
`reviewed` to whose conduct was scrutinised (your own `users/<id>` record unless told otherwise), the
quad (`author: agents/<harness>` — `agents/claude-code` under Claude Code — with the model in
`creation_context`), and leave `follow_up` empty.

Then report: the verdict in one line, the findings by severity, and — explicitly — **anything in the
engagement's own records the review now contradicts** (a `next_steps` item the review says is the wrong
first move, a summary that reads more favourably than the transcript supports). Flag those; do not fix
them here.
