# @dreamteamer/meetings

Your calendar meetings, synced from Google Calendar, with the attendees as contacts and the
screenshots taken during a call filed beside it. The anchor the other meeting modules hang off.

```bash
npm install @dreamteamer/meetings @dreamteamer/contacts @dreamteamer/companies @dreamteamer/users @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| meetings synced or written by hand, each attendee's latest meeting stamped on their contact, screenshots filed per meeting | **recordings** adds the audio and transcript (`meetings.recordings`) · **meeting-docs** adds the prep, the summary and the critique (`meetings.prep`, `.summary`, `.analyses`) and the pipeline that writes them |

| needs | for |
|---|---|
| `@dreamteamer/contacts` | attendees |
| `@dreamteamer/companies` | the company a call is with |
| `@dreamteamer/users` | the people of yours in the room |
| `@dreamteamer/assets` | contacts and companies need it for avatars and logos |
| a Google OAuth desktop client, each account authenticated through `workspace-mcp`, and `WORK_CALENDARS` in `.env` | calendar sync only (`fetching-meetings` has the setup); writing meetings by hand works without them |
| `INBOX_FOLDERS` and `FILES_FOLDER` declared | filing screenshots only |

A meeting's `privacy` is `open` or `restricted`. A `restricted` meeting holds a third party's private
material, so the meeting-docs pipeline stops after transcription. An export cannot withhold that one
record: `sensitive` applies to a whole collection or a whole field, never to a record, so an exporter
has to read `privacy` itself, and marking `meetings` sensitive would withhold every meeting.
