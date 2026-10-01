// The inventory against a synthetic machine: one git checkout, one folder that only looks like one,
// one ~/.claude tree with a transcript, and a codex home that is not there. Absent is a record.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord, listRecords, recordPath, writeRecord } from '../../skills/running-retrospectives/lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'skills', 'running-retrospectives', 'bin', 'inventory.mjs');
const SESSION = 'perspective/retrospective-sessions/2026-09-07--fx';
const SLUG = 'fx';   // the contributor — every source id is keyed by it, not by the run

/** Every reader resolves its key off the run record, so a data root without one cannot be read. */
function seedSession(data) {
	const id = SESSION.split('/').pop();
	writeRecord(recordPath('retrospective-sessions', id, 'retrospective-session', data),
		{ contributor: SLUG, handles: ['dana.o@northwind.example'], started: id.slice(0, 10), stage: 'installed' });
	return data;
}

test('classifies a git checkout, a claude tree, an empty dir and an absent codex home', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-inv-'));
	const repos = path.join(tmp, 'repos', 'acme'); fs.mkdirSync(path.join(repos, 'portal'), { recursive: true });
	execFileSync('git', ['init', '-q', path.join(repos, 'portal')]);
	fs.mkdirSync(path.join(tmp, 'repos', 'empty-folder'));
	const home = path.join(tmp, 'home'); fs.mkdirSync(path.join(home, '.claude', 'projects', '-x'), { recursive: true });
	fs.writeFileSync(path.join(home, '.claude', 'projects', '-x', '33333333-3333-4333-8333-333333333333.jsonl'), '{"type":"user","message":{"role":"user","content":"hi"}}\n');
	const data = seedSession(path.join(tmp, 'data'));
	const out = execFileSync('node', [BIN, '--retrospective', SESSION, '--repos-root', path.join(tmp, 'repos'), '--home', home, '--data-root', data, '--no-register'], { encoding: 'utf8', env: { ...process.env, REPOS_FOLDER: path.join(tmp, 'repos') } });
	assert.match(out, /✔ sources \d+/);
	const recs = listRecords(path.join(data, 'perspective', 'sources')).map((f) => readRecord(f).fields);
	const byKind = Object.fromEntries(recs.map((r) => [`${r.kind}:${r.label}`, r]));
	assert.equal(byKind['git-repo:portal'].reach, 'available');
	assert.equal(byKind['git-repo:portal'].location, '${env:REPOS_FOLDER}/acme/portal');
	assert.equal(byKind['claude-transcripts:default'].reach, 'available');
	assert.equal(byKind['claude-transcripts:default'].counts.files, 1);
	assert.equal(byKind['codex-transcripts:codex'].reach, 'unavailable');
	assert.equal(recs.some((r) => r.label === 'empty-folder'), false, 'a folder without .git is not a repo');
	for (const r of recs) assert.equal(r.location?.startsWith('/'), false, `${r.kind} location is a template`);
});
