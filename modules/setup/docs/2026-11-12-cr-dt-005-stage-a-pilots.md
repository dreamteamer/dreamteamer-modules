# CR-dt-005 Stage A — module-owned setup pilots (google-workspace, meetings)

Design history, not shipped. Records what the two pilots established, against the falsifiable
metadata gate in the CR-dt-005 design (revision 2026-11-12, point 2). Synthetic fixtures only: no
live OAuth, no account access, no model download and no GPU run happened in this work.

## What was built

- **Convention, not contract.** Each pilot ships `SETUP.md` at its package root (in `files`) and a
  provider module `lib/<id>-setup.mjs` exporting `SETUP_PROVIDER` (`protocol: 1`, `module`, `checks`,
  `actions`) and `inspect` / `plan` / `apply`. A byte-identical helper, `lib/setup-kit.mjs`, is carried
  by each module (workspace identity, fingerprints, confined atomic writes with a stale check
  immediately before rename, a span-preserving `.env` edit, redaction). No engine field, descriptor or
  orchestrator.
- **google-workspace** became an API 1 extension (`lib/extension.mjs`): the namespaced command
  `dreamteamer google-setup inspect|plan|apply` and engine doctor rows. `dt-google doctor` is now a
  projection of the same inspect and is byte-identical to the previous report (pinned by a test that
  keeps the old implementation as the contract). Its one local action creates the owner-only credential
  directory outside the workspace; consent and live reads remain the owner's, through the existing
  `dt-google auth` and `dt-google call`. Engine floor raised 0.30.0 → 0.31.0, the floor for code
  modules (house rule 9).
- **meetings** ships `bin/setup.mjs` instead of an extension (see gap 1). Its one local action merges
  `WORK_CALENDARS` rows into the workspace `.env`, keeping every other byte. The live check is the
  existing `gcal.mjs access`, run by the owner.
- **dt-setup** keeps a compatibility ownership map (`OWNERSHIP` in `lib/capabilities.mjs`). A legacy
  row gives way only when the owning module is installed and enabled, its provider loads and speaks a
  listed protocol, declares the check ids, and its inspect actually returns them. Otherwise the legacy
  row stays. `capabilities(root)` without providers is the unchanged legacy board.

## The metadata gate, answered

1. **Does check-to-repair mapping require parsing unstructured prose?** No, within a provider: plan
   actions are JSON with `id`, `state`, `effects`, `preview`, `command` (argv) and a `reason` that names
   blocking check ids. Prose is needed once, to learn how to invoke a module's setup (an engine command
   for google-workspace, a node script for meetings); `SETUP.md` carries that, which the design requires
   the agent to read anyway. Not by itself a reason for Stage B.
2. **Does a compatibility wrapper need machine enumeration?** Yes, and it was met without the engine:
   dt-setup needs which module owns which legacy row (its own map, as design point 11 asks), where the
   provider lives (a path convention in the map) and which checks it supplies (the provider's
   `SETUP_PROVIDER.checks`, confirmed against its actual inspect output). This is a private first-party
   convention; it does not extend to third-party modules.
3. **Can capability status be derived reliably from checks?** Not through the API 1 doctor row alone.
   `ok/warn/bad` cannot tell *configured but unverified* from *missing*, and a check that no local
   inspection can ever satisfy (account authorization) would keep any workspace that installs the module
   DEGRADED forever. The pilots therefore keep a richer `status` (`ready`, `configured`, `unverified`,
   `missing`, `blocked`) in their own JSON and in dt-setup's board, and the Google engine rows omit the
   authorization row and never use `bad`. Observed on the engine under test: `dreamteamer doctor
   --strict` still exits 0 with google-workspace installed and unconfigured. **Unresolved**: whether the
   engine doctor should gain an informational/unverified row state is an engine question for a reviewed
   amendment, not something a module can settle.

## Concrete unresolved gaps

1. **Composition and the one extension.** `core` composes `meetings`, and the compose script allows a
   single origin extension (`files` holds it). So meetings contributes no API 1 command or doctor rows.
   Its setup runs through its own script, and its checks reach a board only through dt-setup.
   - **Resolved after review:** `scripts/compose-core.mjs` now composes every origin's root
     `SETUP.md` (under the same rewrite) into one generated root `SETUP.md` in the composed package,
     listed in `files`. Packed `core` therefore routes to its own `bin/meetings-setup.mjs`.
   - A plan's `command` argv is resolved from where the provider was loaded, so it names the installed
     script on the direct, inline-copy and core-only channels. Tested by executing the generated argv
     in each.
   - The generic setup reference (engine, another worker) has to accept an explicit provider-owned
     script argv as well as an extension command. Coordination confirmed it will. No engine logic
     knows about either pilot.
2. **Environment source.** google-workspace's checks read the process environment only; a workspace
   `.env` value does not reach them. The unpublished env-loader fix on another branch was deliberately
   not merged. The meetings reader takes `WORK_CALENDARS` from the environment or `.env`, but its
   credential and client paths from the environment only; the meetings inspect follows the reader, which
   differs from the legacy board (which also read `.env` for those paths).
3. **Model and GPU evidence are not in either pilot.** The design names meetings as the owner of model
   downloads and GPU evidence; in this repository that code is the `recordings` module, whose checks stay
   legacy rows in dt-setup. Not piloted here.
4. **Write guarantees are optimistic, not transactional.** `writeScoped` checks the fingerprint
   before writing and again just before the rename, and removes its temporary file on every failure
   it survives. The last check and the rename are two system calls, though, so a writer acting in that
   instant can still be overwritten, and a killed process can leave a temporary file. Plans then block
   until a person removes it, because it may hold account addresses and need not be ignored by Git.
5. **Keeping `.env` out of Git.** In a repository, Git decides: untracked and `git check-ignore`. Plan
   and apply each run that read-only Git, and apply asks again just before the rename. Inspect starts
   no process. Outside a repository the policy is deliberately static: an exact `.env` line and no
   negation line at all. This blocks some workspaces that would in fact be safe.
6. **Google's credential directory.** The preview binds the canonical target and the parent's
   device and inode. Only the last folder is created, never an ancestor. An existing directory is
   never re-permissioned: one others can access is `blocked`, not `done`. A swap of the parent between
   the last check and `mkdir` is detected afterwards and reported, not undone.
7. **The compose script drops executable bits** when it rewrites a copy
   (`core/bin/tasks-migrate-lanes-to-tags.mjs`, `core/bin/workflows-install.mjs`); they were restored by
   hand after recomposing. Pre-existing, unrelated to setup.

## Not claimed

No live OAuth, account read, calendar access, model download or GPU run was performed or simulated
beyond synthetic files and a mock MCP server. No real-agent conversation (C1–C9) was run. Each SETUP.md
says what evidence makes a capability *ready*; nothing here produced that evidence.
