---
name: capture-notebook-sources
description: write a live notebook's source list onto its `notebooks` record, so the record becomes the spec `restore-notebook` can rebuild it from
argument-hint: <notebooks/id>
---
load the `using-notebooklm` skill, then:

```bash
npx dt-notebook capture <id> --dry-run     # what the live list maps to, and what it cannot recover
npx dt-notebook capture <id>
```

the verb reads `notebooklm source list -n <notebook_id> --json`, maps every entry to a record source
(`web_page` → `url`, `youtube` → `youtube`, `pasted_text` → `text`, `google_*` → `drive`, the rest →
`file`) and keeps each live `source_id`. it then NAMES what the list cannot recover — a file's
`${env:FILES_FOLDER}/…` path, a pasted text's content (`notebooklm source fulltext <source_id>`
recovers it), a Drive document's id — rather than writing a record that only looks restorable.

fill those on the record by hand, then prove it: `npx dt-notebook restore <id> --dry-run`
must print a plan with no refusal. `npx dreamteamer check`, commit `notebooks/<id>` scoped.

`chat` is not captured — NotebookLM has no read-only inspection of the persona (a bare `configure`
CLEARS it), so the persona lives on the record or in `persona_file` and is written from there, never
read back.
