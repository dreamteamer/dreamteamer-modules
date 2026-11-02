// PROTOCOL.md's Module apps section names every route a module scope may call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTES } from '../src/routes.js';
import { MODULE_ROUTES } from '../src/module-scope.js';

test('every module-scope route is named in PROTOCOL.md § Module apps', () => {
	const doc = readFileSync(new URL('../PROTOCOL.md', import.meta.url), 'utf8');
	const section = doc.slice(doc.indexOf('## Module apps'));
	assert.ok(section.length > 20, 'the section exists');
	for (const id of MODULE_ROUTES) {
		const r = ROUTES.find((x) => x.id === id);
		assert.ok(r, id);
		assert.ok(section.includes(`${r.method} ${r.pattern}`), `${r.method} ${r.pattern}`);
	}
});
