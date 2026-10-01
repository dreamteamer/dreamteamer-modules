#!/usr/bin/env node
// read-drive — the mechanical pass over a Google Drive, for contributors whose work does not live in
// a ticket board. Writes one `sources` record per drive and one `deliverables` record per file the
// contributor actually touched, plus per-ISO-week `activity-weeks`. Counted, never judged.
//
//   node read-drive.mjs --retrospective perspective/retrospective-sessions/<id> --contributor <email>
//        [--as <google-account-email>] [--since YYYY-MM-DD] [--drive <id>] [--limit N]
//        [--data-root d] [--dry-run]
//
// WHY THIS EXISTS. Two people on one board can differ forty times over in tickets while doing
// comparable work, because one person's trail is in documents — and a module that can only read
// boards would profile that person as nearly idle and be confidently wrong.
// An evidence source that is absent for a person is a fact about the SOURCE, not about the person.
//
// WHAT IT CANNOT SEE, and says so rather than guessing:
//   · Drive records ONE `lastModifyingUser` per file. A document five people wrote shows the last of
//     them, so a file is evidence that the contributor touched it LAST, never that they authored it.
//     `revisions` would say more, but it is a request per file and most of this corpus is Docs whose
//     revision list is truncated by the API anyway.
//   · An `owners` query does not work on a shared drive at all — files are owned by the drive. This
//     is why the pass enumerates and filters client-side instead of asking Drive to filter.
//   · A file the contributor read and never edited leaves no trace here. Reading is invisible.
import { DATA, isoWeek, isoWeekRange } from '../lib/workspace.mjs';
import { recordPath, writeRecord, readRecord, contributorOf, writeSource } from '../lib/records.mjs';
import { accessTokenFor, googleAccounts, drive } from '../lib/google-auth.mjs';

const READER = 'read-drive@1';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const retrospective = opt('retrospective');
if (!retrospective.startsWith('perspective/retrospective-sessions/')) {
	console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required');
	process.exit(2);
}
const base = retrospective.split('/').pop();
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use, so a bad argument exits 2 with a usage line before any session is read.
let _who = null;
const who = () => (_who ??= contributorOf(retrospective, dataRoot));
const contributor = opt('contributor').toLowerCase();
if (!contributor) { console.error('usage: --contributor <email> is required — the person whose trail this is'); process.exit(2); }
const as = opt('as') || contributor;               // whose Drive session reads; often an admin, not the subject
const since = opt('since');
const limit = Number(opt('limit', '0')) || 0;
const onlyDrive = opt('drive');
// `--kinds doc,sheet,slides` keeps only those artefact kinds. A personal account can touch
// thousands of files a year, most of them a synced folder's recordings, statements and screenshots —
// real files, not deliverables. Default is everything; the receipt prints the
// histogram so the next run can decide what to keep.
const onlyKinds = opt('kinds') ? new Set(opt('kinds').split(',').map((k) => k.trim()).filter(Boolean)) : null;

/** A `sources` record for a reach the run could not achieve is still a record — that is the point. */
function unavailable(label, why) {
	if (!flag('dry-run')) {
		writeSource(recordPath('sources', `${who()}/drive--${label}`, 'source', dataRoot), {
			contributor: who(),
			retrospective,
			kind: 'drive',
			label,
			reach: 'unavailable',
			read_with: READER,
			author: `scripts/${READER}`,
		}, `${why}\n`);
	}
	process.stdout.write(`✖ drive ${label} unavailable — ${why}\n`);
}

const token = await accessTokenFor(as);
if (!token) {
	unavailable('no-credential', `No stored Google credential for ${as}. Accounts that do have one: ${googleAccounts().join(', ') || 'none'}. Authorise that account in the google-workspace tool and re-run — this reader mints a token from the grant that already exists and never asks for a new one.`);
	process.exit(0);                               // an absent capability is not a failed run
}

