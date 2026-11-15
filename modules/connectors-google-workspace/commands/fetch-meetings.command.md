---
name: fetch-meetings
description: fetch calendar meetings into meetings records for a week or date range
argument-hint: [week | YYYY-MM-DD..YYYY-MM-DD]
---
load the `fetching-meetings` skill and fetch my work meetings into `meetings` records for: $ARGUMENTS
(default: the current week). read the calendars with `gcal.mjs rows` and check them with
`gcal.mjs access`, dedupe across calendars, classify companies, and write each record with
`dt add meetings` / `dt set`, so it lands where the descriptor places it.
