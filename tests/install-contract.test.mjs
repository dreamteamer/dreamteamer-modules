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
const composedUnits = (m) => { try { return JSON.parse(fs.readFileSync(path.join(MODULES, m, 'compose.json'), 'utf8')).setup_units ?? []; } catch { return []; } };
let FROM;
before(() => { FROM = packedInto(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-all-')), ...moduleIds()); });

describe('the table', () => {
	test('names every module of this repo, once, with one of the three outcomes', () => {
		assert.deepEqual(Object.keys(rows).sort(), moduleIds());
		for (const [m, o] of Object.entries(rows)) assert.match(o, /^(unit|no setup|library)/, `${m}: ${o}`);
	});
	test('an outcome of unit means the module ships one (or composes some); no setup and library mean it ships none', () => {
		for (const m of moduleIds()) {
			const has = shipsUnit(m) || composedUnits(m).length > 0;
			assert.equal(has, rows[m].startsWith('unit'), `${m}: the table says "${rows[m]}", the module ${has ? 'ships' : 'ships no'} unit`);
		}
	});
});

describe('every package installs on the engine under test and reads as the table says', { skip: !engineMeets('core') && `needs engine >=0.47.0, this is ${ENGINE_VERSION}` }, () => {
	for (const m of moduleIds()) {
		test(`${m} → ${rows[m]}`, () => {
			const root = virginWorkspace();
			const env = { HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-HOME-')) };
			const r = run(root, ['install', `@dreamteamer/${m}`, '--from', FROM, '--no-input'], env);
			assert.ok(r.status === 0 || r.status === 3, `${m}: exit ${r.status}\n${r.stderr}\n${r.stdout.slice(-600)}`);
			const s = run(root, ['status', '--json'], env);
			assert.equal(s.status, 0, s.stderr);
			const lines = JSON.parse(s.stdout).setup;
			const mine = lines.filter((l) => l.package === `@dreamteamer/${m}`);
			assert.ok(mine.length, `${m}: no status line`);
			if (rows[m].startsWith('unit')) {
				assert.ok(mine.every((l) => l.unit && ['configured', 'blocked', 'ready', 'no-evidence'].includes(l.state)), `${m}: ${JSON.stringify(mine.map((l) => [l.unit, l.state]))}`);
				assert.ok(!mine.some((l) => l.state === 'no-evidence'), `${m}: a unit with zero checks`);
			} else {
				assert.ok(mine.every((l) => !l.unit && l.state === 'no-setup'), `${m}: ${JSON.stringify(mine.map((l) => [l.unit, l.state]))}`);
				if (/needs ([A-Z_]+)/.test(rows[m])) assert.match(mine[0].detail, new RegExp(`needs: .*${/needs ([A-Z_]+)/.exec(rows[m])[1]}`));
			}
		});
	}
});
