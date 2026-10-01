# @dreamteamer/engagements

One record per working relationship with a company: a lead while you are selling, a client while you
are delivering, closed when it is over. The record carries who matters on the other side, where it
stands today, what is owed, and the whole arc so far.

```bash
npm install @dreamteamer/engagements @dreamteamer/companies @dreamteamer/assets
npx dreamteamer compile
npx dt add engagements --name "Northwind rollout" --company companies/northwind
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
