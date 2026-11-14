// EVERY MODULE IS PUBLISHABLE ALONE (cr-dt-008, task 7; rnd/tests dreamteamer-modules/check-alone-every-module).
//
// `dt check modules/<id> --alone` is the engine's own publish gate: it packs the module (and, offline from this
// repo's modules/, every dependency and every member of a module preset it names), installs that set alone into
// a fresh workspace, compiles and checks it. Run from this repo's root, which the engine reads as a workspace of
// inline modules. Engine 0.49.0 walks preset members, so below it the gate cannot judge core and every case skips.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, moduleIds, run, ENGINE_VERSION } from './helpers/workspace.mjs';
import { engineMeets } from 'dreamteamer/testing';

const skip = !engineMeets('>=0.49.0') && `dt check --alone walks module presets from engine 0.49.0; testing ${ENGINE_VERSION}`;

describe('dt check modules/<id> --alone, for every module of this repo', { concurrency: 4 }, () => {
	for (const m of moduleIds()) {
		test(`${m} is publishable alone`, { skip }, () => {
			const r = run(ROOT, ['check', `modules/${m}`, '--alone']);
			const out = `${r.stdout}\n${r.stderr}`;
			assert.equal(r.status, 0, `exit ${r.status}\n${out}`);
			assert.deepEqual(out.split('\n').filter((l) => /^\s*✖/.test(l)), [], out);
			assert.match(r.stdout, new RegExp(`✔ modules/${m} is publishable`));
		});
	}
});
