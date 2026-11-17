// The context the transcriber reads (cr-modules-019). The Python reads and writes one recording's file and
// nothing else of the workspace, so naming a voice needs the rest handed to it: the recording's meeting,
// its attendees made distinct and whether that count is certain (design section 10 step 1), the
// workspace's people and their display names, the documents already written from the transcript, and the
// folders the voice-print store may not live in (section 8). All of it is read through the ENGINE
// (`dt get`, `dt list`, `dt resolve`) — never by walking `data/` — so a record stored outside its id
// template, or in a layered repo, resolves the way `dt get` resolves it.
//
// Shapes (the node entry writes one of them to a temp file and passes it by `--context`):
//   base             {workspace, guard: {workspace, files_folder, inbox_folders: []}, known: {<ref>: name},
//                     workspace_users: [{person, name}]}
//   one record       base + {record, record_path, audio, fingerprint, diarization_id,
//                     meeting: {ref, name, date, location} | null, candidates: [{person, name, kind, contact?, you?}],
//                     attendee_count, attendee_count_certain, documents: [{ref, kind, created}]}
//   several records  base + {records: [<one record>…]}
//   one person       base + {person: {ref, name}, person_records: [<personRecords row>…]}
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const RECORDINGS = 'meeting-recordings';
const DOCUMENT_KINDS = [['meeting-summaries', 'summary'], ['meeting-analyses', 'analysis'], ['tasks', 'task']];

// ── the engine ──────────────────────────────────────────────────────────────────────────────────────
function engineCommand(root) {
	const pkgPath = path.join(root, 'node_modules', 'dreamteamer', 'package.json');
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
		const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.dreamteamer ?? Object.values(pkg.bin ?? {})[0]);
		if (bin) return [process.execPath, [path.join(path.dirname(pkgPath), bin)]];
	} catch { /* no local engine: npx finds the workspace's */ }
	return ['npx', ['--no-install', 'dreamteamer']];
}

