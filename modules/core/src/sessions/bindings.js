// session-bindings — which records a session works on, the record state that opens one, who works it,
// and the state that ends it. A source kind of core's extension, compiled like command-bindings: a
// module writes `session-bindings/<id>.session-binding.yaml`, compile stages it into
// `.dreamteamer/session-bindings/`, and the `session-bindings` collection core ships reads it there.
//
// Every key is a value something here INTERPRETS (the claim, the gate, the dispatch), so by the
// engine's rule — validate a value iff you interpret it — compile refuses a bad one, naming the binding.

export const KEYS = ['collection', 'available_when', 'done_when', 'harness', 'agent', 'command', 'concurrency', 'stale_after', 'description'];
export const CONCURRENCY = ['one', 'many'];
/** Minutes without a heartbeat before a running session is abandoned, when its binding names none. */
export const DEFAULT_STALE_AFTER = 30;
const BUILTIN_FIELDS = ['id', 'created', 'last_modified'];
const PREFIX = 'session-bindings/';

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const strip = (ref, kind) => String(ref ?? '').replace(new RegExp(`^${kind}/`), '');
/** A runtime entry path → the binding's id: `session-bindings/a/b.session-binding.yaml` → `a/b`. */
export const bindingId = (rt) => rt.slice(PREFIX.length).replace(/\.session-binding\.ya?ml$/, '').replace(/\.ya?ml$/, '');

/** The field names a filter conditions on at its top level, through `_and` / `_or` (one hop deeper is the
 *  referenced collection's business — the same rule command-bindings follow). */
function filterFields(filter) {
	const out = [];
	for (const [k, v] of Object.entries(filter ?? {})) {
		if (k === '_and' || k === '_or') { for (const c of Array.isArray(v) ? v : []) out.push(...filterFields(c)); continue; }
		if (!k.startsWith('_')) out.push(k.split('.')[0]);
	}
	return out;
}

/** Every problem with one parsed binding, as messages without the path. `ctx`: { descriptors, agents,
 *  commands, unknownOperators, fieldsOf }. */
export function bindingProblems(b, ctx) {
	if (!isMap(b)) return ['a session-binding is a mapping'];
	const errors = [];
	for (const k of Object.keys(b)) if (!KEYS.includes(k)) errors.push(`unknown key \`${k}\` — a session-binding's keys are ${KEYS.join(' · ')}`);
	const coll = strip(b.collection, 'collections');
	const d = coll ? ctx.descriptors.get(coll) : null;
	if (!coll) errors.push('`collection` is required — the collection whose records a session works on');
	else if (!d) errors.push(`references unknown collection "${b.collection}"`);
	if (b.agent !== undefined && !ctx.agents.has(strip(b.agent, 'agents'))) errors.push(`references unknown agent "${b.agent}"`);
	if (b.command !== undefined && !ctx.commands.has(strip(b.command, 'commands'))) errors.push(`references unknown command "${b.command}"`);
	if (b.concurrency !== undefined && !CONCURRENCY.includes(b.concurrency)) errors.push(`\`concurrency\` is ${CONCURRENCY.join(' · ')} (got ${JSON.stringify(b.concurrency)})`);
	if (b.stale_after !== undefined && !(typeof b.stale_after === 'number' && b.stale_after > 0)) errors.push(`\`stale_after\` is a positive number of minutes (got ${JSON.stringify(b.stale_after)})`);
	if (b.harness !== undefined && typeof b.harness !== 'string') errors.push('`harness` is a string — the harness a session runs in, e.g. claude-code');
	for (const key of ['available_when', 'done_when']) {
		if (b[key] === undefined) continue;
		if (!isMap(b[key])) { errors.push(`\`${key}\` is a mapping of field → condition`); continue; }
		const bad = [...ctx.unknownOperators(b[key])];
		if (bad.length) errors.push(`${key} has unknown filter operator(s) ${bad.join(', ')}`);
		if (d) {
			const fields = ctx.fieldsOf(d);
			for (const f of filterFields(b[key])) if (!BUILTIN_FIELDS.includes(f) && !(f in fields)) errors.push(`${key} names "${f}", which is not a field of ${coll}`);
		}
	}
	return errors;
}

