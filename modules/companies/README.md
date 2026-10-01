# @dreamteamer/companies

Organisations. One record per company, with a parent/subsidiary link and a logo. Every module that
names a company points here: contacts, meetings, meeting docs, projects, users, products and
notebooks.

```bash
npm install @dreamteamer/companies @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| companies and the links between them | **contacts** adds each company's people (`companies.contacts`) · **meetings**, **meeting-docs**, **projects**, **users**, **rnd**, **perspective** and **notebooklm** point at it |

| needs | for |
|---|---|
| `@dreamteamer/assets` | logos |

## logos

`logo` names an `assets` record. Most companies are not in Simple Icons, so the usual source is the
company's own site icon, stored as `assets/logos/<company id>` and found from `domain`:

```bash
curl -sL https://harbor-mutual.example/ | grep -ioE '<link[^>]*rel="[^"]*icon[^"]*"[^>]*>'
curl -sL -o /tmp/x.png https://<the href>      # check: file -b --mime-type /tmp/x.png
npx dt add assets logos/harbor-mutual --from /tmp/x.png
npx dt set companies/harbor-mutual --logo assets/logos/harbor-mutual
```

A brand that Simple Icons carries uses its slug instead: `assets/logos/<simple-icons-slug>`.
