# @dreamteamer/companies

Organisations. One record per company, with a parent/subsidiary link and a logo. Everything else
that names a company points here: contacts, meetings, projects, users, notebooks.

```bash
npm install @dreamteamer/companies @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| companies and the links between them | **contacts** adds each company's people (`companies.contacts`) · **meetings**, **projects**, **users** and **notebooklm** point at it |

| needs | for |
|---|---|
| `@dreamteamer/assets` | logos |
