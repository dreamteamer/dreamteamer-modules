// A virgin workspace holding meeting-docs and its dependency closure, with fixture records written
// through the engine. Shared by the gate and id tests in this folder.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { virginWorkspace, closure, run, compileAndCheck, MODULES } from '../../../tests/helpers/workspace.mjs';

/** Does the `meetings` module in this tree declare `privacy`? When it does not, the workspace gets a
 *  test-only overlay carrying the same field, so the gate can be measured before that module ships it. */
export function meetingsDeclaresPrivacy() {
	const d = yaml.load(fs.readFileSync(path.join(MODULES, 'meetings', 'collections', 'meetings.collection.yaml'), 'utf8'));
	return Boolean(d.fields?.privacy);
}

function addPrivacyOverlay(root) {
	const mod = path.join(root, 'modules', 'default');
	fs.mkdirSync(path.join(mod, 'collections'), { recursive: true });
	fs.writeFileSync(path.join(mod, 'collections', 'meetings.collection.yaml'), [
		'name: meetings',
		'overlay: true',
		'fields:',
		'  privacy:',
		'    type: string',
		'    enum: [open, restricted]',
		'    default: open',
		'    description: test overlay — the field the meetings module declares',
		'',
	].join('\n'));
	const pkgFile = path.join(mod, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
	pkg.dreamteamer = { ...pkg.dreamteamer, dependencies: ['@dreamteamer/meetings'] };
	fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, '\t') + '\n');
}

/** A compiled workspace with meeting-docs installed through `install` (one of CHANNELS). */
export function workspace(install) {
	const root = virginWorkspace();
	install(root, [...closure('meeting-docs')]);
	const overlay = !meetingsDeclaresPrivacy();
	if (overlay) addPrivacyOverlay(root);
	compileAndCheck(root);
	return { root, overlay };
}

/** Run a dt verb that must succeed; returns the repo-relative path it reports writing, if any. */
export function dt(root, args) {
	const r = run(root, args);
	assert.equal(r.status, 0, `dt ${args.join(' ')}\n${r.stderr}\n${r.stdout}`);
	return /· (data\/\S+)/.exec(r.stdout + r.stderr)?.[1];
}

/** `data/<collection>/<id>.<suffix>.md` → `<id>`. */
export const idOf = (file, collection) => file.replace(`data/${collection}/`, '').replace(/\.[a-z-]+\.md$/, '');

/** Edit a record's frontmatter text in place, the way a transcriber script writes its block. */
export function editFrontmatter(root, file, fn) {
	const p = path.join(root, file);
	const text = fs.readFileSync(p, 'utf8');
	const end = text.indexOf('\n---', 4);
	fs.writeFileSync(p, fn(text.slice(0, end)) + text.slice(end));
}

/** A meeting with one transcribed recording. `privacy` is a value, or `null` for a record that
 *  predates the field (no key at all). Returns the meeting id. */
export function transcribedMeeting(root, { name, starts, company, privacy }) {
	const args = ['add', 'meetings', '--name', name, '--starts', starts, '--company', company];
	if (privacy) args.push('--privacy', privacy);
	const file = dt(root, args);
	if (privacy === null) editFrontmatter(root, file, (fm) => fm.replace(/\nprivacy: .*/, ''));
	const id = idOf(file, 'meetings');
	const rec = dt(root, ['add', 'meeting-recordings', '--name', `${name} recording`, '--date', starts, '--meeting', `meetings/${id}`]);
	editFrontmatter(root, rec, (fm) => `${fm}\ntranscription:\n  generated: '2026-09-02'\n  language: en\n  speaker_count: 2\n  speakers:\n    speaker_0: Dana Oren\n    speaker_1: Sam Diaz`);
	return id;
}

/** `dt next meetings/<id>` as { command name → state }. */
export function nextStates(root, id) {
	const r = run(root, ['next', `meetings/${id}`, '--json']);
	assert.equal(r.status, 0, r.stderr + r.stdout);
	const out = JSON.parse(r.stdout);
	return Object.fromEntries(out.commands.filter((c) => c.scope === 'record').map((c) => [c.name, c.states[id]]));
}
