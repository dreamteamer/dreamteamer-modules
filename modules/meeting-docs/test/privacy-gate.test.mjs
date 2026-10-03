// THE PRIVACY GATE, measured on the real engine: a meeting with `privacy: restricted` is never offered
// a summary, a task extraction or a review by `dt next`, while an open meeting and one written before
// the field existed still are. Run on both install channels, because each is its own engine path.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { CHANNELS, cleanup, run } from '../../../tests/helpers/workspace.mjs';
import { workspace, dt, transcribedMeeting, nextStates } from './helpers.mjs';

after(cleanup);

const GATED = ['summarize-meeting', 'extract-tasks-from-meetings', 'analyze-meetings'];

for (const [channel, install] of Object.entries(CHANNELS)) {
	describe(`privacy gate — ${channel}`, () => {
		const { root, overlay } = workspace(install);
		dt(root, ['add', 'companies', '--name', 'Northwind']);
		dt(root, ['add', 'companies', '--name', 'Harbor Mutual']);
		const restricted = transcribedMeeting(root, { name: 'Harbor Mutual claims review', starts: '2026-08-31T11:00:00+03:00', company: 'companies/harbor-mutual', privacy: 'restricted' });
		const open = transcribedMeeting(root, { name: 'Northwind sync', starts: '2026-09-01T11:00:00+03:00', company: 'companies/northwind', privacy: 'open' });
		const legacy = transcribedMeeting(root, { name: 'Northwind weekly', starts: '2026-08-30T10:00:00+03:00', company: 'companies/northwind', privacy: null });

		test('the fixture is a valid workspace', (t) => {
			if (overlay) t.diagnostic('modules/meetings declares no `privacy` in this tree — measured through a test-only overlay');
			const checked = run(root, ['check']);
			assert.equal(checked.status, 0, checked.stderr + checked.stdout);
			assert.ok(!fs.readFileSync(path.join(root, 'data', 'meetings', `${legacy}.meeting.md`), 'utf8').includes('privacy:'), 'the legacy fixture must carry no privacy key');
		});

		test('each gated binding compiles with the privacy condition', () => {
			for (const name of GATED) {
				const b = yaml.load(fs.readFileSync(path.join(root, '.dreamteamer', 'command-bindings', `${name}--meetings.command-binding.yaml`), 'utf8'));
				assert.deepEqual(b.available_when._or, [{ privacy: { _null: true } }, { privacy: { _neq: 'restricted' } }], name);
				assert.deepEqual(b.available_when.recordings, { transcription: { _nempty: true } }, name);
			}
		});

		test('dt next on a restricted meeting does not offer summarize, extract-tasks or analyze', () => {
			const states = nextStates(root, restricted);
			for (const name of GATED) assert.equal(states[name], 'not-applicable', `${name}: ${JSON.stringify(states)}`);
		});

		test('a restricted meeting can still be prepped — a prep reads none of its material', () => {
			assert.equal(nextStates(root, restricted)['prepare-for-meeting'], 'available');
		});

		test('dt next on an open meeting offers all three', () => {
			const states = nextStates(root, open);
			for (const name of GATED) assert.equal(states[name], 'available', `${name}: ${JSON.stringify(states)}`);
		});

		test('a meeting with no privacy value is open — all three are offered', () => {
			const states = nextStates(root, legacy);
			for (const name of GATED) assert.equal(states[name], 'available', `${name}: ${JSON.stringify(states)}`);
		});
	});
}
