---
name: run-retrospective
description: run or resume a retrospective — read a contributor's evidence, build their operating model, one stage per invocation
argument-hint: "[hint — period:… since:… sources:… contributor:… repos:… | prose] [keep going]"
---
load `running-retrospectives`. It owns the procedure; everything below is scope.

**Parse `$ARGUMENTS` as a hint** — the grammar is in the skill (`period:` · `since:` · `until:` ·
`sources:` · `contributor:` · `repos:`, plus free prose). Keep the whole argument VERBATIM for
`retrospective-sessions.hint`; do not normalise it.

**Find the run.** List `perspective/retrospective-sessions`, drop anything at `done` or `abandoned`, and
take the latest whose `contributor` matches the hint's `contributor:` — or the only one left, when
the hint named none. If none remains, create it:

```
dt add perspective/retrospective-sessions --contributor <a slug: dana-o, never an address> \
  --started <today> --stage installed --on_workspace <existing if data/ holds records outside this
  module, else fresh> --handles <every address they commit, file and write under, comma-separated> \
  --hint "<the argument, verbatim>"
```

`contributor` is the SLUG every evidence and model id begins with, so a re-run updates the model
instead of copying it; `handles` is what the readers match a commit, a ticket or a message against.
Giving one address where the person uses three is the failure that attributes their own work to a
stranger — ask for all of them.

When the hint carries a `contributor:` the existing record does not have, say so and ask before
writing to it — a run is one contributor's perspective, and a second contributor is a second run.

**Several contributors on one project is normal, and each gets their own observed world.** The
`perspective/world/*` collections are keyed by the contributor, so four runs over one shared plan
produce four views of the same real activities rather than one merged view — deliberately: a shared
record would mean four runs writing one file and the last one silently winning, and where two views
disagree the disagreement is the finding. The join between them is `real`, the one-way soft pointer
at the workspace's own `users` · `projects` · `activities` · `activity-lanes` · `tasks` · `goals` record. ⚠ **Never set
`real` yourself.** It is a proposal a person confirms, exactly like `contact`.

**Run the NEXT stage after `stage`** — exactly one, unless the argument says "keep going". Advance
`stage` only after that stage's records are on disk and `npm run check` is clean; on a dirty check,
stop at the old stage and report what failed.

**End by** quoting the stage's receipt line verbatim (the reader's counts, or the records written
and reused), naming the next stage in one line, and saying that `/run-retrospective` resumes from
here.
