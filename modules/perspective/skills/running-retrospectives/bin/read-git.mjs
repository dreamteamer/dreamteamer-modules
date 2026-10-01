#!/usr/bin/env node
// read-git — per repo per ISO week, counted from `git log`. No judged field, ever.
//   node read-git.mjs --retrospective perspective/retrospective-sessions/<id> [--repo-path d] [--since YYYY-MM-DD]
//        [--weeks N] [--all-refs] [--contributor <email>] [--scratch-root d] [--data-root d] [--dry-run]
// Writes per-author attribution, the two convergence curves (lines_new · lines_modified) sliced by
// modules_touched, the commits scratch file the cluster stage reads (commits are deliberately NOT
// records), and `perspective/users` records keyed on handles. --contributor only LABELS the receipt
// with how many of this run's commits belong to that person's handles; it filters nothing.
// --scratch-root redirects the commits JSONL away from the workspace's own `.perspective`.
// With no --repo-path it reads the run's own `sources` records: every git-repo whose reach is
// `available`, its `location` template rendered for THIS machine.
//
// GIT INVOCATION. `--numstat --name-status` in ONE call does NOT work: they are the same diff-format
// switch and the LAST one wins, so asking for both silently returns only the status letters and every
// line count becomes 0. `--raw --numstat` DOES emit both — the raw block (`:<modes> <shas> <status>\t
// <path>[\t<newpath>]`) then the numstat block, one line each per file in the SAME order — so one pass
// still gets status + counts. That is what runs here; the index pairing has a match-on-path fallback.
// `-M` makes a rename one `R###` row instead of an A + a D, which is the whole point: a refactor that
// moves 5,000 lines must not fake a convergence spike.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA, SCRATCH, render, templatize, isoWeek, isoWeekRange, slug } from '../lib/workspace.mjs';
import { recordPath, writeRecord, listRecords, readRecord, contributorOf, writeSource, collectionDir } from '../lib/records.mjs';
import { commitIntent } from '../lib/commit-intent.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const REF = 'perspective/retrospective-sessions/';
const retrospective = opt('retrospective');
const retrospectiveRef = retrospective;
if (!retrospectiveRef.startsWith(REF)) { console.error(`usage: --retrospective ${REF}<id> is required (the v1 spelling --retrospective still works, without the v2 passes)`); process.exit(2); }
/** The per-author passes — on whenever a run is named, which the usage check above requires. */
const v2 = Boolean(retrospective);
const sessionBase = retrospectiveRef.split('/').pop();
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use, so a bad argument exits 2 with a usage line before any session is read.
let _who = null;
const who = () => (_who ??= contributorOf(retrospective, dataRoot));
// The default window is the LAST N WEEKS, not all of history: a perspective is about the recent shape
// of the work. N comes from --weeks, else the retrospective record's
// `activity_weeks_back`, else 4. An explicit --since always wins. Conversations are not bounded by this.
function defaultSince() {
	let weeks = Number(opt('weeks', '0')) || 0;
	if (!weeks && v2) {
		try {
			const rec = readRecord(recordPath('retrospective-sessions', sessionBase, 'retrospective-session', dataRoot));
			weeks = Number(rec.fields.activity_weeks_back) || 0;
		} catch { /* no record under this data root — fall through to 4 */ }
	}
	if (!weeks) weeks = 4;
	const d = new Date(); d.setUTCDate(d.getUTCDate() - weeks * 7);
	return d.toISOString().slice(0, 10);
}
const since = opt('since') || defaultSince();
const contributor = opt('contributor');
/** Where the commits JSONL lands. Defaults to the gitignored `<workspace>/.perspective`; a test points it elsewhere. */
const scratchRoot = opt('scratch-root', SCRATCH);
const dry = flag('dry-run');
// `git log` reads HEAD, and HEAD is whatever branch this checkout happens to sit on. Reading
// ANOTHER person's work from a clone you never check out, that is almost always wrong: their recent
// commits are on `origin/<their branch>` and a plain log sees none of them — a fresh clone's HEAD can
// stop months before its remotes do. --all-refs reads every ref instead (git dedupes a commit on several branches), which
// is what a retrospective wants: a branch is work. Opt-in, because it changes every count.
const allRefs = flag('all-refs');

const FMT_V1 = '%x01%H%x09%aI%x09%aN';
const FMT_V2 = '%x01%H%x09%aI%x09%aN%x09%aE%x09%D%x09%s';

