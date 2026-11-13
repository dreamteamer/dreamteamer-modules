# Every module on the setup contract (CR-dt-006, phase 2)

`tests/install-contract.test.mjs` installs every package below into a fresh workspace on the candidate
engine — `dt install @dreamteamer/<module> --from <one folder of tarballs>`, never the registry — and
holds its `dt status` line to the outcome this table declares. Three outcomes:

- **unit** — the module ships a setup unit (`lib/<module>-setup.mjs` exporting `SETUP_UNIT`): it has
  inputs or a machine prerequisite, and `status` reads `configured` / `blocked` / `ready` honestly.
- **no setup** — nothing to set up; `status` reads `no setup`, with `needs: KEY` when the module
  declares an env key or var nobody set.
- **library** — a package other packages build on (the UI, the protocol): it
  installs and compiles, contributes no rows, reads `no setup`.

| module | dependencies | outcome | unit inputs |
|---|---|---|---|
| assets | — | no setup | |
| code | — | no setup | |
| companies | assets | no setup | |
| contacts | assets, companies | no setup (needs LINKEDIN_USER_AGENT) | |
| core | composes twelve | unit (meetings, recordings, files) | the origins' |
| docker-workspaces | — | no setup | |
| engagements | companies | no setup | |
| files | — | unit | files_folder |
| git-identities | — | unit | — (identities per repo) |
| google-workspace | — | unit | credentials_dir, client_secret, account |
| http | — | no setup | |
| knowledge | core | no setup | |
| meeting-docs | six | no setup | |
| meetings | contacts, companies, users | unit | calendar |
| notebooklm | — | unit | — (the vendor CLI, a login) |
| perspective | — | unit | asana_pat |
| projects | users | no setup | |
| proofs | — | no setup | |
| protocol | — | library | |
| recordings | meetings | unit | transcription_home, files_folder, inbox_folders |
| rnd | composes wikis, notebooklm | unit (notebooklm, wikis) | the origins' |
| routines | — | no setup | |
| search | — | unit | — (qmd on PATH) |
| tasks | users | no setup | |
| ui | — | library | |
| users | — | no setup | |
| web | — | no setup | |
| wikis | — | unit | — (qmd on PATH) |
| workflows | — | no setup | |
| worktrees | — | no setup | |
