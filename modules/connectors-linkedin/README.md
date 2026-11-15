# @dreamteamer/connectors-linkedin

Fills your `contacts` in from LinkedIn and the web. A command enriches a person from their LinkedIn
profile; two views list who still needs a LinkedIn link and who needs your review. Not part of
`@dreamteamer/core`: install it when you want a workspace to reach LinkedIn.

```bash
dt install @dreamteamer/connectors-linkedin
```

or, with npm:

```bash
npm install @dreamteamer/connectors-linkedin @dreamteamer/contacts @dreamteamer/companies @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| `/scrape-contact` on any `draft` contact, the `scraping-contacts` skill, the views `/contacts/needs-linkedin` and `/contacts/review-linkedin` | **meetings** — a meeting's attendees become the `draft` contacts `/scrape-contact` queues (the calendar sync in `@dreamteamer/connectors-google-workspace` writes them) |

| needs | for |
|---|---|
| `@dreamteamer/contacts` 0.2.0 or later | the records it fills in |
| `@dreamteamer/companies` | where a contact works |
| `@dreamteamer/assets` | avatars |
| Docker and one LinkedIn sign-in | `/scrape-contact`; the views work without them |

The module has no setup unit. `/scrape-contact` is its one command, and the `scraping-contacts` skill
carries the procedure, including the one-time LinkedIn sign-in and the optional `LINKEDIN_USER_AGENT`
in `.env`. Every call is a request from your own LinkedIn account: the skill scrapes in small batches
and stops at the first captcha.

## 0.1.0 — moved out of contacts (cr-modules-018)

The scraper, `/scrape-contact`, its binding and the two LinkedIn views, as `@dreamteamer/contacts` 0.1.3
shipped them, moved here unchanged so a workspace on `@dreamteamer/core` reaches no LinkedIn. It needs
contacts 0.2.0 or later (the older contacts ships the same skill and command, and is refused). On a
workspace that had them through contacts: `dt update @dreamteamer/core` (or `@dreamteamer/contacts`)
first, then `dt install @dreamteamer/connectors-linkedin`. `LINKEDIN_USER_AGENT` in `.env` is read
again as it was; no record changes.