let targets = [];
if (opt('repo-path')) targets = [{ dir: path.resolve(opt('repo-path')), sourceId: `${who()}/git-repo--${slug(path.basename(opt('repo-path')))}`, repo: '' }];
else for (const f of listRecords(path.join(collectionDir('sources', dataRoot), who()))) {
	const { fields } = readRecord(f);
	if (fields.kind === 'git-repo' && fields.reach === 'available' && fields.location) targets.push({ dir: render(fields.location), sourceId: `${who()}/${path.basename(f).replace(/\.source\.md$/, '')}`, repo: fields.repo ?? '' });
}

/** `a => b` and `pre/{a => b}/post` — numstat's rename spellings under -M. */
function destPath(p) {
	const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(p);
	if (brace) return (brace[1] + brace[3] + brace[4]).replace(/\/{2,}/g, '/');
	const arrow = /^(.*) => (.*)$/.exec(p);
	return arrow ? arrow[2] : p;
}

/** Pair the raw block with the numstat block. Same order, one line each per file — index pairing;
 *  if git ever disagrees on the counts, fall back to matching on the destination path. */
function zip(raws, nums, rich) {
	// Without --raw and -M the path is numstat's, verbatim.
	if (!raws.length) return nums.map((n) => ({ path: rich ? destPath(n.path) : n.path, status: '', add: n.add, del: n.del }));
	if (raws.length === nums.length) return nums.map((n, i) => ({ path: raws[i].path, status: raws[i].status, add: n.add, del: n.del }));
	const byPath = new Map(raws.map((r) => [r.path, r]));
	return nums.map((n) => { const p = destPath(n.path); return { path: p, status: byPath.get(p)?.status ?? '', add: n.add, del: n.del }; });
}

function parseLog(text, rich) {
	const out = [];
	let cur = null, raws = [], nums = [];
	const close = () => { if (cur) { cur.files = zip(raws, nums, rich); out.push(cur); } };
	for (const line of text.split('\n')) {
		if (line.startsWith('\x01')) {
			close();
			const p = line.slice(1).split('\t');
			// %s may itself contain a tab, and it is last — rejoin the tail rather than truncate it.
			cur = { sha: p[0], date: p[1], author_name: p[2], author_email: rich ? (p[3] ?? '').toLowerCase() : '', decorations: rich ? p[4] ?? '' : '', subject: rich ? p.slice(5).join('\t') : '' };
			raws = []; nums = [];
			continue;
		}
		if (!cur) continue;
		if (rich && line.startsWith(':')) {
			const p = line.split('\t');
			raws.push({ status: p[0].trim().split(/\s+/).pop(), path: p.length > 2 ? p[2] : p[1] });
			continue;
		}
		const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
		if (m) nums.push({ add: m[1] === '-' ? 0 : +m[1], del: m[2] === '-' ? 0 : +m[2], path: m[3] });
	}
	close();
	return out;
}

/** %D → the branch names only: `HEAD -> main, origin/main, tag: v1` → [main, origin/main]. */
/** How many commits a week LOSES by this read, or 0. Reads the record already on disk; a week that
 *  does not exist yet cannot shrink. */
let shrunk = 0, shrunkBy = 0;
function shrinkOf(wid, commits, dataRoot) {
	try {
		const prior = Number(readRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot)).fields.commits ?? 0);
		if (prior > commits) { shrunkBy += prior - commits; return 1; }
	} catch { /* first write — nothing to shrink */ }
	return 0;
}

function branchesOf(dec) {
	if (!dec) return [];
	return dec.split(',').map((d) => d.trim()).filter(Boolean)
		.map((d) => (d.startsWith('HEAD -> ') ? d.slice(8) : d))
		.filter((d) => d !== 'HEAD' && !d.startsWith('tag: '));
}

let windows = 0, commits = 0;
const unreadable = [];
/** "<name>\0<email>" → the one person git saw under that exact pair. Merging pairs is a PERSON's
 *  decision (four handles for one human is real data), never this script's. */
const authors = new Map();

