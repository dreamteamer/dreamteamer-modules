---
name: working-with-routines
description: Use when something recurs on a schedule — a renewal, a filing, a weekly sweep — and needs a `routines` record; when a routine's date has passed and must roll forward; or when a recurrence rule has to be written, read, or turned into English. Owns the RRULE grammar and the one script that reads it.
---

# working with routines

**A routine is a rule plus a next date.** The rule is an RFC 5545 RRULE — the exact string a
calendar's "custom recurrence" dialog produces (`Repeat every 2 · month · on day 1` →
`RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1`) — and `rrule.mjs` is the only thing that reads it. A
task is a commitment made once; a routine is what would otherwise make you re-create that task
every time.

**English is rendered on demand and never stored.** There is no text field for the rule: a stored
rendering looks editable and drifts the moment the rule changes. When you need the English — a plan,
a list, a message — run `render`. **`next_due` is the opposite case and is stored**, because it
depends on today and the board sorts on it. Set `recurrence` and `anchor`, then `roll`; a hand edit
to `next_due` is overwritten by the next roll.

## writing the rule

| the dialog says | the rule |
|---|---|
| every day | `RRULE:FREQ=DAILY` |
| every week on Mon | `RRULE:FREQ=WEEKLY;BYDAY=MO` |
| every 2 weeks on Mon, Wed | `RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE` |
| every 2 months on day 1 | `RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1` |
| every month on the last Friday | `RRULE:FREQ=MONTHLY;BYDAY=-1FR` |
| every year on Sep 1 | `RRULE:FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=1` — or `RRULE:FREQ=YEARLY` with `anchor` |
| ends on a date / after 13 times | `…;UNTIL=20271130` / `…;COUNT=13` |

`anchor` is the first occurrence. It decides which months an `INTERVAL=2` lands on and supplies the
day an annual rule leaves out. **An annual routine whose date is unknown gets no anchor and a body
saying where the date will be found** — `next_due` stays empty until then, and that emptiness is the
signal.

## the loop

```bash
npx dt add routines --name "renew the car insurance" --recurrence "RRULE:FREQ=YEARLY" --anchor 2027-08-31 --tags insurance
node .dreamteamer/skills/working-with-routines/bin/rrule.mjs render "RRULE:FREQ=YEARLY" --anchor 2027-08-31
node .dreamteamer/skills/working-with-routines/bin/rrule.mjs roll            # what is stale
node .dreamteamer/skills/working-with-routines/bin/rrule.mjs roll --apply    # fix it through `dt set`
```

`roll` compares every active routine's `next_due` with what the rule says for today and writes the
difference through `dt set` — nothing else. Each row also carries the English (`text`) for reading.
Run it when a routine has been done and at the start of a planning session. It never sets `next_due`
on a daily rule: rolling a date every day is noise for a date the reader already knows.

## when the occurrence is done

Nothing on the routine records "done" — do the thing, then `roll`. If the occurrence produced work
that outlives the day, that is a task pointing back at the routine (`item: routines/<id>`), not a
field here. The `notes` body is where the last occurrence's lesson goes.

## common mistakes

| mistake | reality |
|---|---|
| looking for a stored English field | there is none; `render` produces it |
| hand-editing `next_due` | derived from `recurrence` and `anchor`; the next `roll` overwrites it |
| a cron expression in `recurrence` | the pattern refuses it; cron cannot say "every 2 months" or "until" |
| `INTERVAL=2` without an anchor | which months? — `next_due` cannot be derived |
| `UNTIL` and `COUNT` together | mutually exclusive, as in the spec |
| `retired` because this occurrence is done | `retired` is for good; a finished occurrence just rolls |
