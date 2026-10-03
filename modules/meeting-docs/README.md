# @dreamteamer/meeting-docs

The three things written around a call: a short prep to read before it, a neutral summary after it,
and an honest critique built on the transcript. Plus the tasks a call produces, and one command that
runs the whole pipeline from calendar sync to critique.

```bash
npm install @dreamteamer/meeting-docs @dreamteamer/engagements @dreamteamer/meetings @dreamteamer/recordings @dreamteamer/tasks @dreamteamer/contacts @dreamteamer/companies @dreamteamer/users @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| preps, summaries, critiques and extracted tasks, and `prep` · `summary` · `analyses` stamped onto every meeting | every module it needs is in the install line above; nothing else changes it |

| needs | for |
|---|---|
| `@dreamteamer/engagements` | the engagement a prep reads and a critique is about |
| `@dreamteamer/meetings` | the meeting each document hangs off |
| `@dreamteamer/recordings` | the transcript summarise, extract and analyse are gated on |
| `@dreamteamer/tasks` | the follow-ups a call produces |
| `@dreamteamer/contacts`, `@dreamteamer/companies` | who a prep is about |

The module also ships the `/meetings/pipeline` view: which recent meetings have a prep, a summary,
a critique.

A prep can be written for any meeting, with no recording. A summary, its tasks and a critique need a
transcribed recording; their commands are offered on a meeting only once one of its recordings has
been transcribed, and never on a meeting whose `privacy` is `restricted` — one that holds a third
party's private material, whose pipeline ends at the transcript. The three bindings name the
`privacy` field, so this module needs a `@dreamteamer/meetings` that declares it.

A summary's id is its meeting's id, passed as `--id`, so it is filed under the month the call was
held. Its `source` lists every recording whose transcript was read, one element each; a summary that
holds a single recording as a plain string still validates.

## upgrading existing summaries

`meeting-summaries` has no `participants` field. Who was on a call is the meeting's
`attendees_contacts`, and who said what is the recording's transcript. A summary that still carries
`participants` fails `dt check` with `unknown field "participants"`: move any `contacts/<id>` it lists
into the meeting's `attendees_contacts` if it is not there already, then delete the key.

## upgrading to 0.1.2

The meetings module's 0.1.2 remodelled its people fields: the contact refs moved from `attendees` to
`attendees_contacts`, and `attendees` is now the Calendar API's own attendee list as objects. Every
procedure here that read `attendees` reads `attendees_contacts`; a prep's own `attendees` field is
unchanged and is copied from there. The summarize and analyze procedures also read a recording's
`transcription.notes` — the transcriber's own caveats, written inside the block it produces — beside
the recording's top-level `notes`, which is a person's note about the capture.