for (const t of targets) {
	// `git log` EXITS 128 on a repo with no commits ('your current branch does not have any
	// commits yet'), and an unreadable repo must never cost the rest of the run.
	let log;
	const args = v2
		? ['-c', 'core.quotePath=false', '-C', t.dir, 'log', ...(allRefs ? ['--all'] : []), `--since=${since}`, `--format=${FMT_V2}`, '--raw', '--numstat', '-M']
		: ['-C', t.dir, 'log', ...(allRefs ? ['--all'] : []), `--since=${since}`, `--format=${FMT_V1}`, '--numstat'];
	try { log = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }); }
	catch (e) { unreadable.push(`${t.dir}: ${String(e.stderr ?? e.message).trim().split('\n')[0]}`); continue; }

	const sourceRef = `perspective/sources/${t.sourceId}`;
	// With --repo-path there is no inventory to have written the `sources` record, so every
	// activity-week and collaborator this run writes would dangle. Upsert it here: reach available, location as a template, counts.
	if (opt('repo-path') && v2 && !dry) {
		const sfile = recordPath('sources', t.sourceId, 'source', dataRoot);
		const priorSrc = fs.existsSync(sfile) ? readRecord(sfile) : { fields: {}, body: '' };
		writeSource(sfile, {
			...priorSrc.fields,
			retrospective: `${REF}${sessionBase}`, contributor: who(), kind: 'git-repo', label: path.basename(t.dir), reach: 'available',
			location: templatize(t.dir), read_with: 'read-git@2', author: priorSrc.fields.author ?? 'scripts/read-git@2',
		}, priorSrc.body);
	}
	const weeks = new Map();
	const jsonl = [];
	for (const c of parseLog(log, v2)) {
		commits++;
		const w = isoWeek(new Date(c.date));
		let cur = weeks.get(w);
		if (!cur) { cur = { commits: 0, files: new Set(), add: 0, del: 0, authors: new Set(), lnew: 0, lmod: 0, modules: new Set(), bug: 0, cr: 0 }; weeks.set(w, cur); }
		cur.commits++;
		const intent = commitIntent(c.subject);
		if (intent === 'bug') cur.bug++; else if (intent === 'change-request') cur.cr++;
		cur.authors.add(c.author_name);
		for (const f of c.files) {
			cur.files.add(f.path);
			cur.add += f.add;
			cur.del += f.del;
			if (!v2) continue;
			// CURVE ONE is new code only: status A. Everything else — an edit (M), a delete (D), a
			// type change (T), a copy (C) and above all a rename (R###) — is a change to code that
			// already existed, so its insertions AND deletions go to CURVE TWO.
			if (f.status.startsWith('A')) cur.lnew += f.add; else cur.lmod += f.add + f.del;
			const seg = f.path.split('/')[0].toLowerCase();
			if (seg) cur.modules.add(seg);
		}
		if (!v2) continue;
		const day = c.date.slice(0, 10);
		const key = `${c.author_name}\0${c.author_email}`;
		let a = authors.get(key);
		if (!a) { a = { name: c.author_name, email: c.author_email, count: 0, first: day, last: day, sources: new Set() }; authors.set(key, a); }
		a.count++;
		if (day < a.first) a.first = day;
		if (day > a.last) a.last = day;
		a.sources.add(sourceRef);
		jsonl.push(JSON.stringify({ sha: c.sha, date: c.date, author_name: c.author_name, author_email: c.author_email, branches: branchesOf(c.decorations), subject: c.subject, files: c.files.map((f) => ({ path: f.path, status: f.status, add: f.add, del: f.del })), repo: t.repo || path.basename(t.dir), source: sourceRef }));
	}

	// The cluster stage reads commits from here, not from records. Truncated and rewritten per run.
	if (v2 && !dry) {
		const f = path.join(scratchRoot, 'commits', sessionBase, `${slug(path.basename(t.dir))}.jsonl`);
		fs.mkdirSync(path.dirname(f), { recursive: true });
		fs.writeFileSync(f, jsonl.map((l) => l + '\n').join(''));
	}

	for (const [period, w] of weeks) {
		windows++;
		const { start: start_date, end: end_date } = isoWeekRange(period);
		// `retrospective` is REQUIRED on every collection, and only a FRESH read shows its
		// absence — a migrated tree looks clean.
		const fields = { retrospective, contributor: who(), source: sourceRef, period, start_date, end_date, commits: w.commits, files_changed: w.files.size, lines_added: w.add, lines_deleted: w.del };
		if (v2) {
			fields.lines_new = w.lnew; fields.lines_modified = w.lmod; fields.modules_touched = [...w.modules].sort().slice(0, 30);
			fields.commits_bug = w.bug; fields.commits_change_request = w.cr;
		}
		fields.authors = [...w.authors].sort();
		fields.author = v2 ? 'scripts/read-git@2' : 'scripts/read-git@1';
		const wid = `${who()}/${t.sourceId.split('/').pop()}/${period}`;
		// A RE-READ THAT SHRINKS A WEEK IS ALMOST ALWAYS A FLAG, NOT THE REPO. `git log` walks HEAD,
		// and HEAD is whatever branch this checkout sits on — so a run WITHOUT `--all-refs` over a repo
		// whose work lives on feature branches quietly reports a fraction of it and drops the authors
		// who only appear there — and would overwrite a colleague's history with the narrower number,
		// silently, with nothing in the receipt connecting the two counts.
		// So a shrink is COUNTED and named at the end. It is not refused: a rebased or pruned repo
		// legitimately loses commits, and the reader is not the place to adjudicate that.
		// It only catches a week the narrow read still WRITES. A week that disappears from the read
		// entirely — every commit in it lived on the unseen branch — leaves its old record on disk
		// untouched, so the data survives and there is nothing to warn about; the count below is a
		// floor on the damage, never a total.
		shrunk += shrinkOf(wid, w.commits, dataRoot);
		// A recount must not delete the one field on this record a model wrote. Same trap the
		// transcripts reader had: everything here is recomputed, `summary` is not.
		try { const prior = readRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot)).fields.summary; if (prior) fields.summary = prior; } catch { /* new week */ }
		if (!dry) writeRecord(recordPath('activity-weeks', wid, 'activity-week', dataRoot), fields);
	}
}


