// Tier 1 — ONE template grammar, two implementations, one set of vectors.
//
// The engine owns the grammar (`src/template.js`, descriptor format v2 §3.7) and exports
// `renderDisplay`; the webview carries a PORT (`webview/src/lib/template.ts`) because card and band
// templates are layout options rendered live against rows the webview already holds. Two
// implementations of one grammar are the drift this file exists to catch: every vector in
// `test/fixtures/template-vectors.json` runs through BOTH, and both must produce the vector's
// `expect` — or both must refuse it.
//
// The engine half runs against the real engine (`DT_ENGINE`, `engine-under-test.ts`); the port half
// runs everywhere, so a contributor with no engine checkout still has the port pinned.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vectors from '../fixtures/template-vectors.json';
import { renderDisplay, parseTemplate, templateFields, tryRenderDisplay } from '@dreamteamer/ui/src/lib/template';
import { ENGINE, NO_ENGINE } from './engine-under-test';

interface Vector {
	name: string;
	template: string;
	record: Record<string, unknown>;
	references?: string[];
	titles?: Record<string, string>;
	expect?: string;
	throws?: string;
}

type Render = (tpl: string, record: Record<string, unknown>, opts?: object) => string;

function optsOf(v: Vector) {
	if (!v.references) return {};
	const refs = v.references;
	const titles = v.titles ?? {};
	return { resolve: (r: string) => titles[r], isReference: (f: string) => refs.includes(f) };
}

function runAll(render: Render): void {
	for (const v of vectors as Vector[]) {
		test(v.name, () => {
			if (v.throws !== undefined) {
				assert.throws(() => render(v.template, v.record, optsOf(v)), /unknown template filter "upper"/);
				return;
			}
			assert.equal(render(v.template, v.record, optsOf(v)), v.expect);
		});
	}
}

describe('the webview port renders every vector', () => {
	runAll(renderDisplay as Render);
});

describe('the engine renders every vector', { skip: NO_ENGINE }, async () => {
	const api = await import(pathToFileURL(path.join(ENGINE as string, 'src', 'api.js')).href);
	runAll(api.renderDisplay as Render);

	test('and parses a template into the same parts as the port', () => {
		for (const v of vectors as Vector[]) assert.deepEqual(parseTemplate(v.template), api.parseTemplate(v.template), v.template);
	});
});

describe('the port, beyond what the engine exports', () => {
	test('templateFields lists every named field, built-ins included', () => {
		assert.deepEqual(templateFields('{{ reason }} · {{ date | date }} · {{ id }}'), ['reason', 'date', 'id']);
	});

	test('tryRenderDisplay answers null where renderDisplay throws — a template typed live cannot break a card', () => {
		assert.equal(tryRenderDisplay('{{ name | upper }}', { name: 'x' }), null);
		assert.equal(tryRenderDisplay('{{ name }}', { name: 'x' }), 'x');
	});
});
