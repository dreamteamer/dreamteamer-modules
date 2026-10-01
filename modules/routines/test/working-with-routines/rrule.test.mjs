import { test } from 'node:test';
import assert from 'node:assert';
import { parse, toEnglish, nextDue } from '../../skills/working-with-routines/bin/rrule.mjs';

test('parse: accepts the Google-shaped string with or without the RRULE: prefix, rejects junk', () => {
	assert.equal(parse('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE').interval, 2);
	assert.equal(parse('FREQ=YEARLY').freq, 'YEARLY');
	assert.throws(() => parse('RRULE:FREQ=HOURLY'), /unsupported FREQ/);
	assert.throws(() => parse('RRULE:INTERVAL=2'), /FREQ is required/);
	assert.throws(() => parse('RRULE:FREQ=DAILY;COUNT=3;UNTIL=20261130'), /mutually exclusive/);
	assert.throws(() => parse('RRULE:FREQ=WEEKLY;BYDAY=MONDAY'), /bad BYDAY/);
	assert.throws(() => parse('RRULE:FREQ=WEEKLY;BYSETPOS=1'), /unsupported rule part/);
});

test('english: reads the way the calendar dialog would', () => {
	assert.equal(toEnglish('RRULE:FREQ=DAILY'), 'Daily');
	assert.equal(toEnglish('RRULE:FREQ=WEEKLY;BYDAY=MO'), 'Weekly on Monday');
	assert.equal(toEnglish('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'), 'Every 2 weeks on Monday, Wednesday');
	assert.equal(toEnglish('RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1'), 'Every 2 months on day 1');
	assert.equal(toEnglish('RRULE:FREQ=MONTHLY;BYDAY=-1FR'), 'Monthly on the last Friday');
	assert.equal(toEnglish('RRULE:FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=1'), 'Annually on September 1');
	assert.equal(toEnglish('RRULE:FREQ=YEARLY', '2027-08-31'), 'Annually on August 31');
	assert.equal(toEnglish('RRULE:FREQ=YEARLY'), 'Annually');
	assert.equal(toEnglish('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130'), 'Weekly on Monday, until Nov 30, 2026');
	assert.equal(toEnglish('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=13'), 'Weekly on Monday, 13 times');
	assert.equal(toEnglish('RRULE:FREQ=WEEKLY', '2026-08-31'), 'Weekly on Monday'); // day defaults to the anchor
});

test('next_due: daily is never tracked, and no anchor means no date', () => {
	assert.equal(nextDue('RRULE:FREQ=DAILY', '2026-01-01', '2026-08-30'), null);
	assert.equal(nextDue('RRULE:FREQ=YEARLY', undefined, '2026-08-30'), null);
});

test('next_due: every 2 months on day 1, anchored Sep 2026, lands on the odd months', () => {
	const r = 'RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=1';
	assert.equal(nextDue(r, '2026-09-01', '2026-08-30'), '2026-09-01');
	assert.equal(nextDue(r, '2026-09-01', '2026-09-01'), '2026-09-01'); // on the day is still due today
	assert.equal(nextDue(r, '2026-09-01', '2026-09-02'), '2026-11-01');
	assert.equal(nextDue(r, '2026-09-01', '2026-12-15'), '2027-01-01');
});

test('next_due: annual from an anchor, including the year after the anchor', () => {
	assert.equal(nextDue('RRULE:FREQ=YEARLY', '2027-08-31', '2026-08-30'), '2027-08-31');
	assert.equal(nextDue('RRULE:FREQ=YEARLY', '2027-08-31', '2027-09-01'), '2028-08-31');
	assert.equal(nextDue('RRULE:FREQ=YEARLY;INTERVAL=2', '2026-03-10', '2026-04-01'), '2028-03-10');
});

test('next_due: weekly with BYDAY and a biweekly interval aligned to the anchor week', () => {
	// 2026-08-31 is a Monday
	assert.equal(nextDue('RRULE:FREQ=WEEKLY;BYDAY=MO,WE', '2026-08-31', '2026-09-01'), '2026-09-02');
	assert.equal(nextDue('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-08-31', '2026-09-01'), '2026-09-14');
});

test('next_due: monthly on the last Friday', () => {
	assert.equal(nextDue('RRULE:FREQ=MONTHLY;BYDAY=-1FR', '2026-08-28', '2026-08-30'), '2026-09-25');
});

test('next_due: COUNT and UNTIL end the series', () => {
	assert.equal(nextDue('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2', '2026-08-31', '2026-09-08'), null);
	assert.equal(nextDue('RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2', '2026-08-31', '2026-09-02'), '2026-09-07');
	assert.equal(nextDue('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260906', '2026-08-31', '2026-09-02'), null);
});
