import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRecent } from '../bin/touch-contacts.mjs';

const NOW = new Date('2026-08-30T20:00:00+03:00');
const m = (id, starts, attendees, extra = {}) => ({ id, starts, attendees, ...extra });
const c = (id, extra = {}) => ({ id, ...extra });

test('picks the latest PAST meeting per attendee and writes both fields together', () => {
	const out = computeRecent([
		m('2026/08/a', '2026-08-01T10:00:00+03:00', ['contacts/x', 'contacts/y']),
		m('2026/08/b', '2026-08-20T10:00:00+03:00', ['contacts/x']),
	], [c('x'), c('y')], NOW);
	assert.deepEqual(out, [
		{ contact: 'contacts/x', recent_meeting: 'meetings/2026/08/b', recent_meeting_date: '2026-08-20T10:00:00+03:00' },
		{ contact: 'contacts/y', recent_meeting: 'meetings/2026/08/a', recent_meeting_date: '2026-08-01T10:00:00+03:00' },
	]);
});

test('a future meeting is not "recent" — the calendar sync writes next week too', () => {
	const out = computeRecent([m('2026/09/f', '2026-09-05T10:00:00+03:00', ['contacts/x'])], [c('x')], NOW);
	assert.deepEqual(out, []);
});

test('a cancelled meeting never counts', () => {
	const out = computeRecent([m('2026/08/z', '2026-08-25T10:00:00+03:00', ['contacts/x'], { status: 'cancelled' })], [c('x')], NOW);
	assert.deepEqual(out, []);
});

test('only moves FORWARD — re-running over an older subset cannot regress a record', () => {
	const contacts = [c('x', { recent_meeting: 'meetings/2026/08/b', recent_meeting_date: '2026-08-20T10:00:00+03:00' })];
	const out = computeRecent([m('2026/08/a', '2026-08-01T10:00:00+03:00', ['contacts/x'])], contacts, NOW);
	assert.deepEqual(out, []);
});

test('idempotent — a record already holding the answer produces no change', () => {
	const contacts = [c('x', { recent_meeting: 'meetings/2026/08/b', recent_meeting_date: '2026-08-20T10:00:00+03:00' })];
	const out = computeRecent([m('2026/08/b', '2026-08-20T10:00:00+03:00', ['contacts/x'])], contacts, NOW);
	assert.deepEqual(out, []);
});

test('a newer meeting replaces an older recent_meeting and reports what it replaced', () => {
	const contacts = [c('x', { recent_meeting: 'meetings/2026/08/a', recent_meeting_date: '2026-08-01T10:00:00+03:00' })];
	const out = computeRecent([m('2026/08/b', '2026-08-20T10:00:00+03:00', ['contacts/x'])], contacts, NOW);
	assert.deepEqual(out, [{
		contact: 'contacts/x', recent_meeting: 'meetings/2026/08/b',
		recent_meeting_date: '2026-08-20T10:00:00+03:00', previous: 'meetings/2026/08/a',
	}]);
});

test('ignores attendees that are not contact refs, and refs with no record', () => {
	const out = computeRecent([m('2026/08/a', '2026-08-01T10:00:00+03:00', ['contacts/ghost', 'all@example.com', 'contacts/x'])], [c('x')], NOW);
	assert.deepEqual(out.map((o) => o.contact), ['contacts/x']);
});

test('a meeting with no starts, or an unparseable one, is skipped rather than crashing', () => {
	const out = computeRecent([m('2026/08/n', undefined, ['contacts/x']), m('2026/08/g', 'not a date', ['contacts/x'])], [c('x')], NOW);
	assert.deepEqual(out, []);
});
