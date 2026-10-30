---
name: sync-files
description: bring data/files level with the disk — walk each file-drives folder (or one drive, or one subfolder) and add, update, mark missing or rename its files records
argument-hint: "[<drive>[/<subfolder>]] [--dry-run] [--hash] [--rehash] [--prune]"
---
load the `working-with-files` skill, then run the sync for: $ARGUMENTS (default: every drive).

1. `npx dt files sync $ARGUMENTS --dry-run` — read the plan before writing anything.
2. `npx dt files sync $ARGUMENTS` — quote the summary line per drive, and name every drive that was
   skipped and why.
3. Commit what the run wrote as the skill's "the verbs" section says.
