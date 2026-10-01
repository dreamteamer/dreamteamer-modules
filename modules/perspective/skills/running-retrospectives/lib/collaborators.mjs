// collaborators — the ONE upsert every reader that meets people goes through. Lifted from read-asana
// on 2026-09-08 when the gmail reader needed the same thing, so there is exactly one place that knows
// the merge rule.
//
// ⚠ THE MERGE KEY is an email or a system id, never a display name — two people share a first name,
// nobody shares an address. Matching on a name is how one person's work gets attributed to another,
// the worst error this module can make. And two RECORDS are never merged here: only handles are added
// to the record that already carries one of this person's keys. A person decides a merge.
import fs from 'node:fs';
import path from 'node:path';
import { listRecords, readRecord, writeRecord, recordPath, collectionDir } from './records.mjs';
import { slug } from './vault.mjs';

const lower = (s) => String(s ?? '').toLowerCase();
const earliest = (...ds) => ds.filter(Boolean).sort()[0];
const latest = (...ds) => ds.filter(Boolean).sort().at(-1);

/**
 * people: [{ email?, id?, name?, contact?, count, days: ['YYYY-MM-DD', …] }]
 * Returns { added, matched }. Never overwrites a body, never lowers an evidence_count.
 *
 * ⚠ `contact` — a `contacts` ref — is accepted but never DERIVED here. A reader may only supply one
 * when the evidence itself carries a structural edge to the CRM record (`meetings.attendees` is an
 * `x-reference: contacts`, so following it is not a guess about a string). It is written only where
 * the record has none: a value a person confirmed outranks anything a reader found, and this upsert
 * ADDS what the evidence proves rather than replacing what it merely failed to re-derive.
 */
export function upsertCollaborators({ dataRoot, contributorSlug, retrospective, sourceRef, people, role, author, context, dryRun = false }) {
	const existing = listRecords(path.join(collectionDir('users', dataRoot), contributorSlug))
		.map((file) => ({ file, ...readRecord(file) }));
	let added = 0, matched = 0;
	for (const p of people) {
		const keys = [p.email, p.id].filter(Boolean).map(lower);
		if (!keys.length) continue;                              // a bare display name is not a person we can key
		const hit = existing.find((r) => (r.fields.handles ?? []).some((h) => keys.includes(lower(h))));
		// ⚠ A DISPLAY NAME IS A HANDLE ONLY WHEN IT COLLIDES WITH NOBODY. Measured on the first mailbox
		// run: a mail counterpart's display name matched the name-handle a git-derived record already
		// carried (same person, different key — a github noreply address on one side, an email on the
		// other). Writing the name onto the new record would have been a silent MERGE BY NAME, which is
		// the one thing this file exists to refuse; leaving it off keeps both records honest and the
		// question ("same person?") visible in the body for a person to settle.
		const nameTaken = p.name && existing.some((r) => r !== hit && (r.fields.handles ?? []).some((h) => lower(h) === lower(p.name)));
		const handles = [...new Map([p.email, p.id, nameTaken ? null : p.name].filter(Boolean).map((h) => [lower(h), String(h)])).values()];
		const first = earliest(...(p.days ?? [])), last = latest(...(p.days ?? []));
		const name = p.name || p.email || p.id;
		if (hit) {
			matched++;
			const merged = [...(hit.fields.handles ?? [])];
			for (const h of handles) if (!merged.some((x) => lower(x) === lower(h))) merged.push(h);
			const next = {
				...hit.fields,
				// ⚠ HEAL WHAT THE RECORD PREDATES. `contributor` and `retrospective` became REQUIRED on
				// every collection in 0.2.0; a collaborator written before that stays invalid for ever
				// otherwise, because this path only ever ADDS what it derived and a spread carries the
				// gap forward. Twelve records on one real workspace were stuck exactly there, and no
				// amount of re-reading could move them (2026-09-10). An upsert that cannot repair its
				// own record is not an upsert.
				retrospective: hit.fields.retrospective ?? retrospective,
				contributor: hit.fields.contributor ?? contributorSlug,
				// Filled only where the record has none — see the note on `contact` above.
				contact: hit.fields.contact ?? p.contact,
				handles: merged,
				first_seen: earliest(hit.fields.first_seen, first),
				last_seen: latest(hit.fields.last_seen, last),
				// MAX, never overwrite: a mail count of 3 must not erase a commit count of 900.
				evidence_count: Math.max(Number(hit.fields.evidence_count ?? 0), Number(p.count ?? 0)),
				roles_observed: [...new Set([...(hit.fields.roles_observed ?? []), role])],
				sources: [...new Set([...(hit.fields.sources ?? []), sourceRef])],
			};
			hit.fields = next;
			if (!dryRun) writeRecord(hit.file, next, hit.body);
		} else {
			added++;
			// ⚠ The id is the NAME's slug only when no record already sits there. Two people sharing a
			// name, or one person under a second key, would otherwise land on the same file — and the
			// second write would silently replace a record carrying nine hundred commits with one
			// carrying three mails. Found by the test below before it found a workspace.
			let file = recordPath('users', `${contributorSlug}/${slug(name)}`, 'user', dataRoot);
			if (nameTaken || fs.existsSync(file)) file = recordPath('users', `${contributorSlug}/${slug(p.email || p.id)}`, 'user', dataRoot);
			const fields = {
				retrospective, name, handles,
				contact: p.contact,
				first_seen: first, last_seen: last,
				evidence_count: Number(p.count ?? 0),
				roles_observed: [role],
				sources: [sourceRef],
				contributor: contributorSlug, author, creation_context: context, source: sourceRef,
			};
			const body = nameTaken
				? `⚠ Display name \`${p.name}\` is already a handle on another collaborator record. Same person under a second key, or two people sharing a name — a person decides; nothing was merged.\n`
				: '';
			existing.push({ file, fields, body });
			if (!dryRun) writeRecord(file, fields, body);
		}
	}
	return { added, matched };
}