// ── THE PERSON'S OWN GIT IDENTITIES ────────────────────────────────────────────────────────────
// A developer with one machine routinely has several git identities on it — a personal address, a
// work address, one per client — wired up with `includeIf "gitdir:…"` in ~/.gitconfig. `git log`
// reports them as different authors, so without this the person appears in their own perspective as
// a set of strangers — often with their own largest "collaborator" being themselves under another
// address.
// The rule is narrow and safe: identities declared in THIS home's own git config belong to whoever
// owns the home. They are adopted ONLY when the given --contributor is one of them — so a shared
// machine, or a contributor being read by proxy, adopts nothing.
function ownGitIdentities(homeDir) {
	const files = [path.join(homeDir, '.gitconfig'), path.join(homeDir, '.config', 'git', 'config')];
	const seen = new Set(), ids = [];
	const read = (f) => {
		if (seen.has(f) || !fs.existsSync(f)) return;
		seen.add(f);
		let text = '';
		try { text = fs.readFileSync(f, 'utf8'); } catch { return; }
		let section = '', cur = null;
		for (const raw of text.split('\n')) {
			const l = raw.trim();
			if (!l || l.startsWith('#') || l.startsWith(';')) continue;
			const sec = /^\[([^\]]+)\]$/.exec(l);
			if (sec) { if (cur) { ids.push(cur); cur = null; } section = sec[1].toLowerCase(); if (section === 'user') cur = {}; continue; }
			const kv = /^([A-Za-z]+)\s*=\s*(.+)$/.exec(l);
			if (!kv) continue;
			const [, k, v] = kv;
			if (section === 'user' && cur) cur[k.toLowerCase()] = v.trim();
			// `path = ~/.gitconfig-work` under any includeIf — the included file is this person's too
			if (k.toLowerCase() === 'path' && section.startsWith('includeif')) read(v.trim().replace(/^~(?=\/|$)/, homeDir));
		}
		if (cur) ids.push(cur);
	};
	for (const f of files) read(f);
	return ids.filter((i) => i.email || i.name);
}

