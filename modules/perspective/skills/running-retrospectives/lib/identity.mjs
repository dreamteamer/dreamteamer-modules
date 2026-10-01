// identity — WHICH OF THESE ROWS ARE THE CONTRIBUTOR'S. One question, asked by every reader, and
// until 2026-09-09 answered by four near-copies of the same fifteen lines in four scripts.
//
// The contributor is a SLUG (`dana-o`) because that is what the ids are keyed by. The evidence
// carries none of that: git has an author email, Asana a gid, mail an address. Deciding whether a
// commit is theirs is therefore a HANDLE MATCH, never a slug comparison — and three of those four
// copies were quietly comparing the slug to a list of email addresses after the re-keying, which
// matches nothing and filters nothing.
//
// ⚠ The seed is the RUN RECORD's `handles`, not the collaborator record's, because the first reader
// runs before any collaborator record exists. Once one does, its handles are the merge read-git
// already did, and they are unioned in. `references/identity.md` is the method; this is the code.
import path from 'node:path';
import { DATA } from './vault.mjs';
import { recordPath, readRecord, listRecords, contributorOf } from './records.mjs';

const lower = (s) => String(s ?? '').trim().toLowerCase();
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/**
 * Every address, gid and name variant the retrospective's contributor appears under, lowercased.
 *
 * Returns `null` when the run declares no handles at all — which is NOT the same as an empty set.
 * A caller filtering evidence must then filter NOTHING: on a solo workspace an unfiltered timeline
 * is honest, while an empty one reads as a bug in the reader. Every call site depended on that
 * distinction already; making it the documented contract of one function is the point of the move.
 */
export function contributorHandles(retrospectiveRef, dataRoot = DATA) {
	const base = String(retrospectiveRef).split('/').pop();
	let seeds;
	try {
		const { fields } = readRecord(recordPath('retrospective-sessions', base, 'retrospective-session', dataRoot));
		seeds = list(fields.handles).map(lower).filter(Boolean);
	} catch { return null; }
	if (!seeds.length) return null;

	const all = new Set(seeds);
	let slug;
	try { slug = contributorOf(retrospectiveRef, dataRoot); } catch { return all; }
	for (const f of listRecords(path.join(dataRoot, 'perspective', 'world', 'users', slug))) {
		const handles = list(readRecord(f).fields.handles).map(lower).filter(Boolean);
		if (handles.some((h) => all.has(h))) for (const h of handles) all.add(h);
	}
	return all;
}

/** True when a row's author email or display name is one of the contributor's handles. */
export function isContributor(handles, email, name) {
	if (!handles) return true;   // nothing declared → filter nothing, never filter everything
	return handles.has(lower(email)) || handles.has(lower(name));
}
