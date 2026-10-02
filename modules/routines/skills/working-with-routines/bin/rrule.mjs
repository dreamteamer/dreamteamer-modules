#!/usr/bin/env node
// rrule.mjs — the one place a `routines.recurrence` string is read.
//
//   node .dreamteamer/skills/working-with-routines/bin/rrule.mjs render "<RRULE>" [--anchor YYYY-MM-DD] [--today YYYY-MM-DD]
//       → JSON { text, next_due }   (next_due null for DAILY, or when the rule needs an anchor it lacks)
//   node .dreamteamer/skills/working-with-routines/bin/rrule.mjs roll [--today YYYY-MM-DD] [--apply]
//       → reports every active routine whose next_due is stale; --apply writes the fix through `dt set`.
//
// `render`'s `text` is for reading — a list, a plan, a message — and is never written to a record:
// a rendering of `recurrence` is not state, so there is nothing to keep in sync. `next_due` is state,
// because it depends on today, and it is the only field `roll` writes.
//
// Grammar: FREQ (DAILY|WEEKLY|MONTHLY|YEARLY), INTERVAL, BYDAY (with an ordinal: 2TU, -1FR),
// BYMONTHDAY, BYMONTH, COUNT, UNTIL. WKST is accepted and ignored; weeks start on Monday. Anything
// else is an error, not a silent skip.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const DAY_NAMES = { MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ORD = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last', '-2': 'second-to-last' };

export function parse(rrule) {
	if (typeof rrule !== 'string') throw new Error('recurrence must be a string');
	const body = rrule.startsWith('RRULE:') ? rrule.slice(6) : rrule;
	const r = { interval: 1, byday: [], bymonthday: [], bymonth: [] };
	for (const part of body.split(';').filter(Boolean)) {
		const [k, v] = part.split('=');
		if (v === undefined) throw new Error(`malformed part "${part}"`);
		switch (k) {
			case 'FREQ':
				if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(v)) throw new Error(`unsupported FREQ=${v}`);
				r.freq = v; break;
			case 'INTERVAL': r.interval = int(v, k); if (r.interval < 1) throw new Error('INTERVAL must be ≥ 1'); break;
			case 'COUNT': r.count = int(v, k); break;
			case 'UNTIL': r.until = parseUntil(v); break;
			case 'BYDAY':
				r.byday = v.split(',').map((d) => {
					const m = /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(d);
					if (!m) throw new Error(`bad BYDAY entry "${d}"`);
					return { ord: m[1] ? parseInt(m[1], 10) : 0, day: m[2] };
				}); break;
			case 'BYMONTHDAY': r.bymonthday = v.split(',').map((x) => int(x, k)); break;
			case 'BYMONTH': r.bymonth = v.split(',').map((x) => int(x, k)); break;
			case 'WKST': break;
			default: throw new Error(`unsupported rule part ${k}`);
		}
	}
	if (!r.freq) throw new Error('FREQ is required');
	if (r.count !== undefined && r.until) throw new Error('COUNT and UNTIL are mutually exclusive');
	return r;
}

const int = (v, k) => { if (!/^-?\d+$/.test(v)) throw new Error(`${k} must be an integer, got "${v}"`); return parseInt(v, 10); };
const parseUntil = (v) => {
	const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
	if (!m) throw new Error(`bad UNTIL "${v}"`);
	return `${m[1]}-${m[2]}-${m[3]}`;
};

// ---- English, the way the calendar dialog phrases it -----------------------------------------
export function toEnglish(rrule, anchor) {
	const r = typeof rrule === 'string' ? parse(rrule) : rrule;
	const a = anchor ? toDate(anchor) : null;
	const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.freq];
	const head = r.interval === 1
		? { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Annually' }[r.freq]
		: `Every ${r.interval} ${unit}s`;
	let on = '';
	if (r.freq === 'WEEKLY') {
		const days = r.byday.length ? r.byday.map((d) => d.day) : a ? [DAYS[(a.getUTCDay() + 6) % 7]] : [];
		if (days.length === 7) on = ' on every day';
		else if (days.length) on = ` on ${days.map((d) => DAY_NAMES[d]).join(', ')}`;
	} else if (r.freq === 'MONTHLY') {
		if (r.byday.length) on = ` on the ${r.byday.map((d) => `${ORD[d.ord] ?? d.ord} ${DAY_NAMES[d.day]}`).join(', ')}`;
		else if (r.bymonthday.length) on = ` on day ${r.bymonthday.join(', ')}`;
		else if (a) on = ` on day ${a.getUTCDate()}`;
	} else if (r.freq === 'YEARLY') {
		const months = r.bymonth.length ? r.bymonth : a ? [a.getUTCMonth() + 1] : [];
		const day = r.bymonthday[0] ?? (a ? a.getUTCDate() : null);
		if (months.length && day) on = ` on ${months.map((m) => `${MONTHS[m - 1]} ${day}`).join(', ')}`;
		else if (months.length) on = ` in ${months.map((m) => MONTHS[m - 1]).join(', ')}`;
	}
	let tail = '';
	if (r.until) tail = `, until ${fmtLong(r.until)}`;
	else if (r.count !== undefined) tail = `, ${r.count} time${r.count === 1 ? '' : 's'}`;
	return `${head}${on}${tail}`;
}

