# Updating @dreamteamer/rnd

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module; most of the time it is `dt compile`, then `dt check`.

```bash
npm install @dreamteamer/rnd@latest
npx dreamteamer compile
npx dreamteamer check
```

---

## 0.5.1 — change requests read as a list: a short descriptive name, a one-line description, the rest in the body

Nothing breaks: no field was added, removed or renamed, and every record compiles as it is. What
changed is what the descriptor **says** about three fields, and how the collection lists.

**The three sizes.** A change request is read in a list before it is read in full, so its fields
have one size each, never mixed:

| field | size | example |
|---|---|---|
| `name` | a handful of words — what changes, the way a row reads it | `Activity page loads instantly` |
| `description` | one line — what changes, for whom | `The Activity page shows its first 20 entries as each repo answers instead of waiting for every history.` |
| body (`content`) | everything longer: the paragraph, the ask in the source's own words, what is out of scope, what it touches by id, the phases | — |

**The list** shows `created` · `status` · `name` · `products`, newest first (`sort: -created`),
instead of `name` · `description`. A name written as a sentence now overflows its column, which is
the point: the row is where you see that the name is too long.

**`acceptance` on the CLI.** It is a list. Pass one `--acceptance` per entry:

```bash
dt add rnd/change-requests --key activity-first-page --name "Activity page loads instantly" \
  --products rnd/products/editor --description "The Activity page shows its first 20 entries as each repo answers." \
  --acceptance "the first page asks for 20, bounded per repo" \
  --acceptance "the first repo to answer is on screen before the slowest has returned"
```

One flag holding several lines is split on its **commas** — `--acceptance "a, b and c"` becomes
three entries, cut mid-sentence. If a record of yours shows an acceptance list of sentence fragments,
that is what happened; rewrite the list, one entry per piece of evidence.

**Bringing an existing record to shape.** For each change request whose name is a sentence or whose
description is a paragraph:

1. Move the long text into the body under a heading (`## Why`, `## The ask`, `## Out of scope`,
   `## Phases` — whatever it is), keeping the source's own words.
2. Set `description` to one line and `name` to a few words:
   ```bash
   dt set rnd/change-requests/<id> name="<a few words>" description="<one line>"
   ```
3. Re-enter `acceptance` with one `acceptance=` per entry — repeated keys, the way `--acceptance`
   repeats on `add`; a single value is split on its commas, a repeated key keeps them:
   ```bash
   dt set rnd/change-requests/<id> acceptance="the first page asks for 20, bounded per repo" \
     acceptance="the first repo to answer is on screen before the slowest has returned"
   ```
4. `dt check`, then `dt commit rnd/change-requests/<id>`.

The `rnd-change-request` skill writes new records in this shape from now on.

## 0.5.0 and earlier

See the README's release notes (`## 0.5.0 — from 0.4.0`, `## 0.4.0 — from 0.3.0`).
