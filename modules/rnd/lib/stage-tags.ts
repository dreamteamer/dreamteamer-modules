// The stage tags — `designed`, `implemented`, `tested`, `deployed` on rnd/change-requests.tags — and the
// one rule about them a descriptor cannot say: `deployed` and `deployed_on` agree. A request tagged
// `deployed` with no `deployed_on`, or one with `deployed_on` and no `deployed` tag, is a WARNING — never a
// violation: "the reverse" fires on every request deployed before the tags existed, and a rule that turned
// every workspace red the day it upgrades would be switched off rather than read.
//
// A warning needs the engine's warning channel (`dt.CHECK_WARNINGS`): an older engine counts every item a
// check returns as a violation, so on one the rule says nothing.
import path from 'node:path';

export const COLLECTION = 'rnd/change-requests';


/** The warnings for a list of requests `{ id, tags?, deployed_on?, file }` — pure, so every reading is a test. */
export function stageTagWarnings(rows) {
	const out = [];
	for (const r of rows) {
		const tagged = Array.isArray(r.tags) && r.tags.includes('deployed');
		const dated = r.deployed_on != null && r.deployed_on !== '';
		if (tagged && !dated) out.push({ file: r.file, message: `tagged deployed but deployed_on is empty — set deployed_on, or remove the tag`, warning: true });
		if (dated && !tagged) out.push({ file: r.file, message: `deployed_on is set but the record is not tagged deployed — add the tag, keeping its other tags`, warning: true });
	}
	return out;
}

/** The extension's `check`: every change request this workspace reads (its own and its layers'), its file
 *  named relative to the root. Nothing on an engine without the warning channel, or without the collection. */
export function checkStageTags({ ws, dt }) {
	if (dt?.CHECK_WARNINGS !== true) return [];
	const store = new dt.Store(ws);
	if (!store.descriptors?.has?.(COLLECTION)) return [];
	const rows = [];
	for (const { id, file, fields } of store.readAll(COLLECTION)) {
		rows.push({ id, tags: fields.tags, deployed_on: fields.deployed_on, file: path.relative(ws.root, file).split(path.sep).join('/') });
	}
	return stageTagWarnings(rows);
}
