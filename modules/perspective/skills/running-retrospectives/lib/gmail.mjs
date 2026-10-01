// gmail — the PURE half of the gmail reader: turning one Gmail `threads.get` (format=metadata)
// response into the record a `threads` collection keeps. No network here, so the shape is testable
// from a fixture and the reader is a loop around this.
//
// ⚠ WHAT IS DELIBERATELY NOT KEPT. No body, no snippet, no attachment names, no labels. A thread
// record is COUNTED evidence — who wrote to whom, how many times, when, under what subject — and
// the subject is the ONE text field, kept because the clustering pass needs words to seed a label.
// Everything else a mailbox holds is the person's correspondence, and this module has no business
// carrying it into a workspace another session will clone.

/** `"Ada Lovelace" <ada@example.com>` → { email: 'ada@example.com', name: 'Ada Lovelace' }. */
export function parseAddress(raw) {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	const m = /^(?:"?([^"<]*?)"?\s*)?<([^>]+)>$/.exec(s);
	const email = (m ? m[2] : s).trim().toLowerCase();
	if (!email.includes('@')) return null;
	const name = m && m[1] ? m[1].trim() : '';
	return { email, name };
}

/** Every address in a To/Cc header, in order, invalid ones dropped. */
export function parseAddressList(raw) {
	// Split on commas that are not inside quotes — a display name may carry one ("Lovelace, Ada").
	const parts = String(raw ?? '').match(/(?:"[^"]*"|[^,])+/g) ?? [];
	return parts.map(parseAddress).filter(Boolean);
}

/** `Re: Fwd: RE: Budget` → `Budget`. The subject as the thread is about, not as the last reply spelled it. */
export function bareSubject(raw) {
	let s = String(raw ?? '').trim();
	for (;;) {
		const next = s.replace(/^\s*(re|fwd?|fw|aw|wg|tr|sv|vs|השב|הועבר)\s*:\s*/i, '');
		if (next === s) break;
		s = next;
	}
	return s || '(no subject)';
}

const header = (msg, name) => (msg.payload?.headers ?? []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
const day = (ms) => new Date(Number(ms)).toISOString().slice(0, 10);

/**
 * One thread → the fields of a `threads` record plus the per-message facts the reader rolls into
 * weeks and collaborators. `contributorHandles` is every address the contributor is known by, lowercased.
 * Returns null when the contributor wrote nothing in it — a thread they only received is not their work.
 */
export function summarizeThread(thread, contributorHandles) {
	const mine = new Set([...contributorHandles].map((h) => String(h).toLowerCase()));
	const msgs = (thread.messages ?? []).filter((m) => m.internalDate);
	if (!msgs.length) return null;
	const people = new Map();                     // email → { email, name, sent }
	const sent = [];                              // days the contributor sent on
	let first = Infinity, last = -Infinity, subject = '';
	for (const m of msgs) {
		const at = Number(m.internalDate);
		if (at < first) { first = at; subject = header(m, 'Subject'); }
		if (at > last) last = at;
		const from = parseAddress(header(m, 'From'));
		const others = [...parseAddressList(header(m, 'To')), ...parseAddressList(header(m, 'Cc'))];
		for (const p of [from, ...others].filter(Boolean)) {
			const cur = people.get(p.email) ?? { email: p.email, name: '', sent: 0 };
			if (p.name && !cur.name) cur.name = p.name;
			people.set(p.email, cur);
		}
		if (from) {
			people.get(from.email).sent++;
			if (mine.has(from.email)) sent.push(day(at));
		}
	}
	if (!sent.length) return null;
	const participants = [...people.keys()].sort();
	const counterparts = [...people.values()].filter((p) => !mine.has(p.email)).sort((a, b) => (a.email < b.email ? -1 : 1));
	return {
		fields: {
			external_id: thread.id,
			subject: bareSubject(subject),
			participants,
			message_count: msgs.length,
			contributor_messages: sent.length,
			first_on: day(first),
			last_on: day(last),
			url: `https://mail.google.com/mail/u/0/#all/${thread.id}`,
		},
		sentDays: sent,
		counterparts,
	};
}
