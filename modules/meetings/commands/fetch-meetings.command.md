---
name: fetch-meetings
description: fetch calendar meetings into data/meetings for a week or date range
argument-hint: [week | YYYY-MM-DD..YYYY-MM-DD]
---
load the `fetching-meetings` skill and fetch my work meetings into data/meetings/ for: $ARGUMENTS
(default: the current week). dedupe across calendars, classify companies, follow the
data/meetings file convention.
