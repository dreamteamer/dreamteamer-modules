# @dreamteamer/search

Search over a workspace's own records. `dt-find` climbs an effort ladder: exact words first, then
meaning, then both at once, then the reference graph for questions whose answer is defined by a link.
Every rung prints file:line locations, never a paraphrase.

```bash
npm install @dreamteamer/search
npx dt-find "<question>"
```

Every rung runs on `qmd` (`npm install -g @tobilu/qmd`), which is fully on-device: no account, no key,
no network. Without it `dt-find` exits with an install hint; plain `grep` still answers any question
asked in the records' own words. To search one assembled corpus of prose instead, use **wikis**.

## 0.2.0 — on engine 0.47.0 (CLI-first module lifecycle, CR-dt-006)

Nothing to do but `dt compile` after `dt update @dreamteamer/search` on dreamteamer 0.47.0 or later (the engine floor is `>=0.47.0`). New: the `search` setup unit (`dt setup search`): qmd on PATH.
