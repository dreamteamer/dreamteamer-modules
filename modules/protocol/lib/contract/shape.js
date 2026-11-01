// Shape assertions: the contract pins KEYS and TYPES (and values only where the fixture fixes them),
// never a host's incidental extras.
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Throw unless `value` has every key of `spec` with one of the `|`-separated types named. */
export function shape(value, spec, where = 'body') {
	if (typeOf(value) !== 'object') throw new Error(`${where} is ${typeOf(value)}, expected an object`);
	for (const [key, types] of Object.entries(spec)) {
		const allowed = types.split('|');
		const t = key in value ? typeOf(value[key]) : 'missing';
		if (!allowed.includes(t)) throw new Error(`${where}.${key} is ${t}, expected ${types}`);
	}
	return value;
}

/** Throw unless `cond`, with `message`. */
export function check(cond, message) {
	if (!cond) throw new Error(message);
}

/** Throw unless the response status is `status`; the message carries the body's error. */
export function status(res, expected) {
	if (res.status !== expected) {
		const said = res.body && typeof res.body === 'object' && 'error' in res.body ? ` — ${String(res.body.error).slice(0, 200)}` : '';
		throw new Error(`status ${res.status}, expected ${expected}${said}`);
	}
}
