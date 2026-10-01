# @dreamteamer/meeting-docs

The three things written around a call: a short prep to read before it, a neutral summary after it,
and an honest critique built on the transcript. Plus the tasks a call produces, and one command that
runs the whole pipeline from calendar sync to critique.

```bash
npm install @dreamteamer/meeting-docs @dreamteamer/meetings @dreamteamer/recordings @dreamteamer/tasks @dreamteamer/contacts @dreamteamer/companies @dreamteamer/users @dreamteamer/tags @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| preps, summaries, critiques and extracted tasks, and `prep` · `summary` · `analyses` stamped onto every meeting | every module it needs is in the install line above; nothing else changes it |

| needs | for |
|---|---|
| `@dreamteamer/meetings` | the meeting each document hangs off |
| `@dreamteamer/recordings` | the transcript summarise, extract and analyse are gated on |
| `@dreamteamer/tasks` | the follow-ups a call produces |
| `@dreamteamer/contacts`, `@dreamteamer/companies` | who a prep is about |

The module also ships the `/meetings/pipeline` view: which recent meetings have a prep, a summary,
a critique.

A prep can be written for any meeting, with no recording. A summary, its tasks and a critique need a
transcribed recording; their commands are offered on a meeting only once one of its recordings has
been transcribed.
