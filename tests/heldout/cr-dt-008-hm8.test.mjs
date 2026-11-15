// HELD-OUT (cr-dt-008, rnd/tests dreamteamer-modules/heldout-dt008-m-rnd-prototype-cli-root-after-decomposition).
//
// After the composed copies left rnd, npx dt-prototype and rnd's migration bins still resolve the workspace root —
// from the root, from a subdirectory, from an unrelated cwd with the flag each CLI documents — in a packed install
// with no notebooklm, no wikis and no core; rnd contributes no setup unit and only its check; notebooks and wikis
// records are named (not a crash) until those two packages are installed, then validate.
// Written by the test stage from the record's steps and expected; the builder never read it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, BIN, packed, packedFiles, packedInto, pkgOf, closure, virginWorkspace, run, cleanup, engineMeets, ENGINE_VERSION } from '../helpers/workspace.mjs';
import { seedNorthwind, seedJourneys, settle } from '../../modules/rnd/test/helpers/rnd-workspace.mjs';

after(cleanup);
const skip = !engineMeets('rnd') && `rnd 0.11 needs engine ${pkgOf('rnd').dreamteamer.engine}; testing ${ENGINE_VERSION}`;
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const HOME = tmp('dtm-HOME-');
const FIXTURE = path.join(ROOT, 'modules', 'rnd', 'test', 'fixtures', 'prototype-northwind');
const sh = (cmd, args, cwd) => {
	const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120_000, env: { ...process.env, HOME } });
	return { code: r.status, out: `${r.stdout}\n${r.stderr}`, stdout: r.stdout };
};
const MIGRATIONS = ['migrate-change-request-stage.mjs', 'migrate-journey-steps.mjs', 'migrate-personas.mjs', 'migrate-session-bindings.mjs'];

