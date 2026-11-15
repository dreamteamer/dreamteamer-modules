// `dt check` rows: an entry's id must be `<drive id>/<path>`. Pure data, so it holds on a machine
// where no drive is mounted.
import path from 'node:path';

export function checkFiles({ root, ws, dt: api }) {
	const store = new api.Store({ root, pkg: ws.pkg });
	if (!store.descriptors.has('files')) return [];
	const out = [];
	for (const { id, fields, file } of store.readAll('files')) {
		const driveId = String(fields.drive ?? '').split('/').pop();
		const expected = `${driveId}/${fields.path}`;
		if (id !== expected) out.push({ file: path.isAbsolute(file) ? path.relative(root, file) : file, message: `files/${id}: the id disagrees with drive and path — expected "${expected}"` });
	}
	return out;
}
