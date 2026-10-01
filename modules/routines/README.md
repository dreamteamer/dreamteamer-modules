# @dreamteamer/routines

Commitments that come round again: a renewal, a filing, a weekly sweep. Each routine is a
calendar-style recurrence rule (an RFC 5545 RRULE), the date it counts from, and the next date it is
owed. A one-off commitment is a task; a routine is what would otherwise make you re-create one.

```bash
npm install @dreamteamer/routines
npx dreamteamer compile
npx dt add routines --name "renew the car insurance" --recurrence "RRULE:FREQ=YEARLY" --anchor 2027-08-31
node .dreamteamer/skills/working-with-routines/bin/rrule.mjs roll --apply
```

| needs | for |
|---|---|
| nothing | records, rendering a rule in English, rolling `next_due` |

`next_due` is written by `roll`, never by hand. A daily routine has no `next_due` by design.
