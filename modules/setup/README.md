# @dreamteamer/setup

One board for every official dreamteamer module a workspace has. It reads which modules are installed,
on every channel, and says for each optional capability whether it is ready, degraded or unavailable,
with the fix on the same line.

```bash
npm install --save-dev @dreamteamer/setup
npx dt-setup doctor      # the board; changes nothing, spends no network request
npx dt-setup setup       # the in-workspace edits the board asks for, one question each
```

`setup` only edits files inside the workspace: it declares the template variables the installed
modules use, adds their keys to `.env.example` (and creates `.env` with every value blank), and chains
each installed module's record guard into `npm run check`. It never installs software and never logs
in; it prints those steps for a person to run.

| verb | what it does |
|---|---|
| `dt-setup doctor [--strict] [--json]` | the board; exit 1 under `--strict` when anything is not READY |
| `dt-setup setup` | the edits above, asking before each |
| `dt-setup link <clone>` · `unlink` | preview a local clone of dreamteamer-modules in place of the published modules, as `git_modules/dreamteamer-modules`; a pre-commit guard refuses record commits while it is on |

Nothing is required: every module reads and writes records with no setup at all. Engine `>=0.30.0`.
Apache-2.0.

### Optional account capabilities

Installing `@dreamteamer/git-identities` adds a local identity diagnostic. Set
`GIT_IDENTITIES_CONFIG` in the process environment to your private configuration file
outside Git. The doctor checks the current repository against that configuration;
it does not run SSH, create keys, change machine settings or prove remote access.

Installing `@dreamteamer/google-workspace` adds its local prerequisite diagnostic.
The doctor does not authorize accounts or test cloud access. Follow that module's
onboarding instructions and authorize each selected account separately. Neither
capability copies another person's credentials or automatically shares records.

### Local evidence is not an end-to-end test

The board reads process environment settings before workspace `.env` values. It checks configured
folders locally without printing their values. Calendar rows need an explicit account, and credential
file presence is reported separately from consent, token expiry, scopes and remote access; the latter
remain unverified until an owner-authorized read test.

Transcription diagnostics check both diarization files, a nonempty CPU model cache file and the external
Python environment. These are prerequisite checks, not model-integrity or Python-import tests. Model
setup advice exports the external cache and environment for the entire command chain. A short synthetic
recording must still verify the selected engine; request `--engine metal` when GPU recognition is required.
Diarization remains CPU. Doctor neither downloads weights nor installs tools nor starts authentication.

### Module-owned checks

Some capabilities now belong to their module, which ships a `SETUP.md` and its own local inspect.
`lib/capabilities.mjs` keeps a compatibility ownership map (`OWNERSHIP`): a legacy row is replaced by
the module's rows only when that module is installed, enabled, ships a provider this release
understands, and its inspect actually returns every check the row stood for. Otherwise — an older
module, a disabled one, a provider that fails — the legacy row stays, so each check appears once.
Today that covers `meetings` (calendar rows, credential files, account access) and
`google-workspace` (its local prerequisites). The board names the owning module and its `SETUP.md`;
setup steps themselves are the module's, run from that file, not from `dt-setup setup`.

Mounted-file diagnostics appear in the engine's `doctor`, and so do `google-workspace`'s local rows.
