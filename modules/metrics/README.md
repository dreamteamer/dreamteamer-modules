# @dreamteamer/metrics

One named measure a workspace watches — agent hours per project, open tasks per person, sessions per
week, a utilisation percentage — with its unit, what it is scoped to, its target, and the dated
readings that make its series. The definition and the numbers in one record, so "how is X trending"
is one file: a reading is a dated row, and the latest is copied into `current` and `as_of` so a list
sorts without opening the body.

```bash
npm install @dreamteamer/metrics @dreamteamer/users
npx dreamteamer compile
```

| alone | with others |
|---|---|
| measures scoped to a person, an agent or the whole workspace, with their series | **projects** lets a measure be scoped to a project |

Until core 0.12.0 this shipped inside `@dreamteamer/core`; records stay in `data/metrics/` under the same ids.