// ── collaborators ──────────────────────────────────────────────────────────────────────────────
// NEVER merge two existing records. A wrong merge attributes one person's work to another, which is
// the worst error this module can make, and the merge is a person's decision. So: at most
// ONE existing record is bound per author, email before display name, and overlapping `handles` are
// left to be discovered rather than resolved here.
const groups = [];
let newCollaborators = 0, gatedOut = 0, gatedDeleted = 0, adopted = 0;
if (v2) {
	const prior = listRecords(path.join(collectionDir('users', dataRoot), who()))
		.map((file) => { const { fields, body } = readRecord(file); return { file, fields, body }; });
	const bound = new Set();
	for (const a of [...authors.values()].sort((x, y) => y.count - x.count || x.name.localeCompare(y.name))) {
		let g = groups.find((h) => (a.email && h.handles.has(a.email)) || h.handles.has(a.name));
		if (!g) {
			const hit = prior.find((e) => !bound.has(e.file) && a.email && (e.fields.handles ?? []).includes(a.email))
				?? prior.find((e) => !bound.has(e.file) && (e.fields.handles ?? []).includes(a.name));
			const file = hit ? hit.file : recordPath('users', `${who()}/${slug(a.name)}`, 'user', dataRoot);
			g = groups.find((h) => h.file === file);
			if (!g) {
				if (hit) bound.add(hit.file);
				g = {
					file, prior: hit?.fields ?? null, body: hit?.body ?? '', fresh: !hit,
					name: hit?.fields?.name ?? a.name,
					handles: new Set(hit?.fields?.handles ?? []),
					first: hit?.fields?.first_seen ?? a.first,
					last: hit?.fields?.last_seen ?? a.last,
					seen: 0,
					sources: new Set(hit?.fields?.sources ?? []),
					roles: new Set(hit?.fields?.roles_observed ?? []),
				};
				groups.push(g);
			}
		}
		g.handles.add(a.email);
		g.handles.add(a.name);
		g.seen += a.count;
		if (a.first < g.first) g.first = a.first;
		if (a.last > g.last) g.last = a.last;
		for (const s of a.sources) g.sources.add(s);
		g.roles.add('author');
	}
	// TRANSITIVE UNION. The loop above binds each author to the FIRST group sharing an email or a
	// name — but a bridging identity can arrive AFTER two groups already exist (A<e1>, then B<e2>, then
	// B<e1>: B's second identity matches A by email and B by name, and the two groups never meet).
	// Without it the person lands in two records, and so does a colleague with a work email and a
	// personal one. So: merge until no two groups share a handle, keeping the
	// group that already has a record on disk (else the first), summing what was seen this run.
	for (let merged = true; merged;) {
		merged = false;
		outer: for (let i = 0; i < groups.length; i++) {
			for (let j = i + 1; j < groups.length; j++) {
				const a = groups[i], b = groups[j];
				if (![...b.handles].some((h) => h && a.handles.has(h))) continue;
				const [keep, drop] = a.prior || !b.prior ? [a, b] : [b, a];
				for (const h of drop.handles) keep.handles.add(h);
				for (const x of drop.sources) keep.sources.add(x);
				for (const r of drop.roles) keep.roles.add(r);
				keep.seen += drop.seen;
				if (drop.first < keep.first) keep.first = drop.first;
				if (drop.last > keep.last) keep.last = drop.last;
				groups.splice(groups.indexOf(drop), 1);
				merged = true;
				break outer;
			}
		}
	}
	// ── THE CONTRIBUTOR GATE ───────────────────────────────────────────────────────────────────
	// A retrospective is ONE person's perspective, and `authors` is every name `git log` returned —
	// which, over an inventory that includes cloned third-party repos, is mostly strangers: the
	// open-source contributors to a vendored theme are not collaborators. Someone who committed to a repo the contributor never touched is not their
	// collaborator; they are a fact about a checkout.
	// So when --contributor is given: keep a group only if it shares a SOURCE with the contributor's
	// own group. Everyone else is dropped, and a stale record a previous run wrote is deleted — but
	// ONLY when this script wrote it, never a hand-written or hand-merged one.
	if (contributor) {
		// Adopt the person's other declared identities BEFORE the gate runs — otherwise their own
		// commits under a second address read as a stranger's, and the gate keeps the stranger.
		const declared = ownGitIdentities(opt('home', os.homedir()));
		const mineDeclared = declared.some((i) => i.email === contributor || i.name === contributor)
			? new Set(declared.flatMap((i) => [i.email, i.name]).filter(Boolean))
			: new Set();
		if (mineDeclared.size) {
			const primary = groups.find((g) => g.handles.has(contributor));
			for (const g of [...groups]) {
				if (g === primary || ![...g.handles].some((h) => mineDeclared.has(h))) continue;
				for (const h of g.handles) primary.handles.add(h);
				for (const x of g.sources) primary.sources.add(x);
				for (const r of g.roles) primary.roles.add(r);
				primary.seen += g.seen;
				if (g.first < primary.first) primary.first = g.first;
				if (g.last > primary.last) primary.last = g.last;
				adopted++;
				if (!dry && g.prior && String(g.prior.author ?? '').startsWith('scripts/read-git')) { try { fs.rmSync(g.file); } catch { /* already gone */ } }
				groups.splice(groups.indexOf(g), 1);
			}
		}
		const me = groups.find((g) => g.handles.has(contributor));
		if (!me) process.stderr.write(`  ⚠ --contributor ${contributor} matched no git author in this window — the collaborator gate is OFF\n`);
		else {
			const mine = me.sources;
			for (const g of [...groups]) {
				if (g === me || [...g.sources].some((sx) => mine.has(sx))) continue;
				gatedOut++;
				if (!dry && g.prior && String(g.prior.author ?? '').startsWith('scripts/read-git')) {
					try { fs.rmSync(g.file); gatedDeleted++; } catch { /* already gone */ }
				}
				groups.splice(groups.indexOf(g), 1);
			}
		}
	}
	// The other half of staleness: a record a WIDER earlier run wrote, whose person did not commit at
	// all inside this window. `groups` cannot see them — no author this run matched — so nothing above
	// touches them. Under
	// --contributor, a person absent from the whole window is not part of this perspective: drop them,
	// script-written only, and only when their own `last_seen` predates the window.
	if (contributor) {
		const live = new Set();
		for (const g of groups) for (const h of g.handles) live.add(h);
		for (const e of prior) {
			if ((e.fields.handles ?? []).some((h) => live.has(h))) continue;
			if (!String(e.fields.author ?? '').startsWith('scripts/read-git')) continue;
			if (String(e.fields.last_seen ?? '9999') >= since) continue;
			gatedOut++;
			if (!dry) { try { fs.rmSync(e.file); gatedDeleted++; } catch { /* already gone */ } }
		}
	}
	for (const g of groups) {
		if (g.fresh) newCollaborators++;
		if (dry) continue;
		// evidence_count is a SNAPSHOT, never a running sum: max(existing, this run's count) — the same
		// rule read-asana uses. A sum would double on every re-run of the same window, and idempotency is
		// the module's promise; the cost is that a person seen in git AND Asana carries the larger of the
		// two counts rather than both — honest, and never inflated.
		writeRecord(g.file, {
			...(g.prior ?? {}),
			retrospective: `${REF}${sessionBase}`,
			// The spread above inherits NOTHING for a collaborator this run is meeting for the first
			// time, so both keys have to be written here.
			contributor: who(),
			name: g.name,
			handles: [...g.handles].filter(Boolean).sort(),
			first_seen: g.first,
			last_seen: g.last,
			evidence_count: Math.max(g.prior?.evidence_count ?? 0, g.seen),
			roles_observed: [...g.roles].sort(),
			sources: [...g.sources].sort(),
			author: 'scripts/read-git@2',
			creation_context: g.prior?.creation_context ?? 'git author attribution — read-git over the run’s git-repo sources',
		}, g.body);
	}
}

