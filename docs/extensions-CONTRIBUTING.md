# contributing

This package was cut out of a private personal work vault on 2026-09-09 and scrubbed. Everything
below exists to keep it that way.

## the one rule

**No personal data. Ever.** Not in a record, not in an example, not in a comment, not in a commit
message. No real names, no employer or client names, no email addresses, no home paths, no Drive or
calendar ids, no credentials, no real figures.

Use the **synthetic cast** the `dreamteamer/recipes` repo established, so examples stay coherent:

| role | use |
|---|---|
| the operator | **Dana Oren** · `dana.o@northwind.example` |
| a colleague | **Sam Diaz** · `sam.d@bright.example` |
| the employer | **Northwind** |
| a consultancy | **Bright** |
| a client | **Harbor Mutual** · **Priya Raman** is their champion |
| a lead | **Finpath** |
| anything else | `*.example` addresses, `<angle-bracket>` placeholders |

**Keep the measurement, drop the identity.** "87 minutes in a 30-minute slot" is the finding; whose
call it was is not.

## the gates, and what each one proves

`npm test` runs four package-level gates and every module's own suite:

- **`tests/modules-structure.test.mjs`** — the package is a bundle; every module has a manifest with a
  description and an engine range; every `templates:` reference stays inside its module; every
  `x-reference` target is owned, a declared dependency, a declared peer, or core; dependencies form no
  cycle; every peer is provided by another module here.
- **`tests/compiles-alone.test.mjs`** — each module, copied into a virgin `dreamteamer init` workspace
  with only its declared dependencies, compiles and checks clean on the pinned engine. A module
  without its hard dependency must be refused by name. This is the gate that caught the first draft's
  boundary error.
- **`tests/leak-gate.test.mjs`** — no source-vault name, no machine path, no real-looking address, no
  credential shape, no Drive id. Hebrew only in the files `.leak-scan-allow` names, each with its
  reason; that file is read by this test and by the `leak-scan` workflow, so there is one answer.
- **`tests/resolvers-skip-git-modules.test.mjs`** — every script that finds its workspace by walking up
  to `package-lock.json` skips a candidate sitting directly inside `git_modules/`.

Three `record-judgement` tests read the compiled descriptor and skip by name when the package is
checked out standalone; they run from a consuming workspace.

## the layout

```
modules/<name>/          one module: package.json, collections/, skills/, commands/, ui-views/ …
bin/extensions.mjs       the CLI: setup, doctor
lib/capabilities.mjs     every check the CLI makes, defined once
tests/                   the package-level gates
.leak-scan-allow         where Hebrew is allowed, and why
```

Sources are flat at each module root. A `modules/` folder at the package root is what makes it a
bundle; a `modules/` folder inside a module is a compile error.

## module boundaries

`assets ← contacts ← meetings ← recordings`, `tasks ← meetings`, `perspective` alone, `notebooks` alone,
`rnd` alone. `contacts` peers `meetings`; `notebooks` and `rnd` peer `companies`. A relation between two modules belongs to the one holding the foreign key: it
declares `x-inverse`, and the engine stamps the mirror onto the other collection only when that module
is installed. A peer excuses a *reference*, never a *mirror*.

## where changes come from

The vault this was cut from keeps its own copies and does **not** consume this package. Changes are
discovered there first and carried here hunk by hunk, read one at a time. A sync script is exactly the
thing not to build.

## the CLI

`bin/extensions.mjs` runs inside a *consumer's* workspace. `doctor` is read-only by construction:
no network, no file writes. `setup` does only the in-workspace edits it lists up front and prints
everything else as a fix for a person to run — never a subprocess for an install or a login. A check
opts into being run by passing `run`; `fix` is prose and is never executed.
