# Updating @dreamteamer/sessions

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module; most of the time it is `dt compile`, then `dt check`.

```bash
npm install @dreamteamer/sessions@latest
npx dreamteamer compile
npx dreamteamer check
```

---

## 0.2.1 — no git_modules layers

A session record is written to the workspace the session runs in, found by its `package-lock.json` alone — the
engine (0.51.0) has no `git_modules/` layers to step out of. Nothing to do.

---

## 0.2.0 — the hook runs session-save by name

The code ships as its build, so `bin/session-save.mjs` is gone: the script is `dist/bin/session-save.js`. A `Stop`
hook that names the old path stops saving sessions. Repoint it at the runner, which does not depend on where the
script sits:

```
npx dreamteamer run @dreamteamer/sessions session-save --write --hook --quiet
```

No collection, field or record changes.

## 0.1.0 — out of core, a package of its own

`sessions` shipped inside the core module through core 0.11; from core 0.12.0 core is a preset of the small
modules and this is one of them. The descriptor moved verbatim — the same fields, the same storage path
and the same id shape — so no record moves and nothing is migrated. A workspace that updates core gets
this package as a preset member; nothing to do but `dt compile`.
The Stop hook line, if your workspace has one, now reads
`node node_modules/@dreamteamer/sessions/bin/session-save.mjs --write --hook --quiet`.
