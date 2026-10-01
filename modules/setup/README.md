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
