---
name: software factory
description: From the client's calls to a deployed change — the calls transcribed, summarised and critiqued, engagements level, references written up, the asks filed as change requests, and each change designed, reviewed, planned, built, proved and deployed.
status: active
tags:
  - delivery
steps:
  - name: sync the calendar
    command: commands/fetch-meetings
    collection: collections/meetings
  - name: recordings in
    command: commands/fetch-new-recordings
    collection: collections/meeting-recordings
  - name: match recordings to meetings
    command: commands/match-recording-to-meeting
    collection: collections/meeting-recordings
    where: '{"meeting":{"_empty":true}}'
    stop: when two meetings fit one recording, which one it records
  - name: transcribe
    command: commands/transcribe-recording
    collection: collections/meeting-recordings
    where: '{"date":{"_gte":"$from"},"transcription":{"_empty":true}}'
  - name: summarize the client calls
    command: commands/summarize-meeting
    collection: collections/meetings
    where: '{"starts":{"_gte":"$from","_lte":"$now"},"company":{"_nempty":true},"summary":{"_empty":true}}'
  - name: extract my commitments
    command: commands/extract-tasks-from-meetings
    collection: collections/meetings
    where: '{"starts":{"_gte":"$from","_lte":"$now"},"company":{"_nempty":true},"summary":{"_nempty":true}}'
  - name: critique the client calls
    command: commands/analyze-meetings
    collection: collections/meetings
    where: '{"starts":{"_gte":"$from","_lte":"$now"},"company":{"_nempty":true},"analyses":{"_empty":true}}'
    stop: which of these calls asked for something worth building or deciding — one critique per client arc
  - name: bring engagements level
    command: commands/update-engagements
    collection: collections/engagements
  - name: references in
    command: commands/rnd/ingest-reference
    collection: collections/rnd/references
    stop: which capture the client showed or sent — a recording, a PDF, a URL — to record as a reference
  - name: write the references' PRDs
    command: commands/rnd/reference-prd
    collection: collections/rnd/references
    where: '{"prd":{"_empty":true}}'
  - name: file the changes the calls asked for
    command: commands/rnd/change-request
    collection: collections/rnd/products
    where: '{"status":{"_in":["building","live"]}}'
    stop: which asks in the new summaries and critiques become changes, and against which product — one change request each, citing the summary
  - name: design the changes
    command: commands/rnd/design
    collection: collections/rnd/change-requests
    where: '{"status":{"_in":["suggested","accepted"]},"design_docs":{"_empty":true}}'
    stop: the design is brainstormed with you — which of these to design now
  - name: review the designs
    command: commands/rnd/review
    collection: collections/rnd/design-docs
    where: '{"status":{"_eq":"draft"}}'
  - name: prototype the designs that ask for one
    command: commands/rnd/prototype
    collection: collections/rnd/design-docs
    where: '{"status":{"_eq":"active"},"prototypes":{"_empty":true}}'
    stop: which of these designs needs a clickable prototype before it is planned
  - name: review the change requests
    command: commands/rnd/review
    collection: collections/rnd/change-requests
    where: '{"status":{"_eq":"suggested"}}'
  - name: plan the accepted changes
    command: commands/rnd/plan
    collection: collections/rnd/change-requests
    where: '{"status":{"_eq":"accepted"},"implementation_plans":{"_empty":true}}'
  - name: review the plans
    command: commands/rnd/review
    collection: collections/rnd/implementation-plans
    where: '{"status":{"_eq":"draft"}}'
  - name: build the approved plans
    command: commands/rnd/implement
    collection: collections/rnd/implementation-plans
    where: '{"status":{"_in":["approved","in-progress"]}}'
    stop: go on each approved plan, or a change to its execution
  - name: prove the built changes
    command: commands/rnd/test
    collection: collections/rnd/change-requests
    where: '{"status":{"_eq":"accepted"},"verified_on":{"_empty":true}}'
  - name: deploy the proven changes
    command: commands/rnd/deploy
    collection: collections/rnd/change-requests
    where: '{"status":{"_eq":"accepted"},"deployed_on":{"_empty":true}}'
    stop: merging and deploying are yours — which of these go live now
---
## 1. sync the calendar

The calendar is the spine every later step hangs off. Sync the whole range even when the workspace looks current.

## 2. recordings in

New audio in the inbox becomes `meeting-recordings` records, deduplicated by content.

## 3. match recordings to meetings

Every recording with no `meeting`. When two meetings fit, the person says which.

## 4. transcribe

Recordings from the range with a file and no `transcription`. The summaries wait for it.

## 5. summarize the client calls

Client meetings in the range with no summary yet; the binding adds that the meeting is not `restricted` and has a transcribed recording.

## 6. extract my commitments

Summarised client meetings in the range. The command checks the tasks already tracked before it writes one, so a second run adds nothing it already added.

## 7. critique the client calls

Client meetings in the range with no critique. The critique is built on the raw transcript, and it is where a client's ask is quoted, dated and attributed — the evidence a change request cites. The person picks the calls that asked for something.

## 8. bring engagements level

Every open engagement takes in the new summaries — what is owed, by whom, by when. A change the client asked for is owed here before it is filed below.

## 9. references in

Only when the client showed or sent something to build like — a screen recording, a PDF, a product. The person hands it in; the command records it and extracts its frames.

## 10. write the references' PRDs

Every reference with no `prd`: the spec written as the prompt that would regenerate it, with no opinion in it.

## 11. file the changes the calls asked for

Products being built or live. The person names, from the summaries and critiques just written, each ask that becomes a change and the product it changes; each one is one `/rnd:change-request <rnd/products/id> "<what changes>"`, its `source` citing the summary or critique. This is the step where the meetings become R&D work.

## 12. design the changes

Open change requests with no design. The design is brainstormed with the person, so they pick which to design now. Steps 12 to 20 follow the R&D lifecycle's own order: design and its review before the change is accepted, then plan.

## 13. review the designs

Every draft design; the reviewer's `approve` makes it active.

## 14. prototype the designs that ask for one

Active designs with no prototype. Only the designs that ask for a clickable prototype get one — the person says which.

## 15. review the change requests

Every suggested change: its acceptance lines reviewed; `approve` makes it accepted.

## 16. plan the accepted changes

Accepted changes with no plan. The binding adds that the change's design, when it has one, is active.

## 17. review the plans

Every draft plan; the review writes the held-out tests and its `approve` sets it approved.

## 18. build the approved plans

Approved or in-progress plans. The person says go on each, or changes its execution, before anything is built.

## 19. prove the built changes

Accepted changes not yet verified; the binding adds that the change's plan is done. Every covering test is run and set from its output.

## 20. deploy the proven changes

Accepted changes not yet deployed; the binding adds that they are verified. Merging and deploying are the person's: nothing goes live without their word.
