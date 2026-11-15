# @dreamteamer/contacts

The people you deal with, each pointing at the company they work for. Contacts are records you write
by hand, from a meeting's attendees, or with an enrichment package; this module reaches nothing
outside the workspace.

```bash
npm install @dreamteamer/contacts @dreamteamer/companies @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| contacts, and each company's people stamped onto `companies.contacts` | **meetings** fills in each contact's most recent meeting (`/update-contacts-from-meetings`) · **users** lets a person in your workspace point at their contact record · **connectors-linkedin** fills a person in from LinkedIn |

| needs | for |
|---|---|
| `@dreamteamer/companies` | where a contact works |
| `@dreamteamer/assets` | avatars |

The module has no setup unit, no command and no `.env` key. A contact's `linkedin`, `linkedin_degree`
and `linkedin_mutuals` fields stay here, because they describe the person; filling them in from
LinkedIn is `@dreamteamer/connectors-linkedin`'s job.

## 0.2.0 — LinkedIn leaves contacts (cr-modules-018)

The LinkedIn scraper left this package for `@dreamteamer/connectors-linkedin`: its command
`/scrape-contact`, its `scraping-contacts` skill, the binding that queues `draft` contacts, the two views
`/contacts/needs-linkedin` and `/contacts/review-linkedin`, and the `LINKEDIN_USER_AGENT` key. Every
field stays, so every record written before still checks; nothing to migrate. To keep `/scrape-contact`
and the two views, `dt install @dreamteamer/connectors-linkedin`. Without it, `LINKEDIN_USER_AGENT`
stays in `.env` unread.

## 0.1.3 — the nav is nav.yaml (cr-dt-008)

`display.nav.order` and `display.nav.section` removed from its descriptor — the nav is `nav.yaml` at the workspace root (engine 0.49), which you arrange; `display.nav.icon` stays. Nothing to do.

## 0.1.2

Engine floor `>=0.47.0` and the peer list mirrored for `dt install`'s closure; nothing else changes. `dt update @dreamteamer/contacts` then `dt compile`.
