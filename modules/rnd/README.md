# rnd — what a descriptor cannot say

**The commercial funnel is not referenced, on purpose.** The workspace this was cut from points a
project at its `leads`/`clients` record through an `engagement` field and a feature at a `clients`
record through `for_client`. This package ships no funnel — every workspace has wanted it differently
(see `docs/2026-09-09-extensions-module-design.md`) — so `engagement` is gone and `for_client` points at
`companies`, the one organisation record every workspace has. A workspace with a funnel adds the field
back in an overlay.

**People inside a persona are plain strings, not references.** A panel's `members[].person`,
`quotes[].speaker` and `dissent[].person` carry a `<collection>/<id>` shape but are not validated: the
people a panel is built from routinely live in another workspace, and a reference that `check` would
refuse is worse than a string that stays greppable.

**No design skill ships here.** The source module carried a `designing-stuff` craft skill for the
`prototypes` it holds; Claude Code's own `/design` covers that ground now, and a second copy would only
drift. A prototype record is the brief and the pointer; how the mockup gets drawn is the harness's
business.

**Specs and plans are records.** A brainstormed design is a `product-design-docs` record; the plan that
implements it is a `draft-docs` record until it ships. The point is that the R&D paper trail is
searchable with the same verbs as everything else, rather than a `docs/` folder nothing indexes.

**A reference is evidence, not a design.** `rnd/references` holds what was studied — a competitor's
surface, a recording, a standard — and its `prd` is written as the PROMPT that would regenerate it, with
no opinion in it; judgement goes in the body. Our design is the `product-design-docs` record that cites
it in `references`, in our `branding`; the clickable thing is the `prototypes` record whose `design_doc`
points back. `plan` on the design doc is a plain `<collection>/<id>` string because the plan usually
lives in another workspace (a planning workspace under perspective). The chain is bound, so `dt next` on
a design doc names the missing hop — `building-from-references` is the procedure. ffmpeg is the one
binary this module ever shells out to (`extract-frames.mjs`), and the doctor's `rnd` capability says
whether it is there.
