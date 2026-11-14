# Updating @dreamteamer/responsibilities

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module; most of the time it is `dt compile`, then `dt check`.

```bash
npm install @dreamteamer/responsibilities@latest
npx dreamteamer compile
npx dreamteamer check
```

---

## 0.1.0 — out of core, a package of its own

`responsibilities` shipped inside `@dreamteamer/core` through 0.11; from core 0.12.0 core is a preset of the small
modules and this is one of them. The descriptor moved verbatim — the same fields, the same storage path
and the same id shape — so no record moves and nothing is migrated. A workspace that updates core gets
this package as a preset member; nothing to do but `dt compile`.