describe('rnd bins after the decomposition', { skip }, () => {
	test('steps 1–5', { timeout: 900_000 }, () => {
		// step 1 — the tarball, and rnd alone from it
		assert.equal(pkgOf('rnd').version, '0.11.0');
		const files = packedFiles('rnd');
		assert.ok(files.includes('lib/workspace-root.mjs'), 'lib/workspace-root.mjs is not in the tarball');
		for (const f of ['SETUP.md', 'compose.json', 'lib/wiki.mjs', 'bin/notebooklm-notebook.mjs', 'bin/wikis-wiki.mjs']) assert.ok(!files.includes(f), `${f} ships`);
		assert.deepEqual(files.filter((f) => f.startsWith('src/')), [], 'src/ ships');
		assert.deepEqual(files.filter((f) => /^lib\/[^/]*-setup\.mjs$/.test(f)), [], 'a lib/*-setup.mjs ships');
		assert.ok(!('provides' in pkgOf('rnd').dreamteamer), 'package.json still declares provides');
		assert.deepEqual(Object.keys(pkgOf('rnd').bin ?? {}).filter((b) => /notebook|wiki/.test(b)), [], 'the bin map names a notebook or wiki entry');
		assert.deepEqual([...closure('rnd')], ['rnd'], 'rnd declares a hard dependency');
		const root = virginWorkspace();
		const tgz = path.join(tmp('dtm-hm8-'), path.basename(packed('rnd')));
		fs.copyFileSync(packed('rnd'), tgz);
		const inst = run(root, ['install', tgz, '--no-input'], { HOME });
		assert.equal(inst.status, 0, `dt install <rnd tarball>: ${inst.stderr}\n${inst.stdout.slice(-800)}`);
		const installed = fs.readdirSync(path.join(root, 'node_modules', '@dreamteamer')).sort();
		assert.deepEqual(installed, ['rnd'], `more than rnd installed: ${installed}`);
		// a prototype to point dt-prototype at, the way prototype-packed.test.mjs drives it
		seedNorthwind(root); seedJourneys(root); settle(root);
		const dir = path.join(root, 'prototypes', 'northwind');
		fs.cpSync(FIXTURE, dir, { recursive: true });
		const binDir = path.join(root, 'node_modules', '@dreamteamer', 'rnd', 'bin');
		const v = sh(process.execPath, [path.join(binDir, 'dt-prototype.mjs'), 'vendor', '--dir', dir], root);
		assert.equal(v.code, 0, `vendor (setup): ${v.out}`);
		// step 2 — three working directories
		const sub = path.join(root, 'data', 'rnd');
		fs.mkdirSync(sub, { recursive: true });
		const elsewhere = tmp('dtm-hm8-elsewhere-');
		const proto = {
			root: sh('npx', ['--no-install', 'dt-prototype', 'check', '--dir', dir], root),
			sub: sh('npx', ['--no-install', 'dt-prototype', 'check', '--dir', dir], sub),
			elsewhere: sh(process.execPath, [path.join(root, 'node_modules', '.bin', 'dt-prototype'), 'check', '--dir', dir], elsewhere),
		};
		for (const [where, r] of Object.entries(proto)) {
			assert.doesNotMatch(r.out, /ERR_MODULE_NOT_FOUND|Cannot find module/, `dt-prototype check from ${where}: ${r.out}`);
			assert.equal(r.code, 0, `dt-prototype check from ${where}: exit ${r.code}\n${r.out}`);
		}
		assert.equal(proto.sub.stdout, proto.root.stdout, 'dt-prototype check answers differently from a subdirectory');
		assert.equal(proto.elsewhere.stdout, proto.root.stdout, 'dt-prototype check answers differently from an unrelated cwd');
		for (const m of MIGRATIONS) {
			const bin = path.join(binDir, m);
			const rs = {
				root: sh(process.execPath, [bin, '--dry-run'], root),
				sub: sh(process.execPath, [bin, '--dry-run'], sub),
				elsewhere: sh(process.execPath, [bin, '--dry-run', '--root', root], elsewhere),
			};
			for (const [where, r] of Object.entries(rs)) {
				assert.doesNotMatch(r.out, /ERR_MODULE_NOT_FOUND|Cannot find module/, `${m} from ${where}: ${r.out}`);
				assert.equal(r.code, 0, `${m} --dry-run from ${where}: exit ${r.code}\n${r.out}`);
			}
			assert.equal(rs.sub.stdout, rs.root.stdout, `${m} resolves another root from a subdirectory`);
			assert.equal(rs.elsewhere.stdout, rs.root.stdout, `${m} resolves another root from an unrelated cwd with --root`);
		}
		// step 3
		const c = run(root, ['compile']);
		assert.equal(c.status, 0, c.stderr);
		const k = run(root, ['check']);
		assert.equal(k.status, 0, `${k.stdout}\n${k.stderr}`);
		const s = run(root, ['setup'], { HOME });
		assert.ok(s.status === 0, `dt setup: exit ${s.status}\n${s.stdout}\n${s.stderr}`);
		assert.doesNotMatch(`${s.stdout}\n${s.stderr}`, /\brnd\b.*unit|notebooklm|wikis/i, `rnd contributes a setup unit:\n${s.stdout}`);
		return import(pathToFileURL(path.join(root, 'node_modules', '@dreamteamer', 'rnd', 'lib', 'extension.mjs')).href).then((ext) => {
			assert.equal(ext.apiVersion, 1);
			assert.deepEqual(Object.keys(ext.default({})), ['check'], 'rnd\'s extension contributes more than its check');
			const compiled = fs.readdirSync(path.join(root, '.dreamteamer', 'collections')).map((f) => f.replace(/\.collection\.yaml$/, ''));
			assert.ok(!compiled.includes('notebooks') && !compiled.includes('wikis'), 'notebooks or wikis compiled without their packages');
			// step 4
			fs.mkdirSync(path.join(root, 'data', 'notebooks'), { recursive: true });
			fs.writeFileSync(path.join(root, 'data', 'notebooks', 'northwind-research.notebook.md'), '---\nname: Northwind research\n---\nThe corpus Dana Oren reads before a Northwind call.\n');
			fs.mkdirSync(path.join(root, 'data', 'wikis'), { recursive: true });
			fs.writeFileSync(path.join(root, 'data', 'wikis', 'northwind-handbook.wiki.md'), '---\nname: Northwind handbook\nfolder: wikis/northwind-handbook\n---\n');
			fs.mkdirSync(path.join(root, 'wikis', 'northwind-handbook'), { recursive: true });
			fs.writeFileSync(path.join(root, 'wikis', 'northwind-handbook', 'index.md'), '# Northwind handbook\n');
			const k1 = run(root, ['check']);
			const o1 = `${k1.stdout}\n${k1.stderr}`;
			assert.doesNotMatch(o1, /\n\s+at .+:\d+:\d+\)?\n|TypeError|ReferenceError/, `dt check crashed:\n${o1}`);
			// the naming is asserted last, so steps 4b and 5 still run and report
			const named = [/northwind-research/.test(o1) || `the notebooks record is not named by dt check:\n${o1}`, /northwind-handbook/.test(o1) || `the wikis record is not named by dt check:\n${o1}`].filter((x) => x !== true);
			const folder = packedInto(tmp('dtm-hm8-nw-'), ...new Set([...closure('notebooklm'), ...closure('wikis')]));
			const i2 = run(root, ['install', '@dreamteamer/notebooklm', '@dreamteamer/wikis', '--from', folder, '--no-input'], { HOME });
			assert.equal(i2.status, 0, `${i2.stderr}\n${i2.stdout.slice(-800)}`);
			const k2 = run(root, ['check']);
			assert.equal(k2.status, 0, `${k2.stdout}\n${k2.stderr}`);
			assert.match(k2.stdout + k2.stderr, /0 violations/);
			// step 5 — rnd publishable alone, in the modules repo, on the candidate engine
			const alone = run(ROOT, ['check', 'modules/rnd', '--alone']);
			assert.equal(alone.status, 0, `dt check modules/rnd --alone: ${alone.stdout}\n${alone.stderr}`);
			assert.match(alone.stdout, /✔ modules\/rnd is publishable/);
			assert.deepEqual(named, [], 'step 4: the first check does not report the two records as records of no collection');
		});
	});
});
