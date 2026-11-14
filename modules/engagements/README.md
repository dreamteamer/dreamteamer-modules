# @dreamteamer/engagements

One record per working relationship with a company: a lead while you are selling, a client while you
are delivering, closed when it is over. The record carries who matters on the other side, where it
stands today, what is owed, and the whole arc so far.

```bash
npm install @dreamteamer/engagements @dreamteamer/companies @dreamteamer/assets
npx dreamteamer compile
npx dreamteamer add engagements --name "Northwind rollout" --company companies/northwind
```

| alone | with others |
|---|---|
| engagements, the pipeline board (`/engagements/pipeline`), and `companies.engagements` on every company | **contacts** fills `champion`, `key_contacts` and `introduced_by` · **meeting-docs** points each critique and prep at its engagement, and `/update-engagements` reads its summaries |

| needs | for |
|---|---|
| `@dreamteamer/companies` | the company an engagement is with |
| `@dreamteamer/assets` | companies needs it for logos |

A closed engagement says how it ended in `outcome`: `delivered`, `lost` or `dropped`. The store
refuses an `outcome` on an open engagement and a `closed` one without it.

The module needs no setup. `/update-engagements` is its one command: it brings each engagement level
with the meeting summaries written since it was last updated (with **meeting-docs** installed).

## 0.1.3 — the nav is nav.yaml (cr-dt-008)

`display.nav.order` and `display.nav.section` removed from its descriptor — the nav is `nav.yaml` at the workspace root (engine 0.49), which you arrange; `display.nav.icon` stays. Nothing to do.

## 0.1.2

Engine floor `>=0.47.0` and the peer list mirrored for `dt install`'s closure; nothing else changes. `dt update @dreamteamer/engagements` then `dt compile`.