/** The compile-time half — the extension's `analyze(draft)`. */
export function analyzeBindings(draft, dt) {
	const keys = [...draft.entries.keys()];
	const named = (kind, suffix) => new Set(keys.filter((k) => k.startsWith(`${kind}/`) && k.endsWith(suffix)).map((k) => k.slice(kind.length + 1, -suffix.length)));
	const ctx = { descriptors: draft.descriptors, agents: named('agents', '.agent.md'), commands: named('commands', '.command.md'), unknownOperators: dt.unknownOperators, fieldsOf: dt.fieldsOf };
	const errors = [];
	let n = 0;
	for (const rt of keys.filter((k) => k.startsWith(PREFIX))) {
		n++;
		let b;
		try { b = draft.parse(rt); } catch (e) { errors.push(`${rt}: ${String(e.message).split('\n')[0]}`); continue; }
		for (const m of bindingProblems(b, ctx)) errors.push(`${rt}: ${m}`);
	}
	return { errors, notes: n ? [`session-bindings: ${n} compiled`] : [] };
}

/** One gate as words: `status=accepted · verified_on set`. */
export function renderGate(label, filter) {
	if (!isMap(filter)) return null;
	const parts = [];
	for (const [k, v] of Object.entries(filter)) {
		if (k === '_and' || k === '_or') { parts.push((Array.isArray(v) ? v : []).map((c) => renderGate('', c)).join(k === '_or' ? ' or ' : ', ')); continue; }
		if (!isMap(v)) { parts.push(`${k}=${v}`); continue; }
		for (const [op, o] of Object.entries(v)) {
			if (op === '_nnull' || op === '_nempty') parts.push(o ? `${k} set` : `${k} empty`);
			else if (op === '_null' || op === '_empty') parts.push(o ? `${k} empty` : `${k} set`);
			else if (op === '_in') parts.push(`${k} in ${[].concat(o).join('|')}`);
			else if (op === '_eq') parts.push(`${k}=${o}`);
			else parts.push(`${k} ${op.slice(1)} ${[].concat(o).join('|')}`);
		}
	}
	const text = parts.filter(Boolean).join(', ');
	return label ? `${label}: ${text}` : text;
}

/** The orientation paragraph — the bindings compile staged, with their gates, and the rule. Empty when
 *  no module ships a binding: a workspace without live sessions reads not one extra line. */
export function orientation(entries, dt) {
	const rows = [];
	for (const [rt, e] of entries) {
		if (!rt.startsWith(PREFIX)) continue;
		let b = {};
		try { b = dt.loadYaml(e.bytes.toString('utf8')) ?? {}; } catch { continue; }
		const coll = strip(b.collection, 'collections');
		if (!coll) continue;
		const cmd = b.command ? `/${strip(b.command, 'commands').replace(/\//g, ':')}` : null;
		const gate = [renderGate('available when', b.available_when), renderGate('done when', b.done_when)].filter(Boolean).join(' · ');
		const who = [b.agent, b.harness && `on ${b.harness}`, cmd].filter(Boolean).join(' ');
		rows.push(`- ${coll} — ${who || 'any agent'}${gate ? ` (${gate})` : ''} · ${b.concurrency === 'many' ? 'several at once' : 'one at a time'}`);
	}
	if (!rows.length) return '';
	return [
		'',
		'SESSIONS BOUND TO COLLECTIONS — before working a record, run `dt next <ref>`: it says "in session by',
		'<agent> since <time>" when another session holds it. claim it with `dt session start <ref>` (`--join` to',
		'work beside a holder), end with `dt session end <session>`; `dt sessions open` lists what is ready and free:',
		...rows.sort(),
	].join('\n');
}
