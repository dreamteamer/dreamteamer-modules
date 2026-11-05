// A GUARD, not a unit test — it reads this repo's own source.
//
// ⚠ 2026-08-18: this guard PASSED while every namespaced collection was broken in the running
// extension, because it only knew two route prefixes — `/collections/` and `/schema/collections/`.
// The live offenders were `/items/`, `/revisions/`, `/history-diff/` and `/records-revert/`, none of
// which it looked at. **A guard that enumerates the routes that were broken last time only ever
// catches last time's bug.** It now checks EVERY api path interpolation regardless of route, which is
// the property that actually matters: a slashed name in any unencoded segment silently becomes extra
// path segments, and `seg[1]` / `rest[0]` take only the first.
//
// A collection name can contain a slash (`health/doctors`), and `:name` is ONE path segment on both
// routers: the engine's Express one and this repo's `seg[]` splitter. So every URL a caller builds has
// to percent-encode the name, or the slash silently becomes extra path segments and the route stops
// matching. `webview/src/api/adapter.ts` already did this; `src/extension.ts` did not, in six places.
//
// Documentation does not survive the next caller. This does: it fails on a `/collections/${...}` or
// `/fields/${...}` interpolation that is not wrapped in `encodeURIComponent`. The engine
// side has its own version of the same contract written into a comment above the routes; the difference
// is that this one is executable.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ⚠ `process.cwd()`, NOT `import.meta.dirname`. scripts/test.mjs bundles these files into
// `.test-build/`, so a path relative to the module resolves next to the BUNDLE and scans nothing —
// which the "there are source files to check" assertion below caught on the first run. The runner
// spawns node with cwd set to the repo root, so cwd is the reliable anchor for a guard that reads source.
const ROOT = process.cwd();

/** Every .ts/.vue file under a directory, recursively. */
function sources(dir: string): string[] {
	const out: string[] = [];
	if (!fs.existsSync(dir)) return out;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name.startsWith('.') || e.name === 'node_modules') continue;
		const p = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...sources(p));
		else if (/\.(ts|vue)$/.test(e.name)) out.push(p);
	}
	return out;
}

// The path is the first argument to `api.<verb>(...)`, `cleanFetch(method, ...)` or
// `call(method, ...)`, so a template literal starting with `/` is the thing to check.
const API_CALL = /(?:api\.(?:get|post|patch|delete|put)\s*(?:<[^>]*>)?\s*\(|cleanFetch\(\s*[^,]+,\s*|call\(\s*[^,]+,\s*)`(\/[^`]*)`/g;

// ⚠ ONLY THE COLLECTION POSITION, which is the FIRST interpolation in the path — everything before it
// being literal route segments. The rest must NOT be caught: a record `id` legitimately contains
// slashes that ARE path separators (`meetings/2026/07/standup`), and a `${query}` is a query string.
// A blanket "encode every interpolation" rule fires on both and gets switched off, which is worse
// than no rule.
const COLLECTION_POS = /^(?:\/[A-Za-z0-9._-]+)+\/\$\{([^}]*)\}/;

/** An interpolation is safe when the encode call is VISIBLE at the call site. */
const ENCODED = /encodeURIComponent\s*\(|encodeIdPath\s*\(/;

describe('every collection name in an api path is percent-encoded', () => {
	const files = [...sources(path.join(ROOT, 'src')), ...sources(path.join(ROOT, 'node_modules', '@dreamteamer', 'ui', 'src'))];

	test('there are source files to check (the guard itself must not silently pass)', () => {
		assert.ok(files.length > 20, `expected to scan the repo, found ${files.length} files`);
	});

	test('no api path leaves the collection segment unencoded, on ANY route', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const text = fs.readFileSync(file, 'utf8');
			for (const call of text.matchAll(API_CALL)) {
				const pathLiteral = call[1]!;
				const m = COLLECTION_POS.exec(pathLiteral);
				if (!m || ENCODED.test(m[1]!)) continue;
				const line = text.slice(0, call.index).split('\n').length;
				offenders.push(`${path.relative(ROOT, file)}:${line}  ${pathLiteral}`);
			}
		}
		assert.deepEqual(
			offenders, [],
			`unencoded COLLECTION segment in an api path — a slashed name becomes extra path segments\n`
			+ `and the router takes only the first (seg[1] / rest[0]). Wrap with encodeURIComponent():\n  `
			+ offenders.join('\n  '),
		);
	});

	// The original prefix check, kept because it is cheap and it documents the shape. Two changes with
	// the grammar flip:
	//
	//  - `/schema/collections/` is GONE as a route prefix and `/fields/` has arrived, so the list
	//    follows. ⚠ A prefix-list pin that loses a prefix passes VACUOUSLY, which is why the general
	//    check above exists and why this one is no longer the only guard.
	//  - it now only looks INSIDE an api call. It used to scan raw text, and the Schema tab's own
	//    router pushes (`/settings/schema/collections/${tail}`) matched `collections/${…}` — a ROUTE,
	//    which is a client-side path with no router segment to break and no business being encoded.
	//    A guard that fires on a correct line is a guard somebody switches off.
	test('no unencoded interpolation follows /collections/ or /fields/ in an api path', () => {
		const offenders: string[] = [];
		for (const file of files) {
			const text = fs.readFileSync(file, 'utf8');
			for (const call of text.matchAll(API_CALL)) {
				for (const m of (call[1] ?? '').matchAll(/\/(?:collections|fields)\/\$\{([^}]*)\}/g)) {
					if (ENCODED.test(m[1]!)) continue;
					const line = text.slice(0, call.index).split('\n').length;
					offenders.push(`${path.relative(ROOT, file)}:${line}  \${${m[1]}}`);
				}
			}
		}
		assert.deepEqual(offenders, [], `unencoded collection name(s):\n  ${offenders.join('\n  ')}`);
	});

	// Proof the pattern actually bites — otherwise a regex typo makes this file a permanent green tick.
	test('the guard detects an offender, and accepts the legitimate cases', () => {
		const bad = "const res = await api.get<Row[]>(`/items/${collection}/${encodeURIComponent(id)}`);";
		const hit = [...bad.matchAll(API_CALL)].map((c) => COLLECTION_POS.exec(c[1]!))
			.filter((m) => m && !ENCODED.test(m[1]!));
		assert.equal(hit.length, 1, 'an unencoded collection on a non-/collections/ route must be caught');

		const good = "const res = await api.get<Row[]>(`/items/${encodeURIComponent(collection)}/${id}`);";
		assert.equal([...good.matchAll(API_CALL)].map((c) => COLLECTION_POS.exec(c[1]!))
			.filter((m) => m && !ENCODED.test(m[1]!)).length, 0, 'the encoded form is accepted');

		// ⚠ and a raw record id must NOT be flagged — it is a path, not a segment.
		const id = "await api.get(`/collections/${encodeURIComponent(c)}/records/${rawId}`);";
		assert.equal([...id.matchAll(API_CALL)].map((c) => COLLECTION_POS.exec(c[1]!))
			.filter((m) => m && !ENCODED.test(m[1]!)).length, 0, 'a raw id after an encoded collection is fine');
	});
});