const fmtLong = (iso) => { const d = toDate(iso); return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };

// ---- occurrences -----------------------------------------------------------------------------
const toDate = (iso) => {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
	if (!m) throw new Error(`bad date "${iso}" — want YYYY-MM-DD`);
	return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
};
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const weekday = (d) => DAYS[(d.getUTCDay() + 6) % 7]; // MO=0
const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const mondayOf = (d) => addDays(d, -((d.getUTCDay() + 6) % 7));

// does `d` satisfy the BYDAY ordinal rule inside its month?
function matchesByDayInMonth(d, byday) {
	const wd = weekday(d), y = d.getUTCFullYear(), m0 = d.getUTCMonth();
	const nth = Math.floor((d.getUTCDate() - 1) / 7) + 1;
	const nthFromEnd = -(Math.floor((daysInMonth(y, m0) - d.getUTCDate()) / 7) + 1);
	return byday.some((b) => b.day === wd && (b.ord === 0 || b.ord === nth || b.ord === nthFromEnd));
}

function matches(d, r, a) {
	switch (r.freq) {
		case 'DAILY': return Math.round((d - a) / 86400000) % r.interval === 0;
		case 'WEEKLY': {
			const weeks = Math.round((mondayOf(d) - mondayOf(a)) / (7 * 86400000));
			if (weeks % r.interval !== 0) return false;
			const days = r.byday.length ? r.byday.map((b) => b.day) : [weekday(a)];
			return days.includes(weekday(d));
		}
		case 'MONTHLY': {
			const months = (d.getUTCFullYear() - a.getUTCFullYear()) * 12 + d.getUTCMonth() - a.getUTCMonth();
			if (months % r.interval !== 0) return false;
			if (r.byday.length) return matchesByDayInMonth(d, r.byday);
			const dom = r.bymonthday.length ? r.bymonthday : [a.getUTCDate()];
			return dom.includes(d.getUTCDate());
		}
		case 'YEARLY': {
			if ((d.getUTCFullYear() - a.getUTCFullYear()) % r.interval !== 0) return false;
			const months = r.bymonth.length ? r.bymonth : [a.getUTCMonth() + 1];
			if (!months.includes(d.getUTCMonth() + 1)) return false;
			if (r.byday.length) return matchesByDayInMonth(d, r.byday);
			const dom = r.bymonthday.length ? r.bymonthday : [a.getUTCDate()];
			return dom.includes(d.getUTCDate());
		}
	}
	return false;
}

// First occurrence on or after `today`. Walks day by day from the anchor (so COUNT can be honoured)
// with a hard horizon, and returns null when the series has ended or the rule is not trackable.
export function nextDue(rrule, anchor, today) {
	const r = typeof rrule === 'string' ? parse(rrule) : rrule;
	if (r.freq === 'DAILY') return null; // by design — see the descriptor
	if (!anchor) return null;
	const a = toDate(anchor), t = toDate(today);
	const until = r.until ? toDate(r.until) : null;
	const horizon = addDays(t, 366 * Math.max(3, r.interval * 2));
	let seen = 0;
	for (let d = a; d <= horizon; d = addDays(d, 1)) {
		if (until && d > until) return null;
		if (!matches(d, r, a)) continue;
		seen++;
		if (r.count !== undefined && seen > r.count) return null;
		if (d >= t) return iso(d);
	}
	return null;
}

export function render(rrule, anchor, today) {
	return { text: toEnglish(rrule, anchor), next_due: nextDue(rrule, anchor, today) };
}

