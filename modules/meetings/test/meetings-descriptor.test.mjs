// The `meetings` descriptor as a consumer gets it: the module packed, installed alone with its
// dependency closure into a fresh workspace, compiled by the engine under test, and asserted on the
// COMPILED descriptor, the harness block's `write:` line and real `dt add` calls — never on the
// source YAML alone, because the source and the compiled output can disagree.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { virginWorkspace, installPacked, closure, compileAndCheck, compiledDescriptor, run, cleanup } from '../../../tests/helpers/workspace.mjs';

let root;
let d;
before(() => {
	root = virginWorkspace();
	installPacked(root, [...closure('meetings')]);
	compileAndCheck(root);
	d = yaml.load(compiledDescriptor(root, 'meetings'));
	assert.equal(run(root, ['add', 'companies', '--name', 'Northwind']).status, 0);
});
after(cleanup);

const files = () => {
	const dir = path.join(root, 'data', 'meetings');
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f));
};
const record = (rel) => yaml.load(fs.readFileSync(path.join(root, 'data', 'meetings', rel), 'utf8').split('---')[1]);

test('privacy compiles as a closed two-value string field defaulting to open', () => {
	const f = d.fields.privacy;
	assert.ok(f, 'no privacy field in the compiled descriptor');
	assert.equal(f.type, 'string');
	assert.deepEqual(f.enum, ['open', 'restricted']);
	assert.equal(f.default, 'open');
	assert.notEqual(f.sensitive, true, 'privacy is what an export reads to know a record is restricted; it must travel');
	assert.match(f.description, /restricted.*stops after transcription/s);
});

test('privacy sits in the record form beside status', () => {
	const section = d.display.form.sections.find((s) => s.fields.includes('privacy'));
	assert.ok(section, 'privacy is in no form section');
	assert.deepEqual(section.fields, ['status', 'privacy']);
});

test('a write of privacy=secret is refused and writes nothing', () => {
	const before = files().length;
	const r = run(root, ['add', 'meetings', '--name', 'Refused call', '--starts', '2026-08-30T09:00:00+03:00', '--company', 'companies/northwind', '--privacy', 'secret']);
	assert.notEqual(r.status, 0, 'privacy=secret was accepted');
	// the refusal is the enum's, not an unknown flag's: privacy must exist for this to read so
	assert.match(r.stderr + r.stdout, /privacy: "secret" not in enum \[open, restricted\]/);
	assert.equal(files().length, before);
});

test('an add without privacy is stamped open; restricted is accepted', () => {
	const open = run(root, ['add', 'meetings', '--name', 'Weekly sync', '--starts', '2026-08-30T10:00:00+03:00', '--company', 'companies/northwind']);
	assert.equal(open.status, 0, open.stderr);
	assert.equal(record('2026/08/2026-08-30--10-00--northwind--weekly-sync.meeting.md').privacy, 'open');
	const restricted = run(root, ['add', 'meetings', '--name', 'Legal review', '--starts', '2026-08-30T11:00:00+03:00', '--company', 'companies/northwind', '--privacy', 'restricted']);
	assert.equal(restricted.status, 0, restricted.stderr);
	assert.equal(record('2026/08/2026-08-30--11-00--northwind--legal-review.meeting.md').privacy, 'restricted');
});

test('description is sensitive, like attendees_raw: a Teams invite carries its passcode there', () => {
	assert.equal(d.fields.description.sensitive, true);
	assert.equal(d.fields.attendees_raw.sensitive, true);
	assert.match(d.fields.description.description, /passcode/);
});

test('the write: line names exactly what the store refuses — name and starts, not company', () => {
	const line = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').split('\n')
		.find((l) => /^\s+write: /.test(l) && /privacy enum\(2\)/.test(l));
	assert.ok(line, 'no write: line for meetings');
	assert.match(line, /write: required name · starts;/);
	assert.equal(d.fields.starts.required, true, 'the descriptor and the write: line must agree that starts is required');
	assert.notEqual(d.fields.company.required, true);
});

test('a meeting with no company is placed by the fallback id; one with no starts is refused', () => {
	const ok = run(root, ['add', 'meetings', '--name', 'Focus block', '--starts', '2026-08-31T08:30:00+03:00']);
	assert.equal(ok.status, 0, ok.stderr);
	assert.ok(fs.existsSync(path.join(root, 'data', 'meetings', '2026/08/2026-08-31--08-30--focus-block.meeting.md')));
	const refused = run(root, ['add', 'meetings', '--name', 'No time']);
	assert.notEqual(refused.status, 0, 'a meeting with no starts was written');
	assert.match(refused.stderr, /starts/);
});
