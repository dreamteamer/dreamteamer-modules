// A stage is idempotent when running it twice leaves the record tree byte-identical, apart from
// fields that are ALLOWED to move. Hashing the tree rather than diffing records is what makes the
// assertion cheap enough to run once per stage.
//
// ⚠ THE ALLOWLIST IS THE WHOLE DESIGN. Anything on it is a field a re-run may legitimately rewrite;
// anything not on it moving is a defect. Two shipped defects would have been caught here: a reader
// that dropped a week's judged summary on every re-read because it looked for it at the pre-rename
// path, and an attach pass whose own receipt claimed a write it had not made.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Lines a re-run may legitimately change. Keep this SHORT and justify every entry. */
export const ALLOW = [
	/^last_seen_in:/,          // the point of the field: the most recent session that confirmed the record
	/^inspected_at:/,          // when a conversation was last read
	/^\s*- \*\*[a-z]+\*\* \d{4}-\d{2}-\d{2}T/,   // a stage's own run-log line in the session body
];

export function treeHash(dir, { allow = ALLOW } = {}) {
	const files = [];
	(function walk(d) {
		if (!fs.existsSync(d)) return;
		for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const p = path.join(d, e.name);
			e.isDirectory() ? walk(p) : files.push(p);
		}
	})(dir);
	const h = crypto.createHash('sha256');
	for (const f of files) {
		h.update(path.relative(dir, f));
		const body = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !allow.some((re) => re.test(l))).join('\n');
		h.update(body);
	}
	return h.digest('hex');
}

/** The files that actually differ, for a failure message worth reading. */
export function treeDiff(before, after) {
	const list = (root) => {
		const out = new Map();
		(function walk(d) {
			if (!fs.existsSync(d)) return;
			for (const e of fs.readdirSync(d, { withFileTypes: true })) {
				const p = path.join(d, e.name);
				if (e.isDirectory()) walk(p);
				else out.set(path.relative(root, p), fs.readFileSync(p, 'utf8').split('\n').filter((l) => !ALLOW.some((re) => re.test(l))).join('\n'));
			}
		})(root);
		return out;
	};
	const a = list(before), b = list(after), changed = [];
	for (const [k, v] of b) if (!a.has(k)) changed.push(`+ ${k}`); else if (a.get(k) !== v) changed.push(`~ ${k}`);
	for (const k of a.keys()) if (!b.has(k)) changed.push(`- ${k}`);
	return changed;
}
