// Which records point at which entries. A pointer is an exact string: the typed reference
// `files/<id>`, or `${env:NAME}/<relative path>` as records of other modules already write it. Prose
// that mentions a path is not a pointer.

/** The strings that mean one entry. For a drive on one line of a list variable the string form is
 *  ambiguous across the lines, so only the typed reference counts. */
export function pointersOf(drive, driveId, relpath) {
	const out = [`files/${driveId}/${relpath}`];
	const indexed = drive.index !== undefined && drive.index !== null && drive.index !== '';
	const base = String(drive.path ?? '').trim().replace(/\/+$/, '');
	if (!indexed && base) out.push(`${base}/${relpath}`, `${base}/${relpath}/`);
	return out;
}

/** Map<entryId, sorted refs> over `records` ({ collection, id, fields }) for `entries` (Map<id, { pointers }>). */
export function referencedBy(records, entries) {
	const byPointer = new Map();
	for (const [id, { pointers }] of entries) for (const p of pointers) byPointer.set(p, id);
	const hits = new Map([...entries.keys()].map((id) => [id, new Set()]));
	const scan = (v, ref) => {
		if (typeof v === 'string') { const id = byPointer.get(v); if (id) hits.get(id).add(ref); }
		else if (Array.isArray(v)) for (const x of v) scan(x, ref);
		else if (v && typeof v === 'object') for (const x of Object.values(v)) scan(x, ref);
	};
	for (const r of records) scan(r.fields, `${r.collection}/${r.id}`);
	return new Map([...hits].map(([id, s]) => [id, [...s].sort()]));
}
