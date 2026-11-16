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

It needs no setup of its own; what the transcriber needs is in the `SETUP.md` of **recordings**, and
the calendar sync, with its setup, ships in `@dreamteamer/connectors-google-workspace` — without it
`/process-new-meetings` skips the sync and works from the meetings already in the workspace. Six
commands: `/prepare-for-meeting`, `/create-meeting`, `/summarize-meeting`,
`/extract-tasks-from-meetings`, `/analyze-meetings`, and `/process-new-meetings`, which runs the whole
pipeline. The `preparing-for-meetings` and `analyzing-meetings` skills carry the method behind a prep
and a critique.

A prep can be written for any meeting, with no recording. A summary, its tasks and a critique need a
transcribed recording; their commands are offered on a meeting only once one of its recordings has
been transcribed, and never on a meeting whose `privacy` is `restricted` — one that holds a third
party's private material, whose pipeline ends at the transcript (its speakers are still named — below). The three bindings name the
`privacy` field, so this module needs a `@dreamteamer/meetings` that declares it.

## Speakers named after transcription

Where the installed `@dreamteamer/recordings` ships `/identify-speakers`, `/process-new-meetings` runs it as
step 4b, after transcription and before the summary, with no command typed: it names each speaker from voice
prints kept on this computer and leaves an open question on the rest. The questions of every recording come
as **one question at the end of the run**, with the pipeline's other end-of-run questions, and only a person
answers them. The summary and the tasks are written with the names that exist; the critique and the
engagement update of a meeting with an open question wait for the answer, so each engagement takes each call
once. After the answer, the summary and tasks of a meeting whose names changed, or whose provisional names
were confirmed, are written again, and the report lists every document written before a name it now carries.
An unattended run asks nothing: it holds back the critique of each meeting with an open question and the
update of each engagement with such a meeting — a meeting an earlier run left waiting included, whatever its
date — and lists them for the next attended run. Where the installed recordings has no
`/identify-speakers`, the step is skipped and the run says so.

A meeting whose `privacy` is `restricted` is named and asked about like any other: naming is part of the
transcript, so step 4b runs on its recording, its voices are quoted in the end-of-run question, and an answer
teaches their voice prints, which stay on this computer. Its summary, tasks, critique and engagement update
stay unwritten, before the answer and after it.

A name a machine wrote from a voice print is provisional until a person confirms it: a summary, a critique
and a task write that speaker as `<Name> (unconfirmed)` — "Dana Oren (unconfirmed)" — and say the names
were machine-written. A name a person gave, one written before voice prints, or one typed over a machine
name by hand is used as before.

## Summaries

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

## 0.1.5 — /process-new-meetings runs without the calendar sync (cr-modules-018)

Wording only; nothing to do. From core 0.13.0 `/fetch-meetings` ships with `@dreamteamer/connectors-google-workspace`,
not with core: `/process-new-meetings` step 1 now says that where it is not installed, the run skips the sync, says so
in its report, and works from the meetings already in the workspace.

## 0.1.4 — the nav is nav.yaml (cr-dt-008)

`display.nav.order` and `display.nav.section` removed from its three descriptors — the nav is `nav.yaml` at the workspace root (engine 0.49), which you arrange; `display.nav.icon` stays. Nothing to do.

## 0.1.3

Engine floor `>=0.47.0` and the peer list mirrored for `dt install`'s closure; nothing else changes. `dt update @dreamteamer/meeting-docs` then `dt compile`.
