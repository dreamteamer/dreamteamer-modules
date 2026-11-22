# Upgrading to Work 0.2

Back up and inventory existing collection owners first. If consuming Work 0.1, retain the existing records, IDs and legacy schemas. If consuming a workspace preview, remove or convert only overlapping descriptors, not data. Keep local Tasks/Sessions bases when they are more capable or differ in IDs or storage; do not install a duplicate upstream base. Retain local presentation and private provenance settings. Move the existing Decisions nav entry into Work without duplicating it; Projects remains the only Decisions base. Do not rewrite IDs, old free-text session fields, affects or supersession. Verify with dt compile, dt check, navigation inspection and a round-trip Decision → Tasks → Decisions.

View IDs and safe existing routes are retained where the same generic view is adopted. Remove only matching HQ-local base declarations in the migration, or retain their HQ display differences as explicit overlays. Keep existing HQ-only nested goal filters, review/meeting integrations, local task-code and recommendation columns, task route overlays against the Tasks package, and the historical two-panel strategy page as compatibility views. Move the active Work navigation once; no other installed nav is changed. For Sessions Recaps, the old HQ-specific /content/sessions route can remain a local alias; portable Recaps uses /work/sessions/recaps.

Work uses the shared tag format: lowercase words separated by hyphens, optionally
with a lowercase hyphenated key and a colon. Inspect existing labels before
moving schemas. Keep historical exceptions in a workspace-specific overlay
while you review them; do not silently rewrite historical records.
