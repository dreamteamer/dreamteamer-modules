---
name: working-with-tags
description: Use when writing or reading a `tags` field on any record — what the key:value convention is, why the colon carries no space, and how to find the tags already in use before inventing one.
---

# working with tags

**A tag is a string. Nothing validates it.** There is no `tags` collection, no vocabulary record, no
`x-reference`. `npm run check` will not catch a typo in a tag, and that is deliberate — the collection
that used to catch them was deleted on 2026-08-17, after 25 of its 68 records turned out never to have
been applied to anything.

## the form

```yaml
tags:
  - analysis:meeting-insights   # keyed
  - enriched:web-search         # keyed
  - transcribed                 # bare
  - local-first                 # bare
```

- **lowercase, hyphenated.** `local-first`, not `Local First`.
- **`key:value` is optional.** Use a key when the value means nothing alone (`status:pending`,
  `area:finance`); leave it bare when the value stands by itself (`local-first`, `mcp`).
- ⚠ **NO SPACE around the colon, and no quotes.** This is the one hard rule, and it is mechanical
  rather than stylistic:

  ```yaml
  - status:pending     # → 'status:pending'        a string ✓
  - status: pending    # → {'status': 'pending'}   a YAML map ✗
  ```

  The spaced form only ever worked here because someone quoted it — 117 values across 116 records were
  carrying quotes for exactly that reason. The unspaced form needs no quotes and cannot become a map.

## before you invent a tag

```bash
python3 <extensions>/modules/contacts/skills/working-with-tags/bin/tags.py
```

Every tag in use with its count, most-used first. **Reuse before you coin.** Nothing stops you minting
a new one — there is no gate — which is exactly why the check is yours to make. A tag used once is a
tag nobody will ever search for.

Currently 87 distinct tags over 408 applications.

## keys in use

| key | means | where |
|---|---|---|
| `analysis:` | this record has been through a review pass | meetings |
| `enriched:` | where this record's data came from, and how much to trust it | contacts |

Add a key when a second one earns its place, not in advance.

## what this is not

- **Not a status field.** If exactly one value may be true at a time and a list view needs to column
  it, that is a `status` property with an enum, not a tag.
- **Not provenance.** `crm-provenance` and `rnd-provenance` are collection-templates and already do
  that job properly.
- **Not a category system.** A tag that starts wanting attributes — a description, a colour, a
  parent — is a collection in disguise. That is precisely the mistake this replaced: the deleted
  `tags` collection had `description`, `kind`, `parent` and `status`, and its id pattern
  `^[a-z0-9-]+$` forbade a colon — so the collections actually *using* the `key:value` convention
  were the ones locked out of the vocabulary meant to govern them.
