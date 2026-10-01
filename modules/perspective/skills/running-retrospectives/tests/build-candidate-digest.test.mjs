// The digest is where naming quality is decided: a candidate rendered as "repo=api, 4 commits" gets
// named "worked on api". These tests pin the three things that make the difference — commit subjects,
// session titles, and (since read-asana@2) what people actually SAID on the ticket.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'build-candidate-digest.mjs');
const BASE = '2026-09-08--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run

function workspace() {
	const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-digest-'));
	const D = path.join(vault, 'data', 'perspective');
	const put = (rel, text) => { const p = path.join(D, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

	put('conversations/claude-code/2026/08/s1.conversation.md',
		'---\ntitle: Rework the statement parser\nturns_user: 14\nactive_minutes: 62\nrepo_name: api\n---\n');
	put('tickets/asana--acme/701.ticket.md',
		'---\ntitle: "[BE] Serve simulation content from object storage"\nproject: Platform\nstatus: completed\n---\n' +
		'Move the content URLs off the app server.\n\n' +
		'## comments\n\n**Dev Example · 2026-08-12**\n\nI added a script that rewrites the URLs. Tested locally with MinIO.\n\n' +
		'## trail\n\n- 2026-08-01 · Dev Example — moved this task to In Progress\n');
	// a ticket whose description is the placeholder the reader writes when Asana has none
	put('tickets/asana--acme/702.ticket.md',
		'---\ntitle: Research the open event\nproject: Platform\nstatus: open\n---\n_No description on the task._\n\n' +
		'## trail\n\n- 2026-08-02 · Dev Example — assigned to Dev Example\n');

	const scratch = path.join(vault, '.perspective');
	fs.mkdirSync(path.join(scratch, 'commits', BASE), { recursive: true });
	fs.writeFileSync(path.join(scratch, 'commits', BASE, 'api.jsonl'),
		JSON.stringify({ sha: 'abc1234', subject: 'feat: stream the statement rows instead of buffering' }) + '\n');
	fs.mkdirSync(path.join(scratch, 'activity-candidates'), { recursive: true });
	fs.writeFileSync(path.join(scratch, 'activity-candidates', `${BASE}.jsonl`),
		JSON.stringify({
			key: 'api--2026-08-01', repo: 'api', started: '2026-08-01', ended: '2026-08-12',
			sessions: ['perspective/conversations/claude-code/2026/08/s1'],
			commits: ['abc1234'], branches: ['main'],
			tickets: ['perspective/tickets/asana--acme/701', 'perspective/tickets/asana--acme/702'],
			handles: ['dev@example.test'], commit_count: 1, label_seed: ['statement', 'parser'], singleton: false,
		}) + '\n');
	return vault;
}

test('a candidate renders with the three things that let it be named', () => {
	const vault = workspace();
	const out = path.join(vault, 'digest.md');
	const receipt = execFileSync('node', [BIN, vault, BASE, out], { encoding: 'utf8' });
	assert.match(receipt, /1 candidates/);
	const t = fs.readFileSync(out, 'utf8');
	assert.match(t, /### candidate 1 · key=api--2026-08-01/);
	assert.match(t, /Rework the statement parser/, 'the session title');
	assert.match(t, /feat: stream the statement rows instead of buffering/, 'the commit subject');
	assert.match(t, /turns=14 active_min=62/, 'the counted effort, so a thin candidate reads as thin');
	fs.rmSync(vault, { recursive: true, force: true });
});

// The reason the digest was rebuilt: a naming pass reading ticket TITLES alone names activities after
// the ticket rather than the work. What someone said on the ticket is routinely the only place the
// reasoning survives.
test('a ticket brings its description and what people said, but never its placeholder', () => {
	const vault = workspace();
	const out = path.join(vault, 'digest.md');
	execFileSync('node', [BIN, vault, BASE, out], { encoding: 'utf8' });
	const t = fs.readFileSync(out, 'utf8');
	assert.match(t, /desc: Move the content URLs off the app server\./);
	assert.match(t, /said: .*I added a script that rewrites the URLs\. Tested locally with MinIO\./);
	assert.doesNotMatch(t, /_No description on the task\._/, 'the placeholder is noise in a digest — the ticket with none simply shows its title');
	assert.doesNotMatch(t, /moved this task to In Progress/, 'the trail is for the record, not for the naming pass — it is repetitive and would crowd out the rest');
	fs.rmSync(vault, { recursive: true, force: true });
});