// ---- CLI -------------------------------------------------------------------------------------
const flag = (argv, name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : argv[i + 1]; };
const todayIso = () => new Date().toISOString().slice(0, 10);

/** The workspace: the nearest folder above `from` holding a package-lock.json, skipping a folder
 *  directly inside `git_modules/`, which is a cloned module and never the workspace. */
function workspaceRoot(from) {
	for (let d = from; ; d = path.dirname(d)) {
		if (fs.existsSync(path.join(d, 'package-lock.json')) && path.basename(path.dirname(d)) !== 'git_modules') return d;
		if (path.dirname(d) === d) throw new Error('no workspace found (no package-lock.json above ' + from + ')');
	}
}

/** Where this workspace keeps routines: the storage path compile resolved, which the compiled
 *  descriptor carries at `compiled.defaults.storage.path` (the authored `storage.path` when the
 *  author wrote one), else the module default. Read by indentation, since this module declares no
 *  YAML dependency and the engine dumps block maps. */
function routinesDir(root) {
	const compiled = path.join(root, '.dreamteamer', 'collections', 'routines.collection.yaml');
	const at = { resolved: null, authored: null };
	if (fs.existsSync(compiled)) {
		const trail = [];
		for (const raw of fs.readFileSync(compiled, 'utf8').split('\n')) {
			const m = /^( *)([a-z_]+):\s*(.*)$/.exec(raw);
			if (!m) continue;
			const depth = m[1].length / 2;
			trail.length = depth;
			trail[depth] = m[2];
			const key = trail.join('.');
			const value = m[3].replace(/^['"]|['"]$/g, '');
			if (key === 'compiled.defaults.storage.path') at.resolved = value;
			if (key === 'storage.path') at.authored = value;
		}
	}
	return path.join(root, at.resolved || at.authored || 'data/routines');
}

// Minimal frontmatter read — enough for the four scalar fields `roll` inspects. Writes go through dt.
function readRecord(file) {
	const src = fs.readFileSync(file, 'utf8');
	const m = /^---\n([\s\S]*?)\n---/.exec(src);
	const fm = {};
	if (m) for (const line of m[1].split('\n')) {
		const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
		if (kv) fm[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
	}
	return fm;
}

function roll(argv) {
	const dir = flag(argv, 'dir') ?? routinesDir(workspaceRoot(process.cwd()));
	const root = flag(argv, 'dir') ? process.cwd() : workspaceRoot(process.cwd());
	const today = flag(argv, 'today') ?? todayIso();
	const apply = argv.includes('--apply');
	const out = [];
	if (!fs.existsSync(dir)) return out;
	for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.routine.md')).sort()) {
		const id = f.replace(/\.routine\.md$/, '');
		const rec = readRecord(path.join(dir, f));
		if ((rec.status ?? 'active') !== 'active') continue;
		let want;
		try { want = render(rec.recurrence, rec.anchor || undefined, today); }
		catch (e) { out.push({ id, error: e.message }); continue; }
		const changes = {};
		if ((rec.next_due ?? '') !== (want.next_due ?? '')) changes.next_due = want.next_due ?? '';
		if (!Object.keys(changes).length) continue;
		const row = { id, changes, text: want.text };
		if (want.next_due === null && !rec.anchor && !want.text.startsWith('Daily')) row.note = 'no anchor — next_due cannot be derived';
		if (apply) {
			const args = ['--no-install', 'dt', 'set', `routines/${id}`];
			for (const [k, v] of Object.entries(changes)) args.push(`--${k}`, v);
			execFileSync('npx', args, { cwd: root, stdio: 'inherit' });
			row.applied = true;
		}
		out.push(row);
	}
	return out;
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const isMain = process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url));
if (isMain) {
	const [cmd, ...rest] = process.argv.slice(2);
	try {
		if (cmd === 'render') {
			const rule = rest.find((x) => !x.startsWith('--') && rest[rest.indexOf(x) - 1]?.startsWith('--') !== true);
			console.log(JSON.stringify(render(rule, flag(rest, 'anchor'), flag(rest, 'today') ?? todayIso())));
		} else if (cmd === 'roll') {
			console.log(JSON.stringify(roll(rest), null, 2));
		} else {
			console.error('usage: rrule.mjs render <RRULE> [--anchor D] [--today D] | roll [--today D] [--dir P] [--apply]');
			process.exit(2);
		}
	} catch (e) { console.error(`✖ ${e.message}`); process.exit(1); }
}
