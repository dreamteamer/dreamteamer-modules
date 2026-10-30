---
name: customer factory
description: From the week's calls to its leads — calls transcribed and summarised, new people enriched, selling calls critiqued, engagements brought level, companies met with no engagement offered as leads, and the coming client calls prepped.
status: active
tags:
  - sales
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
  - name: stamp contacts with their latest meeting
    command: commands/update-contacts-from-meetings
    collection: collections/meetings
    where: '{"starts":{"_gte":"$from","_lte":"$now"}}'
  - name: enrich the new people
    command: commands/scrape-contact
    collection: collections/contacts
    where: '{"status":{"_eq":"draft"},"recent_meeting_date":{"_gte":"$from"}}'
    stop: which of these people to enrich — the scrape runs on your own LinkedIn session
  - name: critique the selling calls
    command: commands/analyze-meetings
    collection: collections/meetings
    where: '{"starts":{"_gte":"$from","_lte":"$now"},"company":{"_nempty":true},"analyses":{"_empty":true}}'
    stop: which of these were calls where you were selling, advising or negotiating — one critique per client arc
  - name: bring engagements level
    command: commands/update-engagements
    collection: collections/engagements
    stop: read the conflicts the critiques flagged before the next steps are written
  - name: suggested engagements
    collection: collections/meetings
    where: '{"starts":{"_gte":"$from","_lte":"$now"},"company":{"engagements":{"_empty":true}}}'
    stop: for each company here, a new lead or nothing
  - name: prep the coming client calls
    command: commands/prepare-for-meeting
    collection: collections/meetings
    where: '{"starts":{"_gte":"$now","_lte":"$to"},"company":{"_nempty":true},"prep":{"_empty":true}}'
---
## 1. sync the calendar

The calendar is the spine: nothing downstream can match a recording or name a company without the meeting record. Sync the whole range even when the workspace looks current — a meeting moved or added after the last sync is invisible until it is fetched again.

## 2. recordings in

New audio in the inbox becomes `meeting-recordings` records, deduplicated by content.

## 3. match recordings to meetings

Every recording with no `meeting`. The command walks its own ladder; when two meetings fit, the person says which.

## 4. transcribe

Recordings from the range with a file and no `transcription`. This is the long step; the summaries wait for it.

## 5. summarize the client calls

Meetings in the range that have a company and no summary yet. The binding adds the rest: the meeting is not `restricted`, and one of its recordings is transcribed. A summary is what the engagement update reads.

## 6. stamp contacts with their latest meeting

Every meeting in the range with attendees as contacts. Idempotent and forward-only, so the whole range is safe to run again.

## 7. enrich the new people

Placeholder contacts somebody met in the range. They are the leads' faces; the scrape runs on the person's own LinkedIn session, so the person picks who.

## 8. critique the selling calls

Client meetings in the range with no critique yet. Only the calls where something was at stake — selling, advising, negotiating — are worth one; an internal or status call is not. The person picks, and one critique covers an arc of calls with the same client.

## 9. bring engagements level

Every engagement that is not closed takes in the new summaries: recent activity, next steps, stage, champion. Run it after the critiques: a critique often finds that the obvious next step is the wrong one, and next steps are written here.

## 10. suggested engagements

Meetings in the range whose company has no engagement record at all — a company you met and are not yet tracking. Each one is a suggested engagement. The person decides, per company: a new lead —

```bash
dt add engagements --name "<company>" --company companies/<id> --stage lead --first_contact <the meeting's date>
```

— or nothing. Nothing is created without that answer.

## 11. prep the coming client calls

Client meetings from now to the end of the range with no prep. A prep for a lead is where the engagement just written, the critique and the enriched contacts come together.