// ── which corpus ─────────────────────────────────────────────────────────────────────────────────
// `allDrives` BY DEFAULT. Enumerating the shared drives one at a time misses My Drive and everything
// shared with the reading account directly — which can be most of a contributor's specs. A reader
// that silently sees a sixth of someone's work does not report a small number, it reports a WRONG
// PERSON.
//
// `--drive <id>` scopes to one shared drive when that is what you want; it is the narrow case, not
// the default.
const drives = [];
if (onlyDrive) drives.push({ id: onlyDrive, name: onlyDrive });
else {
	// Named only so the receipt and the source body can say what was in reach; the scan itself is
	// one `allDrives` pass, because per-drive paging cannot see My Drive or shared-with-me at all.
	const list = await drive(token, 'drives', { pageSize: 100, fields: 'drives(id,name)' }).catch(() => ({ drives: [] }));
	for (const d of list.drives ?? []) drives.push({ id: d.id, name: d.name });
	drives.push({ id: null, name: `My Drive + shared with ${as}` });
}

// ── enumerate ────────────────────────────────────────────────────────────────────────────────────
// `q` filters on time only. The contributor filter is client-side BY CONSTRUCTION: a shared drive's
// files are owned by the drive, so `'<email>' in owners` matches nothing and would return an empty
// set that looks exactly like "this person did nothing".
const FIELDS = 'nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,size,webViewLink,parents,lastModifyingUser(emailAddress,displayName),driveId)';
const q = ['trashed = false'];
if (since) q.push(`modifiedTime > '${since}T00:00:00'`);

const driveName = new Map(drives.filter((d) => d.id).map((d) => [d.id, d.name]));
let seen = 0;
const mine = [];
let pageToken;
do {
	const page = await drive(token, 'files', {
		q: q.join(' and '),
		...(onlyDrive ? { corpora: 'drive', driveId: onlyDrive } : { corpora: 'allDrives' }),
		includeItemsFromAllDrives: true,
		supportsAllDrives: true,
		pageSize: 1000,
		orderBy: 'modifiedTime desc',
		fields: FIELDS,
		pageToken,
	});
	for (const f of page.files ?? []) {
		seen++;
		if ((f.lastModifyingUser?.emailAddress ?? '').toLowerCase() === contributor) {
			// A file with no driveId is in My Drive or was shared directly — both are real places a
			// contributor's work lives, and a per-shared-drive read cannot see either.
			// An UNRESOLVABLE driveId is not a bug and not a name to print raw. It means the file sits
			// in a shared drive the reading account is NOT a member of, and is visible only because it
			// was shared individually — often most of a contributor's files. The label says so, because a
			// raw drive id tells a reader nothing and quietly implies the drive was scanned when it was not.
			const container = !f.driveId
				? 'My Drive / shared directly'
				: (driveName.get(f.driveId) ?? `a shared drive ${as} is not a member of (files seen only because they were shared)`);
			mine.push({ ...f, driveName: container });
		}
	}
	pageToken = page.nextPageToken;
	if (limit && mine.length >= limit) break;
} while (pageToken);

const KIND = (mime) => {
	if (mime === 'application/vnd.google-apps.folder') return 'folder';
	if (mime === 'application/vnd.google-apps.document') return 'doc';
	if (mime === 'application/vnd.google-apps.spreadsheet') return 'sheet';
	if (mime === 'application/vnd.google-apps.presentation') return 'slides';
	if (mime === 'application/vnd.google-apps.form') return 'form';
	if (mime?.startsWith('video/')) return 'video';
	if (mime?.startsWith('image/')) return 'image';
	if (mime === 'application/pdf') return 'pdf';
	return 'other';
};
// The source ref, computed BEFORE the records that cite it — a deliverable carries it, and the
// source record itself is written further down once the counts are known.
const sourceId = `${who()}/drive--${slug(as)}`;
const sourceRef = `perspective/sources/${sourceId}`;
const kindOf = new Map(mine.map((f) => [f.id, KIND(f.mimeType)]));
const histogram = {};
for (const f of mine) histogram[kindOf.get(f.id)] = (histogram[kindOf.get(f.id)] ?? 0) + 1;
const kept = onlyKinds ? mine.filter((f) => onlyKinds.has(kindOf.get(f.id))) : mine;
const rows = limit ? kept.slice(0, limit) : kept;

