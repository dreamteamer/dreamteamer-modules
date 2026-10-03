// THE MATCH WRITES ONE FIELD. `meetings.recordings` is declared in this module's meetings overlay as
// `mirror_of: meeting`, so the engine generates it from each recording's `meeting` and refuses a write
// to it. The command once told the agent to write both sides; an agent following it hit a refusal on
// its first `dt set`. These tests pin the command text to the one write the engine accepts, and pin
// the compiled descriptor and the engine's answers that the text relies on.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { virginWorkspace, installCopied, closure, run, compiledDescriptor, cleanup } from '../../../tests/helpers/workspace.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE = path.resolve(HERE, '..');
const COMMAND = fs.readFileSync(path.join(MODULE, 'commands', 'match-recording-to-meeting.command.md'), 'utf8');

after(cleanup);

describe('/match-recording-to-meeting names one write', () => {
	test('the write it names is the recording\'s `meeting` field', () => {
		assert.match(COMMAND, /dt set meeting-recordings\/<id> meeting=meetings\/<meeting id>/);
	});

	test('it never instructs a write to `recordings` on the meeting', () => {
		assert.doesNotMatch(COMMAND, /meetings\/\S*\s+recordings=/, 'a dt set of recordings= on a meeting');
		assert.doesNotMatch(COMMAND, /meeting\.recordings` gains/, 'the meeting side named as a write');
		assert.doesNotMatch(COMMAND, /\bboth\*{0,2} ref directions\b/i, 'both directions named as writes');
		assert.doesNotMatch(COMMAND, /x-inverse/, 'a v1 relation keyword');
	});
});

describe('the link the command relies on, in a compiled workspace', () => {
	const root = virginWorkspace();
	installCopied(root, [...closure('recordings')]);
	const compiled = run(root, ['compile']);
	const ok = (r, what) => assert.equal(r.status, 0, `${what} failed:\n${r.stderr}\n${r.stdout}`);

	test('the compiled meetings descriptor marks `recordings` as mirror_of the recording\'s `meeting`', () => {
		ok(compiled, 'compile');
		const meetings = yaml.load(compiledDescriptor(root, 'meetings'));
		assert.equal(meetings.fields.recordings.type, 'meeting-recordings');
		assert.equal(meetings.fields.recordings.mirror_of, 'meeting');
		const recordings = yaml.load(compiledDescriptor(root, 'meeting-recordings'));
		assert.equal(recordings.fields.meeting.type, 'meetings');
	});

	test('a write to the meeting side is refused, and the recording side fills it', () => {
		ok(compiled, 'compile');
		ok(run(root, ['add', 'companies', '--name', 'Northwind']), 'add company');
		ok(run(root, ['add', 'meetings', '--name', 'Northwind weekly', '--company', 'companies/northwind',
			'--starts', '2026-08-30T15:00:00+03:00', '--ends', '2026-08-30T16:00:00+03:00']), 'add meeting');
		ok(run(root, ['add', 'meeting-recordings', '--name', 'Northwind weekly', '--date', '2026-08-30T15:00:00+03:00']), 'add recording');
		const [meeting] = JSON.parse(run(root, ['list', 'meetings', '--json']).stdout);
		const [recording] = JSON.parse(run(root, ['list', 'meeting-recordings', '--json']).stdout);

		const refused = run(root, ['set', `meetings/${meeting.id}`, `recordings=meeting-recordings/${recording.id}`]);
		assert.notEqual(refused.status, 0, 'the engine accepted a write to the generated side');
		assert.match(refused.stderr + refused.stdout, /recordings is generated from meeting-recordings\.meeting/);
		assert.match(refused.stderr + refused.stdout, /nothing was written/);

		ok(run(root, ['set', `meeting-recordings/${recording.id}`, `meeting=meetings/${meeting.id}`]), 'set recording.meeting');
		const after = JSON.parse(run(root, ['get', `meetings/${meeting.id}`, '--json']).stdout);
		assert.deepEqual(after.recordings, [`meeting-recordings/${recording.id}`]);
		const checked = run(root, ['check']);
		ok(checked, 'check');
		assert.match(checked.stdout + checked.stderr, /0 violations/);
	});
});
