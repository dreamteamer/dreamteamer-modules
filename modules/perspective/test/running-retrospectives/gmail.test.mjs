// The pure half of the gmail reader, pinned from a fixture: addresses parse, subjects lose their
// Re:/Fwd: stack, a thread the contributor never wrote in is dropped, and NOTHING from the body
// reaches the record — there is no body in the fixture and no field for one in the output.
import { test } from 'node:test';
import assert from 'node:assert';
import { parseAddress, parseAddressList, bareSubject, summarizeThread } from '../../skills/running-retrospectives/lib/gmail.mjs';

test('addresses parse with or without a display name, lists split outside quotes', () => {
	assert.deepEqual(parseAddress('"Ada Lovelace" <Ada@Example.com>'), { email: 'ada@example.com', name: 'Ada Lovelace' });
	assert.deepEqual(parseAddress('ada@example.com'), { email: 'ada@example.com', name: '' });
	assert.equal(parseAddress('undisclosed-recipients:;'), null);
	assert.deepEqual(parseAddressList('"Lovelace, Ada" <ada@example.com>, bob@example.org').map((p) => p.email), ['ada@example.com', 'bob@example.org']);
});

test('a subject is what the thread is about, not how the last reply spelled it', () => {
	assert.equal(bareSubject('Re: Fwd: RE: Budget Q3'), 'Budget Q3');
	assert.equal(bareSubject('  FW: hello'), 'hello');
	assert.equal(bareSubject(''), '(no subject)');
});

const msg = (i, from, to, subject, day) => ({
	id: `m${i}`, internalDate: String(Date.UTC(2026, 8, day, 10, i)),
	payload: { headers: [{ name: 'From', value: from }, { name: 'To', value: to }, { name: 'Subject', value: subject }] },
});

test('a thread the contributor wrote in becomes counts, handles and dates — and nothing else', () => {
	const t = { id: 'T1', messages: [
		msg(1, '"Bob" <bob@acme.example>', 'me@work.example', 'Spec review', 1),
		msg(2, 'Me <me@work.example>', 'bob@acme.example, "Cy" <cy@acme.example>', 'Re: Spec review', 2),
		msg(3, 'cy@acme.example', 'me@work.example', 'RE: Re: Spec review', 9),
	] };
	const s = summarizeThread(t, ['me@work.example']);
	assert.deepEqual(s.fields, {
		external_id: 'T1', subject: 'Spec review',
		participants: ['bob@acme.example', 'cy@acme.example', 'me@work.example'],
		message_count: 3, contributor_messages: 1, first_on: '2026-09-01', last_on: '2026-09-09',
		url: 'https://mail.google.com/mail/u/0/#all/T1',
	});
	assert.deepEqual(s.sentDays, ['2026-09-02']);
	assert.deepEqual(s.counterparts.map((c) => [c.email, c.name]), [['bob@acme.example', 'Bob'], ['cy@acme.example', 'Cy']]);
	assert.ok(!('snippet' in s.fields) && !('body' in s.fields) && !('content' in s.fields));
});

test('a thread the contributor only received is not their work and is dropped; a second handle of theirs counts', () => {
	const t = { id: 'T2', messages: [msg(1, 'bob@acme.example', 'me@work.example', 'FYI', 1)] };
	assert.equal(summarizeThread(t, ['me@work.example']), null);
	const t2 = { id: 'T3', messages: [msg(1, 'me.other@home.example', 'bob@acme.example', 'Hi', 1)] };
	assert.equal(summarizeThread(t2, ['me@work.example', 'me.other@home.example']).fields.contributor_messages, 1);
});