// ── write ────────────────────────────────────────────────────────────────────────────────────────
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'untitled';

const weeks = new Map();
let written = 0;
for (const f of rows) {
	const day = (f.modifiedTime ?? '').slice(0, 10);
	const id = `${who()}/${day}--${slug(f.name)}`;
	if (!flag('dry-run')) {
		writeRecord(recordPath('deliverables', id, 'deliverable', dataRoot), {
		contributor: who(),
			retrospective,
			name: f.name,
			kind: KIND(f.mimeType),
			source_kind: 'drive',
			// The read that found it. NOT the person: on a proxy run this is the colleague's login,
			// and `last_touched_by` below is the one who actually edited the file.
			source: sourceRef,
			external_id: f.id,
			location: f.webViewLink,
			container: f.driveName,
			created_on: (f.createdTime ?? '').slice(0, 10) || undefined,
			last_touched_on: day || undefined,
			// TOUCHED, not authored. Drive keeps one lastModifyingUser; a document five people wrote
			// shows the last of them. The field name is the honest one.
			last_touched_by: f.lastModifyingUser?.emailAddress,
			bytes: f.size ? Number(f.size) : undefined,
			read_with: READER,
			author: `scripts/${READER}`,
		});
		written++;
	}
	if (day) {
		const w = isoWeek(new Date(`${day}T00:00:00Z`));
		const acc = weeks.get(w) ?? { files: 0, bytes: 0 };
		acc.files++;
		acc.bytes += f.size ? Number(f.size) : 0;
		weeks.set(w, acc);
	}
}

if (!flag('dry-run')) {
	writeSource(recordPath('sources', sourceId, 'source', dataRoot), {
		contributor: who(),
		retrospective,
		kind: 'drive',
		label: `drive as ${as}`,
		reach: rows.length ? 'available' : 'unavailable',
		counts: {
			drives: drives.length,
			scanned: seen,
			touched_by_contributor: mine.length,
			kept: rows.length,
			kinds: histogram,
			kinds_kept: onlyKinds ? [...onlyKinds].sort() : undefined,
			first: rows.length ? rows[rows.length - 1].modifiedTime?.slice(0, 10) : undefined,
			last: rows.length ? rows[0].modifiedTime?.slice(0, 10) : undefined,
		},
		read_with: READER,
		author: `scripts/${READER}`,
	}, [
		`Scanned ${seen} files across every drive reachable as \`${as}\`, keeping the ${rows.length} whose`,
		`\`lastModifyingUser\` is \`${contributor}\`.`,
		'',
		'⚠ Drive records ONE last modifier per file, so this is evidence the contributor touched a file',
		'LAST — never that they authored it, and never the files they only read. An owners-based query',
		'is impossible here by construction: a shared drive owns its own files, so the filter is',
		'client-side and the scan cost is the whole drive.',
		'',
		...drives.map((d) => `· ${d.name}`),
	].join('\n') + '\n');

	for (const [period, w] of weeks) {
		const wid = `${who()}/drive--${slug(as)}/${period}`;
		let summary;
		try { summary = readRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot)).fields.summary || undefined; } catch { /* first write */ }
		writeRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot), {
			// `retrospective` is REQUIRED on every collection; a week written without it
			// fails `check` the moment it lands.
			retrospective,
		contributor: who(),
			source: sourceRef,
			period,
			start_date: isoWeekRange(period).start,
			end_date: isoWeekRange(period).end,
			files_touched: w.files,
			bytes_touched: w.bytes,
			summary,
			author: `scripts/${READER}`,
		});
	}
}

process.stdout.write(
	`✔ drive as ${as} · drives ${drives.length} · scanned ${seen} · touched by ${contributor} ${mine.length} · kinds ${Object.entries(histogram).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' ')}${onlyKinds ? ` · kept ${rows.length} (${[...onlyKinds].join(',')})` : ''}`
	+ ` · deliverables written ${written} · weeks ${weeks.size}${flag('dry-run') ? ' · DRY RUN, nothing written' : ''}\n`,
);