let contributorCommits = 0;
if (v2 && contributor) {
	const handles = groups.find((g) => g.handles.has(contributor))?.handles ?? new Set([contributor]);
	for (const a of authors.values()) if (handles.has(a.email) || handles.has(a.name)) contributorCommits += a.count;
}

if (unreadable.length) process.stderr.write(unreadable.map((u) => `  ⚠ skipped ${u}`).join('\n') + '\n');
let receipt = `✔ repos ${targets.length} · windows ${windows} · commits ${commits} · unreadable ${unreadable.length}`;
if (v2) receipt += ` · authors ${authors.size} (+${newCollaborators} new collaborators) · contributor commits ${contributor ? contributorCommits : 'n/a'}`;
if (v2 && contributor) receipt += ` · own identities adopted ${adopted} · gated out ${gatedOut} (deleted ${gatedDeleted})`;
// The DRY RUN marker goes on the COUNTS line, before the warning block — appended after a
// multi-line warning it reads as a note about the warning rather than about the run.
if (dry) receipt += ' · DRY RUN';
if (shrunk) {
	receipt += `\n  ⚠ ${shrunk} week(s) came out SMALLER than the record already on disk (${shrunkBy} commits fewer in total).`;
	if (!allRefs) receipt += `\n    You did not pass --all-refs, and \`git log\` walks only the branch each checkout sits on.\n    That is the usual cause, and re-running without it overwrites a wider read with a narrower one.`;
	else receipt += `\n    --all-refs was on, so the repo itself lost them — a rebase, a prune, or a force-push.`;
}
process.stdout.write(`${receipt}\n`);
