# @dreamteamer/artifacts

A built page someone OPENS — a pitch, a prototype, a report, a canvas — kept where it can actually be
opened. The record is a FOLDER: `index.md` carries the fields and the tour, and `index.html` beside it
opens straight from disk, with no server and no login. Publishing a copy is separate, and recorded on
`published_url`. Not `assets` (a picture a view draws): an artifact is a page a person opens, carrying
its own CSS and JS. `dt commit artifacts/<id>` stages `index.md` only; add `index.html` and its
siblings by path before the commit lands.

```bash
npm install @dreamteamer/artifacts
npx dreamteamer compile
```

| alone | with others |
|---|---|
| pages kept as folders, each with its tour | **companies** lets a page name the organisation it was built for |

Until core 0.12.0 this shipped inside `@dreamteamer/core`; records stay in `data/artifacts/` under the same ids.
