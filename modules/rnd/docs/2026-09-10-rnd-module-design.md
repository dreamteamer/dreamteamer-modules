# rnd — the eighth module: what a workspace builds and investigates

**Status:** designed and built 2026-09-10 in one unattended pass, on the operator's "implement all".
Records the decisions that are not visible in the tree, and the one interpretation the operator has
not yet confirmed.

## the ask

> create an rnd module based on the dogfood vault / superpowers setup — no PII leak!

and, mid-turn: *"can skip designing stuff we have /design now"*.

## what was read

The source module in the dogfood vault: 14 collections under the `rnd` namespace, one module-scoped
provenance template, one default view (`content-open-questions`), one skill (`designing-stuff`), a
README. 1,292 lines. No Hebrew, no machine path, no address; one client slug in an `examples:` list.

## the interpretation, and the fork it hides

"Superpowers setup" is not a term the vault records anywhere (searched `data/**`, `DECISION-LOG.md`).
Two readings were possible:

1. **the same shape as the vault's `rnd`** — port the collections, scrubbed; or
2. **a home for the superpowers workflow's artefacts** — the brainstormed spec and the implementation
   plan that today land in `docs/superpowers/{specs,plans}/` as files nothing indexes.

Both were served without inventing a collection: the port IS reading 1, and reading 2 needs no new
noun — a spec is what `product-design-docs` already holds ("how a thing should work, decided") and a
plan is a `draft-docs` record until it ships. The `use_when` of both, the module description and the
README say so. If the operator meant a third thing, the cost of this guess is one `use_when` sentence
in two descriptors. Recorded in the vault's `agent-decision-log`.

## the port, hunk by hunk

Every descriptor is the vault's, transformed by a script that names each needle and FAILS when one is
not found (`scrub-rnd.mjs`, run once; not shipped). The transformations:

| where | vault | here | why |
|---|---|---|---|
| `features.for_client` | `x-reference: clients` | `x-reference: companies` | no funnel here; `companies` is the organisation every workspace has |
| `projects.engagement` | `x-reference: [leads, clients]` | field removed | the funnel stays out of the package (2026-09-09 design) |
| `projects` description | names `briefs` and the funnel | names `company` | neither exists here |
| `open-questions.blocks`, `.from_question`, `personas.members[].person`, `.quotes[].speaker`, `.quotes[].source`, `.dissent[].person` | plain strings citing a sibling repo and a decision number | plain strings, reason generalised | the reason (targets live elsewhere) is generic; the history is not |
| `personas.known_biases`, `.learning` | "every persona in this vault…", "this vault's whole corpus…" | conditional phrasing | a claim about one corpus, not a rule |
| `draft-docs` absorbed-collection comment | 9 records, 23 drafts, a date | the rule alone | vault history |
| `required: []` on `products`, `projects`, `draft-docs`, `product-design-docs` | empty, "records predate the schema" | `[name]` | no legacy records here; a nameless record is a mistake |
| `group: rnd` | present on 12 descriptors | removed | the engine is retiring `group:` in favour of module ownership; the package sets none |
| `tags` descriptions | `python3 modules/gk/skills/working-with-tags/bin/tags.py` | `` `dt values <collection> tags` `` | a vault script vs the engine verb |
| `examples:` | a real client's slug | `'harbor-mutual'` | the synthetic cast |
| `he` / `His` / `himself` | the operator | they / their / themselves | the package assumes nothing about the operator |
| `prototypes` header | "authored with the `designing-stuff` skill" | dropped | the skill is not ported |
| `designing-stuff` skill | shipped | not ported | `/design` exists (operator, 2026-09-10) |

Everything else — field names, enums, defaults, the `x-inverse` from `research-docs.project` onto
`projects.research`, the `products ↔ projects` mirror, the `*` polymorphic references on
`persona-probes` and `prototypes.explores`, `order`, `icon`, `list_fields` — is verbatim.

## boundaries

`rnd` peers `companies`; it depends on nothing. `repos` is core. Every `templates:` resolves to
`collection-templates/rnd-provenance` inside the module. The structure gate and the compiles-alone
gate are what prove those three sentences.

`media_folder` (and `references.reference_file`) is a `${env:FILES_FOLDER}` template, so `FILES_FOLDER` is now wanted when `rnd`
is installed, the same way `meetings` and `recordings` want it — the doctor and `setup` both know.

## what is not here, and why

- **the `designing-stuff` skill** — see above.
- **a doctor capability** — nothing in this module shells out, reads a credential or needs a mount.
  The one variable it uses rides on the existing `variables` capability.
- **views beyond `content-open-questions`** — the vault ships one; the port ships the same one.
