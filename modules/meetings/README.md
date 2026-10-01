# @dreamteamer/meetings

Your calendar meetings, synced from Google Calendar, and the three things a call produces: a short
prep to read before it, a neutral summary after it, and an honest critique when you want one.

```bash
npm install @dreamteamer/meetings @dreamteamer/contacts @dreamteamer/tasks @dreamteamer/users @dreamteamer/assets
npx dreamteamer compile
```

| alone | with others |
|---|---|
| meetings, preps, summaries and critiques, written from notes | **recordings** (not yet in this repo) adds the audio and transcript, and the transcript-gated steps: summarise, extract tasks, critique |

| needs | for |
|---|---|
| `@dreamteamer/contacts` | attendees |
| `@dreamteamer/tasks` | the follow-ups a call produces |
| `@dreamteamer/users` | the people of yours in the room |
| `@dreamteamer/assets` | contacts needs it for avatars and logos |
| a Google account and `WORK_CALENDARS` in `.env` | calendar sync only; writing meetings by hand works without them |
