---
name: restore-notebook
description: rebuild the NotebookLM notebook a `notebooks` record describes — its sources and chat configuration — on the current or a named Google account
argument-hint: <notebooks/id> [--account <label>] [--title <title>]
---
load the `using-notebooklm` skill, then restore the notebook from its record:

```bash
npx dt-notebook restore <id> --dry-run            # the plan, one line per call, no network
npx dt-notebook restore <id> [--account <label>] [--title <title>] [--replace]
```

the verb does the work — `create`, one `source add` + `wait` + `rename` per entry of `sources` in
order, then ONE `configure` from `chat` — and writes `notebook_id`, `account` and every `source_id`
back onto the record. never `configure` by hand around it. it refuses, naming the field, when the
record cannot be restored as written (a `text` source with no `text`, a `file` under an unset
`${env:…}`, `mode` and `persona` both set); fix the record, not the command.

before running without `--dry-run`: `notebooklm auth check --test` — an expired session is the
operator's `notebooklm login`, and `--account` must name the login that session IS. a record with a
live `notebook_id` is refused unless `--account` (a copy elsewhere) or `--replace` (re-create here)
says which you mean; the old uuid stays in git history.

afterwards: `npx dreamteamer check`, then commit `notebooks/<id>` scoped — the record is what changed.
