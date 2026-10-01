# @dreamteamer/contacts

The people you deal with, each pointing at the company they work for. A command fills a person in
from their LinkedIn profile. Views list everyone, and who still needs a LinkedIn link.

```bash
npm install @dreamteamer/contacts @dreamteamer/companies @dreamteamer/tags @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| contacts, and each company's people stamped onto `companies.contacts` | **meetings** fills in each contact's most recent meeting (`/update-contacts-from-meetings`) · **users** lets a person in your workspace point at their contact record |

| needs | for |
|---|---|
| `@dreamteamer/companies` | where a contact works |
| `@dreamteamer/tags` | the `tags` field points at its script |
| `@dreamteamer/assets` | avatars |
| Docker and one LinkedIn sign-in | `/scrape-contact` only; everything else works without them |
