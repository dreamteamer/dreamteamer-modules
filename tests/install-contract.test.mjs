// EVERY PACKAGE ON THE CONTRACT — docs/setup-table.md, enforced. Each module is packed once into one
// folder and installed into a fresh workspace on the engine under test, as a person would:
// `dt install @dreamteamer/<m> --from <folder>`; its closure comes from the same folder, never the
// registry. The status line it leaves must be the outcome the table declares.
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, MODULES, moduleIds, pkgOf, packedInto, virginWorkspace, run, cleanup, engineMeets, ENGINE_VERSION } from './helpers/workspace.mjs';

after(cleanup);
const TABLE = fs.readFileSync(path.join(ROOT, 'docs', 'setup-table.md'), 'utf8');
const rows = Object.fromEntries([...TABLE.matchAll(/^\| ([a-z-]+) \| ([^|]*) \| ([^|]*) \|/gm)].filter((m) => m[1] !== 'module').map((m) => [m[1], m[3].trim()]));
const unitFile = (m) => path.join(MODULES, m, 'lib', `${m}-setup.mjs`);
const shipsUnit = (m) => fs.existsSync(unitFile(m)) && /export const SETUP_UNIT\b/.test(fs.readFileSync(unitFile(m), 'utf8'));
let FROM;
before(() => { FROM = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-all-')), ...moduleIds()); });

describe('the table', () => {
	test('names every module of this repo, once, with one of the four outcomes', () => {
		assert.deepEqual(Object.keys(rows).sort(), moduleIds());
		for (const [m, o] of Object.entries(rows)) assert.match(o, /^(unit|no setup|library|preset)/, `${m}: ${o}`);
	});
	test('an outcome of unit means the module ships one; no setup, library and preset mean it ships none', () => {
		for (const m of moduleIds()) {
			const has = shipsUnit(m);
			assert.equal(has, rows[m].startsWith('unit'), `${m}: the table says "${rows[m]}", the module ${has ? 'ships' : 'ships no'} unit`);
		}
	});
	test('an outcome of preset means the module is a module preset (dreamteamer.preset), and only then', () => {
		for (const m of moduleIds()) assert.equal(!!pkgOf(m).dreamteamer?.preset, rows[m].startsWith('preset'), `${m}: the table says "${rows[m]}"`);
	});
});

describe('every package installs on the engine under test and reads as the table says', { skip: !engineMeets('core') && `core, a module preset, needs engine ${pkgOf('core').dreamteamer.engine}; this is ${ENGINE_VERSION}` }, () => {
	for (const m of moduleIds()) {
		test(`${m} → ${rows[m]}`, () => {
			const root = virginWorkspace();
			const env = { HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-HOME-')) };
			// an @dreamteamer package named in plain npm `dependencies` (web and http need protocol, web needs ui) is not
			// in dt install's closure, so npm would fetch it from the registry — where a version this repo has not
			// published yet does not exist. Installed first from the same folder, it is already there when npm looks.
			for (const dep of Object.keys(pkgOf(m).dependencies ?? {}).filter((d) => d.startsWith('@dreamteamer/'))) {
				const pre = run(root, ['install', dep, '--from', FROM, '--no-input'], env);
				assert.ok(pre.status === 0 || pre.status === 3, `${m}: installing ${dep} first: exit ${pre.status}\n${pre.stderr}`);
			}
			const r = run(root, ['install', `@dreamteamer/${m}`, '--from', FROM, '--no-input'], env);
			assert.ok(r.status === 0 || r.status === 3, `${m}: exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-600)}`);
			const s = run(root, ['status', '--json'], env);
			assert.equal(s.status, 0, s.stderr);
			const status = JSON.parse(s.stdout);
			const mine = status.setup.filter((l) => l.package === `@dreamteamer/${m}`);
			assert.ok(mine.length, `${m}: no status line`);
			if (rows[m].startsWith('preset')) {
				// a module preset: no unit of its own; dt status's modules entry lists every member, all installed
				assert.ok(mine.every((l) => !l.unit && l.state === 'no-setup'), `${m}: ${JSON.stringify(mine.map((l) => [l.unit, l.state]))}`);
				const entry = status.modules.find((x) => x.name === `@dreamteamer/${m}`);
				assert.ok(entry?.preset, `${m}: dt status does not read it as a preset`);
				assert.deepEqual(entry.members.map((x) => x.name).sort(), Object.keys(pkgOf(m).dreamteamer.preset).sort());
				assert.ok(entry.members.every((x) => x.installed === x.pinned), `${m}: ${JSON.stringify(entry.members.filter((x) => x.installed !== x.pinned))}`);
			} else if (rows[m].startsWith('unit')) {
				assert.ok(mine.every((l) => l.unit && ['configured', 'blocked', 'ready', 'no-evidence'].includes(l.state)), `${m}: ${JSON.stringify(mine.map((l) => [l.unit, l.state]))}`);
				assert.ok(!mine.some((l) => l.state === 'no-evidence'), `${m}: a unit with zero checks`);
			} else {
				assert.ok(mine.every((l) => !l.unit && l.state === 'no-setup'), `${m}: ${JSON.stringify(mine.map((l) => [l.unit, l.state]))}`);
				if (/needs ([A-Z_]+)/.test(rows[m])) assert.match(mine[0].detail, new RegExp(`needs: .*${/needs ([A-Z_]+)/.exec(rows[m])[1]}`));
			}
		});
	}
});
