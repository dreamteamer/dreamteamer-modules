# @dreamteamer/knowledge

Optional knowledge capture and synthesis for personal or shared workspaces. No records or
machine-specific configuration are shipped.

```sh
npm install @dreamteamer/knowledge @dreamteamer/companies @dreamteamer/meetings @dreamteamer/assets @dreamteamer/contacts @dreamteamer/users
```

`dt install @dreamteamer/knowledge` brings the same set: knowledge depends on `@dreamteamer/companies`
(a brief's `companies`) and `@dreamteamer/meetings` (a brief's `meetings`), and those on theirs. A
workspace on `@dreamteamer/core` already has them. Engine >=0.49.0 is required. On install the engine
places the three collections in a Knowledge folder of the workspace's `nav.yaml`, unless it already
places them. `working-with-knowledge` routes requests among:

- `blurbs`: raw thoughts, preserving `raw_input` separately from interpreted content; draft → digested.
- `briefs`: reader-facing documents with audience, purpose and sources; draft/final editorial state.
- `meta-analyses`: cross-record, cross-domain period synthesis with evidence coverage and a regeneration prompt.

Meeting preps and transcript-grounded meeting critiques remain in `@dreamteamer/meeting-docs`. A collection's presence
never authorizes publication, cross-repository sharing or automatic task creation.

## Existing local schemas

This package preserves dated IDs and the `meta-analysis` filename suffix. It preserves title vs
name, field names and statuses of the source schema family. It is not an automatic migration.
Before enabling it in an existing workspace:

1. Back up the workspace and record a hash inventory of its data files.
2. Compare all local fields, ID patterns, storage paths/suffixes and statuses with this package.
   A same-name local full definition collides; don't leave both active.
3. On a disposable copy, replace matching local full schemas with this module, leaving custom
   display choices as overlays. Run compile and check against the unchanged records.
4. Investigate every validation failure. Do not rename, drop fields or rewrite records to silence
   it. Verify hashes unchanged and representative source references still resolve.
5. Adopt only after review. Keep the old configuration for rollback; no data deletion is required.

The earlier unreleased personal-workspace prototype used different semantics and identifiers.
Its records, if any were created for a local experiment, need explicit mapping, not a blind switch.
