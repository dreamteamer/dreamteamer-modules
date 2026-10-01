# @dreamteamer/assets

Small pictures a workspace draws: icons, logos, avatars, illustrations. Each one is a file record of
200 KB at most, and other modules point at it by id (a company's `logo`, a person's `avatar`).

```bash
npm install @dreamteamer/assets
npx dreamteamer compile
```

## ids and licences

The `assets` collection holds opaque files (`codec: file`): the file is the record and carries no
frontmatter. A record that draws a picture keys it by its own id; a picture from a third-party set
keys it by set and name, which is enough to fetch it again. A licence belongs to a set, so it is
listed once here rather than on every file.

| id prefix | what | licence | fetch one |
|---|---|---|---|
| `avatars/<person-id>` | the person's own photo | theirs, identification only | by hand |
| `logos/<company-id>` | the company's own favicon or mark | theirs, identification only | from the company's site |
| `logos/<slug>` | Simple Icons | CC0 1.0 | `curl -s https://cdn.simpleicons.org/<slug>` |
| `icons/lucide/<name>` | Lucide | ISC | `curl -s https://api.iconify.design/lucide:<name>.svg` |
| `icons/tabler/<name>` | Tabler Icons | MIT | `curl -s https://api.iconify.design/tabler:<name>.svg` |
| `illustrations/undraw/<name>` | unDraw | unDraw licence, no attribution | download from undraw.co |
| `images/<path>` | your own pictures | yours | — |

Iconify serves about 200 sets behind one keyless API (`https://api.iconify.design/search?query=hotel`).
The id pattern accepts any set name, so a set missing from this table is allowed but undocumented. CC0 on a Simple Icons SVG covers the file, not the
trademark: a company's mark identifies that company and nothing more.

## adding one

```bash
curl -s https://api.iconify.design/lucide:hotel.svg > /tmp/x.svg
file -b --mime-type /tmp/x.svg       # a site can answer 200 with an HTML error page
npx dt add assets icons/lucide/hotel --from /tmp/x.svg
```

`--force` replaces an existing file; `dt set` refuses, because a file record has no fields to set.
Otherwise it is an ordinary record: `rm` refuses while something references it, `history` and `diff`
work, and a dangling `x-reference: assets` is a `check` violation. Prefer SVG with `currentColor`, so
one file reads correctly in a light and a dark theme.

## limits

`check` refuses a file over 200 KB, and the extensions are svg, png, jpg, jpeg, webp and gif. An icon
is 1-3 KB and a logo under 10. Recordings, scans and photo libraries stay outside the repo, with a
record pointing at them.
