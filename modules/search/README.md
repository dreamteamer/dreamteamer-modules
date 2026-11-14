# @dreamteamer/search

Search over a workspace's own records. `dt-find` climbs an effort ladder: exact words first, then
meaning, then both at once, then the reference graph for questions whose answer is defined by a link.
Every rung prints file:line locations, never a paraphrase.

```bash
npm install @dreamteamer/search
npx dt-find "<question>"
```

To search one assembled corpus of prose instead, use **wikis**. A session reaches the ladder through
`/find`, and the `searching-a-workspace` skill says which rung a question deserves.

## setup

Every rung runs on `qmd`, which is fully on-device: no account, no key, no network. The module's
setup unit, `search`, checks that `qmd` is on PATH and can install it for you:

```bash
npx dreamteamer status                                         # blocked, naming qmd, until it is there
npx dreamteamer setup search --allow machine --allow network   # runs npm install -g @tobilu/qmd
```

Without it `dt-find` exits with an install hint; plain `grep` still answers any question asked in
the records' own words. [SETUP.md](SETUP.md) is the reference.

## 0.2.0 — on engine 0.47.0 (CLI-first module lifecycle, CR-dt-006)

Nothing to do but `dt compile` after `dt update @dreamteamer/search` on dreamteamer 0.47.0 or later (the engine floor is `>=0.47.0`). New: the `search` setup unit (`dt setup search`): qmd on PATH.
