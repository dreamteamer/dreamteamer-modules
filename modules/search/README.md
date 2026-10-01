# @dreamteamer/search

Finding things in a workspace's own records, with the cost stated at every rung. `dt-find` runs an
effort ladder: exact words first (instant), then meaning, then both at once, then the reference graph
for questions whose answer is defined by a link. Every rung prints file:line locations, never a
paraphrase.

```bash
npm install @dreamteamer/search
npx dt-find "<question>"
```

`qmd` (`npm install -g @tobilu/qmd`) is optional and on-device: without it the exact-words rung works
and the others say they are unavailable. With **wikis** installed, it can search an assembled
corpus too.