async function dt(root, args) {
	const [cmd, pre] = engineCommand(root);
	try {
		const { stdout } = await execFileP(cmd, [...pre, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
		return stdout;
	} catch (e) {
		const why = String(e.stderr || e.stdout || e.message).trim().split('\n').slice(0, 3).join(' | ');
		const err = new Error(`dreamteamer ${args.join(' ')}: ${why}`);
		err.stderr = String(e.stderr ?? '');
		throw err;
	}
}
const json = async (root, args) => JSON.parse(await dt(root, args));

/** Every record of a collection; an empty list when the collection is not installed here. */
async function list(root, collection) {
	try { return await json(root, ['list', collection, '--json']); }
	catch (e) { if (/unknown collection/.test(e.stderr ?? e.message)) return []; throw e; }
}

/** Render `${env:…}` templates through the engine, one call for all; null for any that does not render. */
async function resolveTemplates(root, templates) {
	const want = templates.map((t) => (typeof t === 'string' && t.trim() ? t : null));
	const todo = [...new Set(want.filter((t) => t && !t.includes('\n')))];
	const out = new Map();
	if (todo.length) {
		try {
			const lines = (await dt(root, ['resolve', todo.join('\n')])).replace(/\n$/, '').split('\n');
			if (lines.length === todo.length) todo.forEach((t, i) => out.set(t, lines[i] || null));
		} catch { /* one unset variable fails the whole call: fall back to one call each */ }
		for (const t of todo.filter((x) => !out.has(x))) {
			try { out.set(t, (await dt(root, ['resolve', t])).replace(/\n$/, '') || null); } catch { out.set(t, null); }
		}
	}
	return want.map((t) => (t ? out.get(t) ?? null : null));
}

// ── small readers ───────────────────────────────────────────────────────────────────────────────────
const refOf = (collection, rec) => `${collection}/${rec.id}`;
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const lower = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
const fileOf = (root, rec) => (rec.$file ? path.join(root, rec.$file) : null);

// Python's str.split() whitespace (str.isspace), which is not JavaScript's \s: it adds \x1c-\x1f and \x85
// and leaves out the byte-order mark U+FEFF.
const PY_SPACE = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;
/** A person's name as every Python half compares it — prints._norm, identify._norm, enrol._norm,
 *  naming._key: `" ".join(str(s or "").split()).casefold()`. Casefold is upper-then-lower here (the sharp s
 *  folds to ss), with the final sigma folded to sigma as casefold does. One rule in both languages: a name
 *  the Python finds is a name `personRecords` finds (finding forget-misses-a-name-in-another-case). */
export function normName(s) {
	const str = s ? String(s) : '';
	return str.split(PY_SPACE).filter(Boolean).join(' ').toUpperCase().toLowerCase().replace(/\u03c2/g, '\u03c3');
}

/** A record argument as a `meeting-recordings/<id>` reference: a reference, a bare id, or a path to the
 *  record's file (matched against the engine's own `$file`). */
export async function recordRef(root, given) {
	const s = String(given ?? '').trim();
	if (!s) throw new Error('no recording named');
	const abs = path.resolve(root, s);
	const exists = fs.existsSync(abs);
	if (/\.md$/.test(s) || (exists && fs.statSync(abs).isFile())) {
		const rel = path.relative(fs.realpathSync(root), exists ? fs.realpathSync(abs) : abs).split(path.sep).join('/');
		const m = /^data\/meeting-recordings\/(.+)\.meeting-recording\.md$/.exec(rel);
		if (m) return `${RECORDINGS}/${m[1]}`;
		const hit = (await list(root, RECORDINGS)).find((r) => r.$file === rel);
		if (hit) return refOf(RECORDINGS, hit);
		throw new Error(`${s} is not a meeting-recordings record of this workspace`);
	}
	return s.startsWith(`${RECORDINGS}/`) ? s : `${RECORDINGS}/${s}`;
}

function guardFrom(root, filesFolder, inboxRaw) {
	const inbox = [];
	for (const line of String(inboxRaw ?? '').split('\n')) {
		const entry = line.trim();
		if (!entry) continue;
		// the recordings setup wrote a comma list before 0.5.2; a folder whose name holds a comma stays one root
		if (!fs.existsSync(entry) && entry.includes(',')) inbox.push(...entry.split(',').map((x) => x.trim()).filter(Boolean));
		else inbox.push(entry);
	}
	return { workspace: root, files_folder: filesFolder || null, inbox_folders: inbox };
}

/** What every context carries, read once: the workspace's name, its people, its documents, the guard. */
async function snapshot(root) {
	let workspace = null;
	try { workspace = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name ?? null; } catch { /* nameless */ }
	const [users, contacts, docs, [files, inboxRaw]] = await Promise.all([
		list(root, 'users'),
		list(root, 'contacts'),
		Promise.all(DOCUMENT_KINDS.map(([c]) => list(root, c))),
		resolveTemplates(root, ['${env:FILES_FOLDER}', '${env:INBOX_FOLDERS}']).catch(() => [null, null]),
	]);
	const U = users.map((u) => ({ ref: refOf('users', u), name: u.name ?? u.id, email: u.email, handles: arr(u.handles), contact: u.contact ?? null, kind: u.kind ?? 'human' }));
	const C = contacts.map((c) => ({ ref: refOf('contacts', c), name: c.name ?? c.id, email: c.email }));
	const known = {};
	for (const p of [...C, ...U]) known[p.ref] = p.name;
	const humans = U.filter((u) => u.kind !== 'agent').sort((a, b) => a.ref.localeCompare(b.ref));
	const strings = (v) => arr(v).filter((x) => typeof x === 'string').map((x) => x.trim());
	// a document names a recording or a meeting by `source` (any kind), a summary its meeting by `meeting`,
	// an analysis the calls it reviews by `meetings`
	const documents = DOCUMENT_KINDS.flatMap(([c, kind], i) => docs[i].map((d) => ({ ref: refOf(c, d), kind, created: d.created ?? null,
		names: [...strings(d.source), ...(kind === 'summary' ? strings(d.meeting) : []), ...(kind === 'analysis' ? strings(d.meetings) : [])] })));
	return {
		base: { workspace, guard: guardFrom(root, files, inboxRaw), known, workspace_users: humans.map((u) => ({ person: u.ref, name: u.name })) },
		users: U, humans, contacts: C, documents,
	};
}

/** Design section 10 step 1, the sameness rule, decided per (user, contact) pair: a contact IS the user when
 *  the user's `contact` points at it, or the user's `email` or one of its `handles` equals the contact's
 *  email (case-insensitively). Every contact of `contacts` the user is, in their order. */
function contactsOfUser(u, contacts) {
	const addresses = new Set([lower(u.email), ...arr(u.handles).map(lower)].filter(Boolean));
	return contacts.filter((c) => (u.contact && c.ref === u.contact) || (c.email && addresses.has(lower(c.email))));
}

/** A user as a candidate: the contact it carries is one the meeting lists when it is joined to such a
 *  contact, else its own `contact`, else the first it is joined to. */
function userCandidate(u, joined, listed, selves) {
	const cand = { person: u.ref, name: u.name, kind: 'user' };
	const pick = joined.find((c) => listed.has(c.ref)) ?? joined.find((c) => c.ref === u.contact) ?? joined[0];
	if (pick) cand.contact = pick.ref;
	const addresses = [lower(u.email), ...arr(u.handles).map(lower), ...joined.map((c) => lower(c.email))];
	if (addresses.some((a) => a && selves.has(a))) cand.you = true;
	return cand;
}

/** Design section 10 step 1: the meeting's `ours` users and `attendees_contacts`, made distinct — one
 *  candidate per person. A user takes EVERY attendee contact it is the same person as (`contactsOfUser`),
 *  so a second contact record of the user is not a second person. A user joinable to no contact at all
 *  while `attendees_contacts` is not empty makes the count uncertain. `users` and `contacts` are
 *  `{ref, name, email, handles?, contact?}` rows. */
export function distinctAttendees(meeting, users, contacts, selfEmails = []) {
	const byRef = (rows) => new Map(rows.map((r) => [r.ref, r]));
	const U = byRef(users), C = byRef(contacts);
	const ourRefs = [...new Set(arr(meeting?.ours))];
	const contactRefs = [...new Set(arr(meeting?.attendees_contacts))];
	const listed = new Set(contactRefs);
	const selves = new Set(arr(selfEmails).map(lower).filter(Boolean));
	const candidates = [];
	const taken = new Set();
	let certain = true;
	for (const ref of ourRefs) {
		const u = U.get(ref) ?? { ref, name: ref.split('/').pop() };
		const joined = contactsOfUser(u, contacts);
		if (!joined.length && contactRefs.length) certain = false;
		for (const c of joined) if (listed.has(c.ref)) taken.add(c.ref);
		candidates.push(userCandidate(u, joined, listed, selves));
	}
	for (const ref of contactRefs) {
		if (taken.has(ref)) continue;
		const c = C.get(ref) ?? { ref, name: ref.split('/').pop() };
		const cand = { person: ref, name: c.name, kind: 'contact' };
		if (c.email && selves.has(lower(c.email))) cand.you = true;
		candidates.push(cand);
	}
	return { candidates, count: candidates.length, certain };
}

/** With no meeting (design section 10 step 1): the workspace's human users, then every contact that is no
 *  human user — a contact joined to a user is that user, one candidate. Naming proposes a contact here and
 *  never writes it. */
function workspaceCandidates(snap) {
	const taken = new Set();
	const users = snap.humans.map((u) => {
		const joined = contactsOfUser(u, snap.contacts);
		for (const c of joined) taken.add(c.ref);
		return userCandidate(u, joined, new Set(), new Set());
	});
	const contacts = snap.contacts.filter((c) => !taken.has(c.ref)).sort((a, b) => a.ref.localeCompare(b.ref))
		.map((c) => ({ person: c.ref, name: c.name, kind: 'contact' }));
	return [...users, ...contacts];
}

function selfEmailsOf(meeting) {
	const out = arr(meeting?.attendees).filter((a) => a && a.self && a.email).map((a) => a.email);
	if (meeting?.organizer?.self && meeting.organizer.email) out.push(meeting.organizer.email);
	return out;
}

function documentsFor(snap, recRef, meetingRef) {
	const names = new Set([recRef, meetingRef].filter(Boolean));
	return snap.documents.filter((d) => d.names.some((s) => names.has(s))).map(({ ref, kind, created }) => ({ ref, kind, created }));
}

function contextOf(root, snap, rec, audio, meeting) {
	const ref = refOf(RECORDINGS, rec);
	const meetingRef = meeting ? refOf('meetings', meeting) : null;
	let candidates, count = null, certain = false;
	if (meeting) {
		const d = distinctAttendees(meeting, snap.users, snap.contacts, selfEmailsOf(meeting));
		({ candidates, count, certain } = d);
	} else {
		candidates = workspaceCandidates(snap);
	}
	return {
		...snap.base,
		record: ref,
		record_path: fileOf(root, rec),
		audio,
		fingerprint: rec.fingerprint ?? null,
		diarization_id: rec.transcription?.diarization_id ?? null,
		meeting: meeting ? { ref: meetingRef, name: meeting.name ?? null, date: meeting.starts ?? null, location: meeting.location ?? null } : null,
		candidates,
		attendee_count: count,
		attendee_count_certain: certain,
		documents: documentsFor(snap, ref, meetingRef),
	};
}

async function getMeeting(root, ref) {
	try { return await json(root, ['get', ref, '--json']); }
	catch (e) { if (/no such record/.test(e.message)) return null; throw e; }
}

/** One recording's context. `recordRefOrPath` is a `meeting-recordings/<id>` reference, a bare id, or the
 *  path of the record's file. Rejects when the workspace holds no such recording. */
export async function recordingContext(root, recordRefOrPath, snap = null) {
	const ref = await recordRef(root, recordRefOrPath);
	const [s, rec] = await Promise.all([snap ?? snapshot(root), json(root, ['get', ref, '--json'])]);
	const [[audio], meeting] = await Promise.all([
		resolveTemplates(root, [rec.recording_file]),
		rec.meeting ? getMeeting(root, rec.meeting) : null,
	]);
	return contextOf(root, s, rec, audio, meeting);
}

/** Several recordings' contexts, sharing one read of the workspace: `{...base, records: [<context>…]}`. */
export async function recordsContext(root, recordRefsOrPaths) {
	const refs = await Promise.all(recordRefsOrPaths.map((r) => recordRef(root, r)));
	const s = await snapshot(root);
	const recs = await Promise.all(refs.map((r) => json(root, ['get', r, '--json'])));
	return withRecords(root, s, recs);
}

async function withRecords(root, s, recs) {
	const meetingRefs = [...new Set(recs.map((r) => r.meeting).filter(Boolean))];
	let meetings;
	if (meetingRefs.length > 3) {
		const all = new Map((await list(root, 'meetings')).map((m) => [refOf('meetings', m), m]));
		meetings = new Map(meetingRefs.map((r) => [r, all.get(r) ?? null]));
	} else {
		meetings = new Map(await Promise.all(meetingRefs.map(async (r) => [r, await getMeeting(root, r)])));
	}
	const audio = await resolveTemplates(root, recs.map((r) => r.recording_file));
	return { ...s.base, records: recs.map((r, i) => contextOf(root, s, r, audio[i], r.meeting ? meetings.get(r.meeting) : null)) };
}

/** Every recording of the workspace that has a `transcription.diarization_id` — `evaluate-speakers`. */
export async function diarisedContext(root) {
	const [s, all] = await Promise.all([snapshot(root), list(root, RECORDINGS)]);
	return withRecords(root, s, all.filter((r) => r.transcription && r.transcription.diarization_id));
}

/** The context of a verb that names no recording (`prints list`, `prints rebuild`, …). */
export async function baseContext(root) {
	return (await snapshot(root)).base;
}

/** This workspace's recordings whose `transcription.speakers`, `speaker_sources`, `previous_speakers` or
 *  `speaker_questions.*.proposed` name the person — by reference, or by the name string where a label
 *  carries no reference. Each row: `{record, record_path, audio, fingerprint, diarization_id,
 *  matches: [{label, where, diarization_id, new_label?}]}`; a label in `previous_speakers` belongs to the
 *  earlier diarisation, so its match carries that diarisation's id and the new label its time went to — and
 *  an entry kept under `earlier:<key>` reports the earlier diarisation's label it carries in `label`. */
export async function personRecords(root, personRef, snap = null) {
	const [s, all] = await Promise.all([snap ?? snapshot(root), list(root, RECORDINGS)]);
	const name = s.base.known[personRef] ?? null;
	// prints._theirs: a reference decides when there is one; else the name, folded the way the Python folds it
	const key = normName(name);
	const sameName = (n) => !!name && normName(n) === key;
	const names = (entryName, entryPerson) => (entryPerson ? entryPerson === personRef : sameName(entryName));
	const rows = [];
	for (const rec of all) {
		const t = rec.transcription;
		if (!t || typeof t !== 'object') continue;
		const did = t.diarization_id ?? null;
		const matches = [];
		const sources = t.speaker_sources && typeof t.speaker_sources === 'object' ? t.speaker_sources : {};
		for (const [label, n] of Object.entries(t.speakers && typeof t.speakers === 'object' ? t.speakers : {})) {
			const src = sources[label];
			if (src && src.person) { if (src.person === personRef) matches.push({ label, where: 'speaker_sources', diarization_id: did }); }
			else if (sameName(n)) matches.push({ label, where: 'speakers', diarization_id: did });
		}
		for (const [label, src] of Object.entries(sources)) {
			if (src && src.person === personRef && !matches.some((m) => m.label === label)) matches.push({ label, where: 'speaker_sources', diarization_id: did });
		}
		const prev = t.previous_speakers;
		if (prev && typeof prev === 'object' && prev.labels && typeof prev.labels === 'object') {
			for (const [label, e] of Object.entries(prev.labels)) {
				// an `earlier:<key>` entry names the label it sat on in `label` (carry.py): that is the earlier
				// diarisation's label, the key is not
				if (e && names(e.name, e.source?.person)) matches.push({ label: typeof e.label === 'string' && e.label ? e.label : label, where: 'previous_speakers', diarization_id: prev.diarization_id ?? null, new_label: e.new_label ?? null });
			}
		}
		for (const [label, q] of Object.entries(t.speaker_questions && typeof t.speaker_questions === 'object' ? t.speaker_questions : {})) {
			const p = q?.proposed;
			if (p && names(p.name, p.person)) matches.push({ label, where: 'speaker_questions', diarization_id: did });
		}
		if (matches.length) rows.push({ rec, matches });
	}
	const audio = await resolveTemplates(root, rows.map((r) => r.rec.recording_file));
	return rows.map(({ rec, matches }, i) => ({
		record: refOf(RECORDINGS, rec), record_path: fileOf(root, rec), audio: audio[i],
		fingerprint: rec.fingerprint ?? null, diarization_id: rec.transcription.diarization_id ?? null, matches,
	}));
}

/** `{...base, person: {ref, name}, person_records}` — `prints forget|never`, `identify --revert --person`. */
export async function personContext(root, personRef) {
	const s = await snapshot(root);
	return { ...s.base, person: { ref: personRef, name: s.base.known[personRef] ?? null }, person_records: await personRecords(root, personRef, s) };
}
