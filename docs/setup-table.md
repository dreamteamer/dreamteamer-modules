# Every module on the setup contract (CR-dt-006, phase 2)

`tests/install-contract.test.mjs` installs every package below into a fresh workspace on the candidate
engine — `dt install @dreamteamer/<module> --from <one folder of tarballs>`, never the registry — and
holds its `dt status` line to the outcome this table declares. Four outcomes:

- **unit** — the module ships a setup unit (`lib/<module>-setup.mjs` exporting `SETUP_UNIT`): it has
  inputs or a machine prerequisite, and `status` reads `configured` / `blocked` / `ready` honestly.
- **no setup** — nothing to set up; `status` reads `no setup`, with `needs: KEY` when the module
  declares an env key or var nobody set.
- **library** — a package other packages build on (the UI, the protocol): it
  installs and compiles, contributes no rows, reads `no setup`.
- **preset** — a module preset (`dreamteamer.preset`, engine 0.49): it ships no source and no unit;
  `dt install` brings every member at its pinned version, and `dt status` lists the preset with its
  members, each installed. The members' own units read on their own rows.

| module | dependencies | outcome | unit inputs |
|---|---|---|---|
| artifacts | — | no setup | |
| assets | — | no setup | |
| code | — | no setup | |
| companies | assets | no setup | |
| contacts | assets, companies | no setup (needs LINKEDIN_USER_AGENT) | |
| core | members: seventeen | preset | the members' |
| docker-workspaces | — | no setup | |
| engagements | companies | no setup | |
| files | — | unit | files_folder |
| git-identities | — | unit | — (identities per repo) |
| google-workspace | — | unit | credentials_dir, client_secret, account |
| http | — | no setup | |
| knowledge | core | no setup | |
| meeting-docs | six | no setup | |
| meetings | contacts, companies, users | unit | calendar |
| metrics | users | no setup | |
| notebooklm | — | unit | — (the vendor CLI, a login) |
| perspective | — | unit | asana_pat |
| projects | users | no setup | |
| proofs | — | no setup | |
| protocol | — | library | |
| recordings | meetings | unit | transcription_home, files_folder, inbox_folders |
| responsibilities | users | no setup | |
| rnd | — | no setup | |
| roles | users | no setup | |
| routines | — | no setup | |
| search | — | unit | — (qmd on PATH) |
| sessions | users | no setup (needs SESSIONS_FOLDER) | |
| tasks | users | no setup | |
| ui | — | library | |
| users | — | no setup | |
| web | — | no setup | |
| wikis | — | unit | — (qmd on PATH) |
| workflows | — | no setup | |
| worktrees | — | no setup | |
