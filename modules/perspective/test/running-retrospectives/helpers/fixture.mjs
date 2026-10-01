// One workspace every idempotency case runs against — small enough to reason about, wide enough that
// each mechanical stage has something to do. Deliberately built with the synthetic cast.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeRecord, recordPath } from '../../../skills/running-retrospectives/lib/records.mjs';

export const BASE = '2026-09-09--dana-o';
export const SLUG = 'dana-o';
export const HANDLE = 'dana.o@northwind.example';
export const REF = `perspective/retrospective-sessions/${BASE}`;

/**
 * Returns { ws, data, home, repos, scratch }. Every stage under test is given these roots, so a
 * stage that writes outside them is itself a finding.
 */
export function fixtureWorkspace() {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-idem-'));
	const data = path.join(ws, 'data');
	const home = path.join(ws, 'home');
	const repos = path.join(ws, 'repos');
	const scratch = path.join(ws, '.perspective');
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(scratch, { recursive: true });

	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data),
		{ contributor: SLUG, handles: [HANDLE], started: '2026-09-09', stage: 'extracted', period_start: '2026-01-01', period_end: '2026-12-31' });

	// two repos with real commits, so read-git has history to count. The SHAs are captured because the
	// joins under test are through the EVIDENCE, never through a date: a decision belongs to the
	// project of the activity that cites the same commit.
	const shas = {};
	for (const name of ['northwind-api', 'bright-web']) {
		const r = path.join(repos, name);
		fs.mkdirSync(r, { recursive: true });
		const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
			GIT_AUTHOR_DATE: '2026-03-04T10:00:00Z', GIT_COMMITTER_DATE: '2026-03-04T10:00:00Z' };
		execFileSync('git', ['init', '-q', r], { env });
		fs.writeFileSync(path.join(r, 'f.txt'), 'one\n');
		execFileSync('git', ['-c', `user.name=Dana Oren`, '-c', `user.email=${HANDLE}`, '-C', r, 'add', 'f.txt'], { env });
		execFileSync('git', ['-c', `user.name=Dana Oren`, '-c', `user.email=${HANDLE}`, '-C', r, 'commit', '-q', '-m', `first on ${name}`], { env });
		shas[name] = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { env, encoding: 'utf8' }).trim();
		// ⚠ `retrospectives` is a LIST — `sources` is the one collection that is many-to-many with the
		// run, because a source is durable and every run re-reads it.
		writeRecord(recordPath('sources', `${SLUG}/git-repo--${name}`, 'source', data),
			{ retrospectives: [REF], contributor: SLUG, kind: 'git-repo', label: name, reach: 'available', location: r });
	}

	// a project with three activities and one decision — enough for an arc infer-goals can read
	writeRecord(recordPath('world/projects', `${SLUG}/northwind-api`, 'project', data),
		{ retrospective: REF, contributor: SLUG, name: 'northwind api', kind: 'product' });
	// ⚠ Each activity carries the COMMIT it was reconstructed from. That is the join
	// `derive-decision-projects` uses — a decision belongs to the project of the activity citing the
	// same artefact, never to "the project active that week". Its repo, and so its week, comes from
	// `from_candidate`, which the clustering pass sets; the idempotency gate sets it there.
	for (const [i, name] of ['rewrote the auth flow', 'split the token store', 'cut the retry loop'].entries()) {
		writeRecord(recordPath('world/activities', `${SLUG}/2026-03-0${i + 1}--${name.replace(/ /g, '-')}`, 'activity', data),
			{ retrospective: REF, contributor: SLUG, name, started: '2026-03-04', ended: '2026-03-04',
			  project: `perspective/world/projects/${SLUG}/northwind-api`,
			  tickets: i === 0 ? [`perspective/tickets/${SLUG}/asana--northwind/1`] : undefined,
			  commits: [shas['northwind-api']] });
	}
	writeRecord(recordPath('decisions', `${SLUG}/2026-03-11--stop-issuing-long-lived-tokens`, 'decision', data),
		{ retrospective: REF, contributor: SLUG, name: 'stop issuing long-lived tokens',
		  source_kind: 'git-commit', source_ref: shas['northwind-api'], decided_on: '2026-03-11',
		  project: `perspective/world/projects/${SLUG}/northwind-api` });

	// one ticket an activity cites, so `derive-tasks` has a commitment to model. The asana source is a
	// record too — a reader refuses to run against a source that is not there, and so does this pass's
	// own join.
	writeRecord(recordPath('sources', `${SLUG}/asana--northwind`, 'source', data),
		{ retrospectives: [REF], contributor: SLUG, kind: 'asana', label: 'northwind', reach: 'available' });
	writeRecord(recordPath('tickets', `${SLUG}/asana--northwind/1`, 'ticket', data),
		{ retrospective: REF, contributor: SLUG, source: `perspective/sources/${SLUG}/asana--northwind`,
		  external_id: '1', title: 'Rotate the signing key', status: 'open', created_on: '2026-03-02',
		  assignee: `perspective/world/users/${SLUG}/dana-oren`, assignee_handle: HANDLE });

	// one collaborator, so derive passes have somebody to resolve against
	writeRecord(recordPath('world/users', `${SLUG}/dana-oren`, 'user', data),
		{ retrospective: REF, contributor: SLUG, name: 'Dana Oren', handles: [HANDLE] });

	return { ws, data, home, repos, scratch };
}
