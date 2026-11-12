---
name: working-with-knowledge
description: Capture a raw thought for later digestion, prepare a general reader-facing brief, or synthesize patterns across a period of mixed workspace records. Uses blurbs, briefs and meta-analyses. For preparation or transcript-grounded critique of specific meetings, use the meeting skills instead.
---

# Working with knowledge

Load `using-dreamteamer` and the target collection's compiled descriptor first. Use the workspace
CLI to read/write records. Update an existing record when the request continues it; a new title
is not by itself evidence of a new document. These collections do not grant sharing permission.

## Capture and digest a thought

Use `blurbs` when an idea is worth keeping but has no established destination yet. Store the
user-provided wording in `raw_input` without editing it, with interpretation in `content`.
For an older record with no raw_input, do not manufacture a verbatim original from its content.

A request to capture a thought is not a request to implement it or generate tasks. Leave it
`draft`. When asked to digest it, identify the intended outcome (document, task, design or
retained insight), preserve the original, create or update that outcome within the authorized
scope, and link it in the blurb body. Set `digested` only after that outcome exists or the owner
explicitly chooses no further action. Re-running digestion should follow that link rather than
create duplicates. Do not automatically create tasks from possibilities mentioned in a thought.

## Prepare a document for a reader

Use `briefs` for a report, deck outline, thesis or reference someone will act on. Use
`meeting-preps` for one upcoming meeting and an R&D collection for its formal lifecycle.
Capture `audience` and `purpose` from the request; resolve an important ambiguity before writing.
Read the relevant sources, retain their references in `sources`, and separate sourced facts from
interpretation and open questions. The content can be in the requested language.

`final` means the document is finished for its intended use, not that it has been sent or approved
for publication. Writing a brief does not authorize contacting its audience or publishing it.

## Synthesize patterns across a period

Use `meta-analyses` when the question is what recurs across sources, not just how one call went.
Sources may include briefs, thought captures, meeting analyses, project documents and authorized
session or message records. Reuse `meeting-analyses` for a transcript-grounded critique of an arc
of calls; don't duplicate it merely because several meetings are involved.

1. Inspect the previous relevant synthesis and its scope. For “since last time,” use its coverage
   end, not its file timestamp. State any overlap or gap; ask when ambiguity changes the scope.
2. Inventory permitted sources in the agreed period. Exclude restricted/private material outside
   the authorized scope; do not treat repository accessibility as permission to redistribute it.
3. Read selected evidence, including contradictory examples. For meeting claims, inspect the raw
   transcript and speaker/ASR caveats as needed; summaries are not verbatim evidence.
4. Write patterns supported by traceable source links, distinguish fact, inference and advice,
   and state counterexamples, missing sources and attribution limits.
5. Record actual coverage in `sources_description`, `sources_count` and the period fields.
   Count records read, not search hits. Leave token count absent unless measured or explicitly
   estimated with the method stated. `prompt` should reproduce scope and method, not contain
   secrets or imply authorization to read a source that is no longer permitted.

Recommendations remain in the analysis. Creating tasks, changing project records or transferring
material to other repositories is a separate deliberate step under the owner's instructions.
