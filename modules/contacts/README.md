# @dreamteamer/contacts

The people you deal with, each pointing at the company they work for. A command fills a person in
from their LinkedIn profile. Views list everyone, and who still needs a LinkedIn link.

```bash
npm install @dreamteamer/contacts @dreamteamer/companies @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| contacts, and each company's people stamped onto `companies.contacts` | **meetings** fills in each contact's most recent meeting (`/update-contacts-from-meetings`) · **users** lets a person in your workspace point at their contact record |

| needs | for |
|---|---|
| `@dreamteamer/companies` | where a contact works |
| `@dreamteamer/assets` | avatars |
| Docker and one LinkedIn sign-in | `/scrape-contact` only; everything else works without them |

The module has no setup unit. `/scrape-contact` is its one command, and the `scraping-contacts` skill
carries the procedure, including the one-time LinkedIn sign-in and the optional `LINKEDIN_USER_AGENT`
in `.env`. The two views are `/contacts/needs-linkedin` and `/contacts/review-linkedin`.

## 0.1.3 — the nav is nav.yaml (cr-dt-008)

`display.nav.order` and `display.nav.section` removed from its descriptor — the nav is `nav.yaml` at the workspace root (engine 0.49), which you arrange; `display.nav.icon` stays. Nothing to do.

## 0.1.2

Engine floor `>=0.47.0` and the peer list mirrored for `dt install`'s closure; nothing else changes. `dt update @dreamteamer/contacts` then `dt compile`.
