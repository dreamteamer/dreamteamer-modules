#!/usr/bin/env node
// read-asana — one contributor's Asana tasks, as `tickets`, plus the `collaborators` they appear as.
//   node read-asana.mjs --retrospective perspective/retrospective-sessions/<id> --contributor <email-or-gid>
//                       [--workspace <name-or-gid>] [--since YYYY-MM-DD] [--data-root d]
//                       [--fixture d] [--dry-run]
//
// Harness-neutral by construction: plain `fetch` against the REST API with a Personal Access Token,
// no MCP server, no SDK, nothing to install. The token is read from ASANA_PAT (the process
// environment first, then the workspace `.env`) and goes into ONE place — the Authorization header.
// It is never printed, never put in an error message, and never written to a record.
//
// `--fixture <dir>` replaces the three calls with `workspaces.json`, `users.json` and `tasks.json`
// of the same `{data:[…]}` shape, which is how the test runs offline and with no token at all.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, readEnv, slug } from '../lib/workspace.mjs';
import { recordPath, writeRecord, contributorOf, writeSource } from '../lib/records.mjs';
import { upsertCollaborators } from '../lib/collaborators.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const retrospective = opt('retrospective');
if (!retrospective.startsWith('perspective/retrospective-sessions/')) { console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required'); process.exit(2); }
const base = retrospective.split('/').pop();
const contributor = opt('contributor');
if (!contributor) { console.error('usage: --contributor <email-or-gid> is required — a run is one person\'s perspective'); process.exit(2); }
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use, so a bad argument exits 2 with a usage line before any session is read.
let _who = null;
const who = () => (_who ??= contributorOf(retrospective, dataRoot));
const since = opt('since');
const fixture = opt('fixture');
const dryRun = flag('dry-run');
let storyErrors = 0;

const API = 'https://app.asana.com/api/1.0';
const AUTHOR = 'scripts/read-asana@2';
const READ_WITH = 'read-asana@2';
// Everything a ticket record can hold, asked for in one go — Asana returns `gid` and `name` only
// unless opt_fields says otherwise, and a missing field here becomes a silently empty record field.
const TASK_FIELDS = ['name', 'gid', 'created_at', 'completed', 'completed_at', 'due_on', 'notes',
	'memberships.project.name', 'memberships.section.name', 'tags.name', 'permalink_url',
	'parent.gid', 'assignee.gid', 'assignee.email', 'assignee.name',
	// @2 — the rest of what a task holds. Many descriptions are EMPTY, so a ticket whose body is only `notes` says nothing about how the work went. Followers
	// are often the only record of who else was involved; `modified_at` is the field that tells a
	// two-year-old open ticket from live work; custom fields are whatever the board keeps.
	'modified_at', 'num_subtasks', 'followers.name', 'followers.email',
	'custom_fields.name', 'custom_fields.display_value'].join(',');
/** A task's event trail. `comment_added` is a person talking; everything else is the board moving. */
const STORY_FIELDS = 'resource_subtype,text,created_at,created_by.name,created_by.email';
/** How many story requests are in flight at once. Polite, and enough: 933 tasks finish in ~2 minutes. */
const STORY_CONCURRENCY = 6;

const token = fixture ? '' : (process.env.ASANA_PAT || readEnv().ASANA_PAT || '');
if (!fixture && !token) {
	console.error('ASANA_PAT is not set — add it to the workspace .env (see .env.sample) or export it for one command.\n' +
	              'Mint one at https://app.asana.com/0/my-apps. `npm run doctor` reports the `perspective` capability.');
	process.exit(2);
}

/** One GET. The response body is truncated into the error on purpose and the request headers are
 *  never echoed: an Asana 401 body says "Not Authorized", never the token, and this keeps it that way. */
async function get(pathname, params = {}) {
	const url = new URL(API + pathname);
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
	if (!res.ok) throw new Error(`asana GET ${pathname} → ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
	return res.json();
}
/** Every page: Asana cursors with `next_page.offset`, which is null on the last one. */
async function getAll(pathname, params) {
	const out = [];
	let offset = null;
	do {
		const page = await get(pathname, { ...params, ...(offset ? { offset } : {}) });
		out.push(...(page.data ?? []));
		offset = page.next_page?.offset ?? null;
	} while (offset);
	return out;
}
const fixtureData = (name) => JSON.parse(fs.readFileSync(path.join(fixture, name), 'utf8')).data ?? [];

const day = (s) => (s ? String(s).slice(0, 10) : undefined);
const lower = (s) => String(s ?? '').toLowerCase();

// ── workspace ────────────────────────────────────────────────────────────────────────────────────
const workspaces = fixture ? fixtureData('workspaces.json') : await getAll('/workspaces', { opt_fields: 'name', limit: 100 });
if (!workspaces.length) { console.error('this token reaches no Asana workspace'); process.exit(2); }
const wanted = opt('workspace');
const ws = wanted ? workspaces.find((w) => w.gid === wanted || lower(w.name) === lower(wanted)) : workspaces[0];
if (!ws) { console.error(`no workspace matches --workspace ${wanted} — reachable: ${workspaces.map((w) => w.name).join(', ')}`); process.exit(2); }

// ── the contributor ──────────────────────────────────────────────────────────────────────────────
const users = fixture ? fixtureData('users.json') : await getAll('/users', { workspace: ws.gid, opt_fields: 'name,email', limit: 100 });
const me = users.find((u) => u.gid === contributor || (u.email && lower(u.email) === lower(contributor)));
if (!me) {
	console.error(`no user in ${ws.name} matches --contributor ${contributor} — ${users.length} users read, and the match is on email or gid, never on a display name`);
	process.exit(2);
}

// ── the tasks ────────────────────────────────────────────────────────────────────────────────────
// `completed_since` is the completed-task trap: GET /tasks returns "tasks that are either
// incomplete OR that have been completed since this time", so a query that omits it is fine but one
// that passes a recent timestamp silently drops the closed work — which is most of the evidence a
// perspective is built from. The epoch value asks for all of it, explicitly.
const fetched = fixture
	? fixtureData('tasks.json')
	: await getAll('/tasks', { assignee: me.gid, workspace: ws.gid, completed_since: '1970-01-01T00:00:00Z', opt_fields: TASK_FIELDS, limit: 100 });
/** Filtered HERE as well as server-side: the fixture path has no server, and a widened query must
 *  never attribute somebody else's task to this contributor (a wrong merge is the worst error this
 *  module can make). */
const isMe = (a) => !!a && (a.gid === me.gid || (a.email && me.email && lower(a.email) === lower(me.email)));
const mine = fetched
	.filter((t) => isMe(t.assignee))
	.filter((t) => !since || day(t.created_at) >= since);

// ── the story trail ──────────────────────────────────────────────────────────────────────────────
// One extra GET per task. Skipped entirely with --no-stories (and on the fixture path, which has no
// server) — the tickets are still written, just thinner, and the receipt says so.
const wantStories = !flag('no-stories') && !fixture;
const stories = new Map();   // gid → { comments: [...], events: [...] }
if (wantStories) {
	const queue = [...mine];
	const workers = Array.from({ length: Math.min(STORY_CONCURRENCY, queue.length) }, async () => {
		for (let t = queue.shift(); t; t = queue.shift()) {
			let rows = [];
			// One task's stories failing must not cost the other 932. A task whose trail cannot be
			// read is a thinner ticket, never a dead run.
			try { rows = await getAll(`/tasks/${t.gid}/stories`, { opt_fields: STORY_FIELDS, limit: 100 }); }
			catch { storyErrors++; continue; }
			stories.set(t.gid, {
				comments: rows.filter((r) => r.resource_subtype === 'comment_added'),
				events: rows.filter((r) => r.resource_subtype !== 'comment_added'),
			});
		}
	});
	await Promise.all(workers);
}

/** The ticket as a person would read it. Never a blank body: "no description" is a fact worth saying. */
function ticketBody(t) {
	const st = stories.get(t.gid) ?? { comments: [], events: [] };
	const out = [];
	const notes = (t.notes ?? '').trim();
	out.push(notes || '_No description on the task._');
	if (st.comments.length) {
		out.push('', '## comments', '');
		for (const c of st.comments) {
			const who = c.created_by?.name || c.created_by?.email || 'someone';
			out.push(`**${who} · ${day(c.created_at)}**`, '', (c.text ?? '').trim(), '');
		}
	}
	if (st.events.length) {
		out.push('', '## trail', '');
		// The events in order, one line each. This is the only place that records a task going to
		// Failed QA twice before it closed — which is a workflow fact no other field carries.
		for (const e of st.events) {
			const who = e.created_by?.name || 'the system';
			const what = (e.text ?? e.resource_subtype ?? '').trim().replace(/\s+/g, ' ');
			if (what) out.push(`- ${day(e.created_at)} · ${who} — ${what}`);
		}
	}
	return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ── tickets ──────────────────────────────────────────────────────────────────────────────────────
const sourceId = `${who()}/asana--${slug(ws.name)}`;
const sourceRef = `perspective/sources/${sourceId}`;
let open = 0, completed = 0;
for (const t of mine) {
	t.completed ? completed++ : open++;
	const m = (t.memberships ?? [])[0] ?? {};
	// Mechanical, so a rewrite is free: nothing on a ticket is judged, and re-running the reader is
	// how a period is refreshed.
	if (!dryRun) writeRecord(recordPath('tickets', `${who()}/asana--${slug(ws.name)}/${t.gid}`, 'ticket', dataRoot), {
		retrospective,
		contributor: who(),
		source: sourceRef,
		external_id: t.gid,
		title: t.name,
		project: m.project?.name,
		section: m.section?.name,
		// The email when the system gives one — it is the handle that meets a git author address.
		assignee_handle: t.assignee?.email || t.assignee?.gid,
		created_on: day(t.created_at),
		completed_on: day(t.completed_at),
		due_on: day(t.due_on),
		status: t.completed ? 'completed' : 'open',
		tags: (t.tags ?? []).map((x) => lower(x.name)).filter(Boolean),
		url: t.permalink_url,
		parent_external_id: t.parent?.gid,
		last_activity_on: day(t.modified_at),
		comment_count: (stories.get(t.gid)?.comments ?? []).length || undefined,
		story_count: wantStories ? ((stories.get(t.gid)?.comments.length ?? 0) + (stories.get(t.gid)?.events.length ?? 0)) || undefined : undefined,
		subtask_count: t.num_subtasks || undefined,
		followers: (t.followers ?? []).map((f) => f.email || f.name).filter(Boolean),
		custom_fields: Object.fromEntries((t.custom_fields ?? [])
			.filter((c) => c.name && c.display_value)
			.map((c) => [c.name, c.display_value])),
		author: AUTHOR,
		creation_context: `read from Asana workspace ${ws.name}`,
	}, ticketBody(t));
}

// ── collaborators ────────────────────────────────────────────────────────────────────────────────
// EVERY person the kept tasks show, not only the assignee — enriched from the workspace user list,
// which is what turns a bare gid on a task into a name and an email.
//
// THE ASSIGNEE ALONE IS NOT ENOUGH: a contributor whose tickets are all SELF-ASSIGNED would come out
// with one collaborator — themselves — while those same tasks carry their counterparts in
// `followers` and in their comment trails. A collaborator model that says a product owner works
// alone is a fact about the reader, not about the person. Three roles, each keyed on an email or a gid and never on a display name:
//   · assignee   — the task is theirs
//   · follower   — they are on it (Asana's own notion of who is involved)
//   · commenter  — they wrote in the trail; `created_by.email` is already requested for this
// The merge itself is `lib/collaborators.mjs`, the one place that knows the rule.
const roles = new Map([['assignee', new Map()], ['follower', new Map()], ['commenter', new Map()]]);
function met(role, who, on) {
	if (!who) return;
	const u = users.find((x) => x.gid === who.gid) ?? {};
	const email = who.email || u.email;
	const gid = who.gid || u.gid;
	const key = gid || lower(email);
	if (!key) return;
	const bucket = roles.get(role);
	const p = bucket.get(key) ?? { gid, email, name: who.name || u.name, days: [], count: 0 };
	p.email ||= email; p.gid ||= gid; p.name ||= who.name || u.name;
	p.count++;
	if (on) p.days.push(day(on));
	bucket.set(key, p);
}
for (const t of mine) {
	met('assignee', t.assignee, t.created_at);
	for (const f of t.followers ?? []) met('follower', f, t.created_at);
	for (const c of stories.get(t.gid)?.comments ?? []) met('commenter', c.created_by, c.created_at);
}
let added = 0, matched = 0;
for (const [role, bucket] of roles) {
	if (!bucket.size) continue;
	const res = upsertCollaborators({
		dataRoot, contributorSlug: who(), retrospective, sourceRef,
		people: [...bucket.values()].map((p) => ({ email: p.email, id: p.gid, name: p.name, count: p.count, days: p.days })),
		role,
		author: AUTHOR,
		context: `seen as an Asana ${role} in ${ws.name}`,
		dryRun,
	});
	added += res.added;
	matched += res.matched;
}

// ── the source record ────────────────────────────────────────────────────────────────────────────
if (!dryRun) writeSource(recordPath('sources', sourceId, 'source', dataRoot), {
	contributor: who(),
	retrospective,
	kind: 'asana',
	label: ws.name,
	reach: 'available',
	// Not a machine path and not a mount: an Asana workspace is only ever reachable as a URL.
	location: `url:https://app.asana.com/0/${ws.gid}`,
	counts: {
		users: users.length,
		tasks: mine.length,
		with_description: mine.filter((t) => (t.notes ?? '').trim()).length,
		with_comments: [...stories.values()].filter((x) => x.comments.length).length,
	},
	read_with: READ_WITH,
	author: AUTHOR,
}, '');

const withDesc = mine.filter((t) => (t.notes ?? '').trim()).length;
const withComments = [...stories.values()].filter((x) => x.comments.length).length;
const trailed = [...stories.values()].reduce((a, x) => a + x.events.length, 0);
process.stdout.write(
	`✔ asana ${ws.name} · user ${me.name || me.email || me.gid} · tasks ${mine.length} (open ${open} · completed ${completed})` +
	` · collaborators +${added} (=${matched} existing)` +
	(wantStories ? ` · descriptions ${withDesc} · with comments ${withComments} · trail events ${trailed}${storyErrors ? ` · unread trails ${storyErrors}` : ''}` : ' · trails NOT read (--no-stories)') +
	`${dryRun ? ' · DRY RUN' : ''}\n`,
);
