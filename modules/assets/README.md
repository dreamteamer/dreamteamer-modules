# assets — where each one came from, and under what licence

The `assets` collection holds opaque files (`codec: file`, engine 0.14.0): **the file IS the record**
and carries no frontmatter, so this file is the only place provenance is written. That is deliberate
— a licence belongs to a SET, not to a file, and copying it onto 300 records is 300 chances to be
wrong. The id carries the rest: `icons/lucide/hotel` says which set and which icon, which is enough
to fetch it again.

**Adding a set means adding its row here BEFORE its first file lands.**

| id prefix | set | licence | browse | fetch one |
|---|---|---|---|---|
| `icons/lucide/<name>` | Lucide | ISC | https://lucide.dev/icons/ | `curl -s https://api.iconify.design/lucide:<name>.svg` |
| `icons/tabler/<name>` | Tabler Icons | MIT | https://tabler.io/icons | `curl -s https://api.iconify.design/tabler:<name>.svg` |
| `logos/<slug>` | Simple Icons | CC0 1.0 | https://simpleicons.org/ | `curl -s https://cdn.simpleicons.org/<slug>` |
| `illustrations/undraw/<name>` | unDraw | unDraw licence — free, no attribution | https://undraw.co/illustrations | download from the site (no API) |
| `logos/<company-id>` | the company's OWN favicon | theirs — identification only | the company's site | see below |
| `avatars/<contact-id>` | the person's own LinkedIn photo | theirs — identification only | — | see below |
| `images/**` | — | ours | — | `dt add assets images/<path> --from <file>` |

⚠ **Two kinds of row live under `logos/`, and only one is reconstructible from its id.** A Simple
Icons mark is: `logos/atandt` → `https://cdn.simpleicons.org/atandt`. A favicon is not — its id is
the company record's id, and the source is that record's `domain`. Simple Icons carries almost none
of the companies a CRM holds (13 of 21 marks in the dogfood workspace came from the company's own site), so this is
the normal case rather than the exception. **Check the mime type before importing**: three of
seventeen fetches returned an HTML error page with HTTP 200, and one served a PNG named `.svg`.

```bash
# what actually worked, in order: the declared icon link, then the well-known paths
curl -sL https://harbor-mutual.example/ | grep -ioE '<link[^>]*rel="[^"]*icon[^"]*"[^>]*>'
curl -sL -o /tmp/x.png https://<the href>      # then: file -b --mime-type /tmp/x.png
npm run --silent dt -- add assets logos/harbor-mutual --from /tmp/x.png
```

## avatars — why they cannot be fetched, only harvested

⚠ **`media.licdn.com` images are public and need no auth; the PAGE that names their URL is not.**
An unauthenticated fetch of `linkedin.com/in/<slug>` returns HTTP 999, and
`linkedin-mcp-server` — the tool `scraping-contacts` drives — returns TEXT sections only: the
strings `photo`, `avatar`, `image` and `licdn` appear nowhere in that package. So there is no
scriptable path from a slug to a photo URL, and this vault does not build one (that would mean
working around the 999, which is a stated access control).

**What worked, 2026-08-29:** a browser session already logged into LinkedIn read
`linkedin.com/mynetwork/invite-connect/connections/` — one list page, ~1,268 rows, each carrying a
name, a slug and the avatar's `img src`. Matching those against `contacts` by slug (strong) or
exact name (weaker) produced 33 candidates and 31 photos. The prompt that drives such a session
lives with whoever runs it; the only things it must get right are **the complete URL including
everything after `?`** (the token is part of it) and **`media.licdn.com` vs `static.licdn.com`** —
the latter is the grey silhouette LinkedIn serves when someone has no photo.

⚠ **An exact-name match is a candidate, not a fact.** `sam-diaz` matched a connection whose slug
disagreed with the one already on the record: two different people share that name, and the photo
was NOT imported. Where a record already carries a `linkedin` URL, the slug in it wins.

## adding one

```bash
curl -s https://api.iconify.design/lucide:hotel.svg > /tmp/x.svg
npm run --silent dt -- add assets icons/lucide/hotel --from /tmp/x.svg
```

`--force` replaces an existing one. `dt set` refuses — a file record has nothing to set. Everything
else is an ordinary record: `rm` protects it while something references it, `history` and `diff`
work (a binary diff is git's `Binary files … differ`), and a dangling `x-reference: assets` is a
`check` violation like any other.

**Iconify aggregates ~200 sets behind one keyless API**, so any of them is one `curl` away —
`https://api.iconify.design/search?query=hotel` searches across all of them, and
`lucide:hotel` as the query narrows to one set. The table above is not a limit; it is the list of
sets this vault has actually taken files from, and the reason each is allowed to stay.

## two things to know before adding

⚠ **Simple Icons ships company marks, and CC0 covers the SVG — not the trademark.** Using a
company's mark to identify that company in this vault is fine. Nothing here licenses it for anything
else.

⚠ **Prefer SVG, and prefer `currentColor`.** Iconify's SVGs already use it, which is why one file
reads correctly in a light and a dark editor theme. A PNG is a fixed set of pixels in a fixed
colour, and it will look wrong in one of the two.

## what does NOT belong here

`check` refuses anything over **200 KB**, and that is the boundary rather than a nuisance: an icon is
1-3 KB, a logo under 10, a compressed illustration under 50. A meeting recording, a scan of a health
document, a photo library — those live under `${env:FILES_FOLDER}` with a record pointing at them,
which is what `meeting-recordings.file` and `family/health/documents` already do. Rule 5 in
`CLAUDE.md` still bans committed media; this collection is the one carve-out, and the size guard is
what keeps the carve-out honest.
