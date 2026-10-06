---
name: sync-files
description: bring data/files level with the disk — walk each file-drives folder (or one drive, or one subfolder) and add, update, mark missing or rename its files records
argument-hint: "[<drive>[/<subfolder>]] [--dry-run] [--hash] [--rehash] [--prune]"
---
load the `working-with-files` skill, then run the sync for: $ARGUMENTS (default: every drive).

1. `npx dt files sync $ARGUMENTS --dry-run` — read the plan. On a drive's FIRST sync the `added`
   count is the number of records about to be written; if it is far from what you expected, check
   the drive's `include` list before going on.
2. `npx dt files sync $ARGUMENTS` — quote the summary line per drive, and name every drive that was
   skipped and why (its variable, its `index`, or the mount).
3. `npx dt check`, then commit scoped, as the pending line says: `npx dt commit file-drives/<drive>
   files/<drive>/…`, naming each entry this run wrote — never an unscoped commit.

Sync never touches `description`, `tags` or `notes` on an entry, so re-running it is always safe.
