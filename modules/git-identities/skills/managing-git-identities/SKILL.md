---
name: managing-git-identities
description: Use when setting up multiple Git identities, cloning into identity folders, checking which account authors commits, or diagnosing wrong SSH account routing. Plans changes and verifies local Git configuration without changing authentication.
---

# Managing Git identities

Keep commit authorship, remote authentication and AI subscription separate. This module owns only
Git identity planning and inspection; it does not switch assistant accounts or handle their tokens.

1. Ask which provider accounts actually differ. One user with organization access may use one key.
   Identify the private repository destination and shared repositories without reading credentials.
2. Read the package README. Build the private configuration outside tracked files using the owner's
   paths, identity values and SSH aliases. Never use another person's configuration or keys.
3. Run `npx dt-git-identities plan <private-config.json>`. This prints a proposal only. Review existing
   Git/SSH configuration before proposing edits; obtain approval for the concrete machine changes.
   Preserve existing entries and backups. Do not create keys, change permissions or add provider
   credentials just because a plan exists.
4. Clone using the explicit SSH alias into the intended identity folder, only when authorized.
   Folder matching does not authenticate the initial clone. Do not add global URL rewriting by default.
5. Run `npx dt-git-identities doctor <private-config.json> <repository>` for each actual working tree.
   A green local check proves neither remote authorization nor account ownership. Inspect effective
   Git values privately if it fails. A linked worktree may resolve includes against the primary Git dir.
6. If authorized, verify SSH authentication and the provider's account greeting. Do not suppress
   unknown host-key checks. Confirm remote read/write scope separately before pushing.

No network connection, credential read or global-file write is performed by the module's CLI.
Never place generated plans, private configurations or keys in a public repository. Account routing
is a machine-level preference, not an instruction to send private project content to another account.
