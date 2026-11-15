// RELEASES — the one rule about them a descriptor cannot say: a release's id IS its product, package and
// version, so no two records hold one release.
//
// The id is rendered from those fields at `dt add` (`ids.from` in collections/rnd/releases.collection.yaml),
// and `add` refuses a second record of one id. What `add` cannot see is a record whose id has stopped
// naming its own fields — a hand-written copy under another id, or `dt set … version=` on a record, which
// writes the field and leaves the id where it was — and then a second release of one version is possible.
// `unique` in the engine is per scalar field, and the pair is two, so the rule is this module's to check:
// `dt check` runs it through the extension (lib/extension.mjs).
import path from 'node:path';

export const COLLECTION = 'rnd/releases';

const last = (ref) => String(ref ?? '').split('/').pop();

/** The id a release's own fields render to — the same two templates the descriptor declares, first whose
 *  fields are all present. Null when product or version is missing (the schema reports that). */
export function expectedId(fields) {
	if (!fields?.product || !fields?.version) return null;
	return [last(fields.product), fields.package, fields.version].filter(Boolean).join('/');
}

/** Every violation among release rows `{ id, file, fields }`: an id that does not name its own product,
 *  package and version, and a second release of one — both claimants named. */
export function releaseViolations(rows) {
	const out = [];
	const byKey = new Map();
	for (const { id, file, fields } of rows) {
		const want = expectedId(fields);
		if (!want) continue;
		if (want !== id) out.push({ file, message: `${COLLECTION}/${id} names ${want} in its fields — a release's id is its product${fields.package ? ', package' : ''} and version. Rename it (dt rename ${COLLECTION}/${id} ${want}) or put the fields back` });
		const claimants = byKey.get(want) ?? [];
		claimants.push({ id, file });
		byKey.set(want, claimants);
	}
	for (const [key, claimants] of byKey) {
		if (claimants.length < 2) continue;
		const ids = claimants.map((c) => `${COLLECTION}/${c.id}`).join(' and ');
		for (const c of claimants) out.push({ file: c.file, message: `a second release of ${key}: ${ids} both claim it — one release per product${key.split('/').length > 2 ? ', package' : ''} and version` });
	}
	return out;
}

/** The extension's `check`: reads every release through the running engine's Store. */
export function checkReleases({ ws, dt }) {
	const store = new dt.Store(ws);
	if (!store.descriptors.has(COLLECTION)) return [];
	const rows = [...store.readAll(COLLECTION)];
	return releaseViolations(rows).map((v) => ({ ...v, file: path.relative(ws.root, v.file) }));
}
