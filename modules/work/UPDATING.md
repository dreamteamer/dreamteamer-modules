# Upgrading to Work 0.3

0.3 only adds: fields, views, a nav fragment, a skill and a command. No record is rewritten, no id changes, and every record valid under 0.2 stays valid.

- **Your own overlays of the same fields.** A workspace that already declares `task_code`, `latest_update`, `latest_update_at`, `goals`, `raw_input`, `asked_by`, `ask_sessions` or `parent_task` on tasks, `tasks`, `decisions` or `project` on goals, `needs_operator`, `suggested_next_step`, `next_step_owner` or `recap_saved_at` on sessions, or the open-decision fields on decisions (`status`, `raised_on`, `question`, `options`, `lean`, `how_to_settle`, `blocks`, `severity`, `question_kind`) can keep its overlay — it is merged key by key over Work's — or remove those keys once `dt compile` and `dt check` pass without them. Keep any value your records use that Work does not list (an extra task status, an extra strategy category) in your overlay.
- **Views of the same id stop `dt compile`.** A view is never shadowed: a workspace view (not `overlay: true`) with the id of a view Work now ships is refused, naming both files. For each one, delete yours when Work's is what you want, keep only your differences as `overlay: true`, or add `"ui-views/<id>"` to `dreamteamer.disable`. Views your workspace keeps for its own domains, clients or tooling, under ids Work does not use, stay yours. The views 0.3 adds, then its overlays of the Tasks package's views:

  ```text
  decisions-by-project decisions-open decisions-parked goals-3d-tree goals-by-project
  sessions-active sessions-blocked sessions-by-goal sessions-by-project sessions-by-status
  sessions-needs-operator sessions-no-status sessions-planned sessions-verified-done
  tasks-by-goal tasks-by-parent tasks-by-project tasks-queued
  inbox tasks-board tasks-by-assignee tasks-list tasks-mine tasks-suggested
  ```
- **The nav.** Your `nav.yaml` is never reordered. Rows you have not placed are added in the everyday order; to move the rest, see the README.
- **Verify** with `dt compile`, `dt check`, the sidebar of Goals, Tasks, Sessions and Decisions, and one open decision written and then decided.

## Upgrading from 0.1 to 0.2

Back up and inventory existing collection owners first. If consuming Work 0.1, retain the existing records, IDs and legacy schemas. If consuming a workspace preview, remove or convert only overlapping descriptors, not data. Keep local Tasks/Sessions bases when they are more capable or differ in IDs or storage; do not install a duplicate upstream base. Retain local presentation and private provenance settings. Move the existing Decisions nav entry into Work without duplicating it; Projects remains the only Decisions base. Do not rewrite IDs, old free-text session fields, affects or supersession. Verify with dt compile, dt check, navigation inspection and a round-trip Decision → Tasks → Decisions.

View IDs and safe existing routes are retained where the same generic view is adopted. Remove only matching workspace-local base declarations in the migration, or retain their local display differences as explicit overlays. Keep existing workspace-only nested goal filters, review/meeting integrations, local task-code and recommendation columns, task route overlays against the Tasks package, and a two-panel strategy page as compatibility views. Move the active Work navigation once; no other installed nav is changed. An older local Sessions route can remain a local alias; portable Recaps uses /work/sessions/recaps.

Work uses the shared tag format: lowercase words separated by hyphens, optionally
with a lowercase hyphenated key and a colon. Inspect existing labels before
moving schemas. Keep historical exceptions in a workspace-specific overlay
while you review them; do not silently rewrite historical records.
