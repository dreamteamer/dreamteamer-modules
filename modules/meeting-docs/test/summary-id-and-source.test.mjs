// A summary takes its meeting's id and lists every recording it was read from. Measured on the real
// engine, because the id rule is the one the command states and the descriptor cannot generate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { cleanup, run, installCopied } from '../../../tests/helpers/workspace.mjs';
import { workspace, dt, idOf, transcribedMeeting } from './helpers.mjs';

after(cleanup);

const { root } = workspace(installCopied);
dt(root, ['add', 'companies', '--name', 'Northwind']);
const meeting = transcribedMeeting(root, { name: 'Northwind workshop', starts: '2026-08-30T10:00:00+03:00', company: 'companies/northwind', privacy: 'open' });
const part2 = idOf(dt(root, ['add', 'meeting-recordings', '--name', 'Northwind workshop part 2', '--date', '2026-08-30T11:00:00+03:00', '--meeting', `meetings/${meeting}`]), 'meeting-recordings');
const part1 = fs.readdirSync(path.join(root, 'data', 'meeting-recordings', '2026', '08')).map((f) => `2026/08/${f.replace(/\.[a-z-]+\.md$/, '')}`).find((id) => id !== part2);

test('the command\'s add line files the summary at the meeting\'s own id, with both recordings as sources', () => {
	const file = dt(root, ['add', 'meeting-summaries', '--id', meeting, '--name', 'Northwind workshop',
		'--meeting', `meetings/${meeting}`, '--date', '2026-08-30T10:00:00+03:00', '--author', 'agents/claude-code',
		'--source', `meeting-recordings/${part1}`, '--source', `meeting-recordings/${part2}`]);
	assert.equal(file, `data/meeting-summaries/${meeting}.summary.md`);
	const fm = yaml.load(fs.readFileSync(path.join(root, file), 'utf8').split('\n---')[0].replace(/^---\n/, ''));
	assert.deepEqual(fm.source, [`meeting-recordings/${part1}`, `meeting-recordings/${part2}`]);
	assert.equal(fm.author, 'agents/claude-code');
});

test('a summary holding one recording as a plain string still validates', () => {
	const r = run(root, ['add', 'meeting-summaries', '--id', '2026/08/2026-08-29--northwind-intro', '--name', 'Northwind intro',
		'--source', `meeting-recordings/${part1}`]);
	assert.equal(r.status, 0, r.stderr + r.stdout);
	const p = path.join(root, 'data', 'meeting-summaries', '2026', '08', '2026-08-29--northwind-intro.summary.md');
	fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/source:\n\s+- (\S+)/, 'source: $1'));
	assert.match(fs.readFileSync(p, 'utf8'), /^source: meeting-recordings\//m);
	const checked = run(root, ['check']);
	assert.equal(checked.status, 0, checked.stderr + checked.stdout);
});
