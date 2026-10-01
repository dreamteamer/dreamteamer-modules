---
name: exporting-to-notebooklm
description: "Use when the workspace should be read by NotebookLM rather than a coding agent — `dt notebooklm`, exporting or syncing the workspace into a notebook, choosing a plan or shard size, keeping a collection or a field out of the export (`sensitive: true`, `x-sensitive: true`), writing or pasting the notebook persona, reading or maintaining NOTEBOOKLM.md, or a sync that added, replaced or removed the wrong sources."
---

# exporting to NotebookLM — the workspace for a reader that is not a coding agent

`compile` renders the runtime for harnesses that read files. `dt notebooklm` renders it for a
consumer that does not: **NotebookLM**, which holds a bounded number of *sources* per notebook and
takes its standing instructions as a 10,000-character *persona*. `dt help` has the flags; this page
has the judgment. Both halves come from the `notebooklm` module — the verb, and the
`notebooklm` harness (add it to `dreamteamer.harnesses`) that keeps `NOTEBOOKLM.md`'s configuration
block current on every compile.

## what travels, and what never does

Sensitivity is SCHEMA, decided once where the field is declared — never a flag on the export and
never inferred from a field's name (`email` travels unless somebody marked it):

- **a whole collection**: `dt set collections/<c> sensitive=true`. No record of it is written; the
  schema source and the persona NAME the omission so the reader knows the gap is deliberate, and
  the entry stops there — no field names, enum values or authored examples of it travel.
- **one field**: `dt add-field <c> --name <f> … --sensitive`, or `dt set-field <c> --name <f>
  --sensitive` (`--sensitive false` clears). The field is projected out of every record.
- **a reference to a withheld record** is redacted wherever it appears — a field value, body prose,
  a `[[…]]` link: `ledger/rent` becomes `ledger/… (withheld)`. Ids are authored, so an id is itself
  a disclosure.

Also never exported as records: the system collections (they ARE the schema source) and `codec: file`
collections (bytes a view draws). **Before the first export of a workspace, read the report** — it
prints every field that WAS exported per collection; that list is the review.

## what a notebook gets

- **`dt · schema`** — one source: workspace → module → collection → field, one heading level per
  step, with each collection's `use when`, id shape and every field's type, enum values and reference
  target. The lexicon the persona cannot afford in full.
- **`dt · <collection>`** — one source per collection, `## <collection>/<id>` per record, references
  rendered as `companies/acme (Acme Ltd)`. Over `--max-words` it shards into `dt · <c> [n/m]`.
- **the persona** — a Markdown template with `{{workspace}}` `{{schema_brief}}` `{{sources}}`
  `{{omitted}}` `{{exported_at}}` `{{engine_version}}` `{{schema_title}}` `{{collections}}`; the
  module ships a default, `--instructions <file.md>` replaces it, an unknown placeholder is an
  error. `--response-length` rides along to `notebooklm configure`; there is no `--mode`, because the
  vendor discards the persona when `--mode` is sent with it.

**The budget is the plan's source cap** (`--plan standard|plus|pro|ultra|<n>`, default `standard` =
50). Too many sources is a refusal that names the count and the remedies — nothing is dropped
quietly. A workspace with more collections than the plan has sources narrows with `--collections`.

## syncing

Without `--notebook`/`--create` the export is a pure render into `--out` (default
`.cache/dreamteamer/notebooklm/`, gitignored) and touches no network and no vendor CLI. With one, it
makes the notebook match: adds new sources, replaces those whose content hash changed, removes its
own stale ones, then applies the persona. **Ownership is by source id**, remembered in
`notebook.json` in the out dir with each source's hash — so the next run is incremental. `--create`
is for the FIRST sync only (running it again makes a second notebook); every later sync passes
`--notebook <id>`, the id the first one printed and `notebook.json` keeps. A run with neither flag
only re-renders the bundle. A source is the export's to remove only if the state tracks its id, its
title carries the `dt · ` prefix, or its title is one of the bundle's file names (what the vendor's
dropped-title bug leaves); a source added by hand is never touched. Every vendor call names the
notebook with `-n`; `notebooklm use` is never run.

**Preflight is `notebooklm auth check --test`** — the bare check reports a stale session as valid —
and an expired login is yours to renew (`notebooklm login` opens a browser). Needs
notebooklm-py >= 0.7.3 on PATH.

## NOTEBOOKLM.md

A user-owned root file with one managed block: the settings to pick, the persona to paste, the plan
limits, and how many collections the export ships (the number that decides the plan). Your own notes
above and below the block survive every compile; removing the harness from `dreamteamer.harnesses`,
or removing the module, removes only the block. `notebooklm configure` REPLACES the whole
configuration, and `--mode` alongside a persona discards the persona — the block says so.

## asking

Not a verb here. Ask with `notebooklm ask -n <id> --json`, and treat an answer as real only when it
has non-blank text AND at least one reference — exit 0 with an empty answer is a known shape.
