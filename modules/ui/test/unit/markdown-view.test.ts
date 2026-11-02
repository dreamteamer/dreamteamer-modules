// Tier 1 — why a markdown field printed its own source, right-to-left text backwards; and which
// component the display contract's field rows resolve to.
//
// A markdown field once resolved to the ultimate `text` fallback and rendered `**status:** todo`
// verbatim, in a dir=ltr webview that put every neutral character of an RTL line at the wrong end of
// it. The contract now says `type: markdown` outright (descriptor v2 §4.3), and the page field says
// `role: body`.
//
// Both halves are pinned here: WHICH View (and Edit) a row resolves to — including an authored
// `viewer`/`editor` id the build does not have, which falls back to the type's default and says so
// in the console, never in the form — and what the cell form of a markdown value actually reads as.
//
// ⚠ RTL fixtures are ARABIC, deliberately. This repo is public and its leak gate refuses Hebrew
// codepoints in tracked files (a proxy for "vault content escaped into the code repo"), but bidi
// is bidi: Arabic exercises the same first-strong-character path, and the vault's own records are
// the thing the gate is protecting.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldRow } from '../../src/api/types';
import { edits, views, kindDefaultViews } from '../../src/registry';
import { resolveEdit, resolveView } from '../../src/registry/resolve';
import { fieldRow } from './field-rows';
import { mdToPlainText, renderMd } from '../../src/lib/render-md';

// Registering the real SFCs would drag esbuild through .vue files; resolution only ever reads ids,
// so stand-ins are enough to answer "which entry comes back".
const stub = (id: string) => ({ id, name: id, component: {} as never, types: [] });
for (const id of ['text', 'markdown', 'json', 'boolean', 'date']) views.register(stub(id));

for (const id of ['input', 'textarea', 'json', 'tags', 'list', 'nested', 'relation-picker', 'select-dropdown', 'markdown-body', 'input-number']) edits.register(stub(id));
for (const id of ['tags', 'list', 'nested', 'relation', 'label']) views.register(stub(id));

const field = (over: Partial<FieldRow> = {}): FieldRow => fieldRow('f', { collection: 'c', ...over });

/** Run `fn` with console.warn captured; returns what it said. */
function warnings(fn: () => void): string[] {
	const said: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => void said.push(args.map(String).join(' '));
	try {
		fn();
	} finally {
		console.warn = original;
	}
	return said;
}

describe('resolveView — a markdown field reaches the markdown View', () => {
	test('a non-body `markdown` field renders as markdown on the record page', () => {
		const row = field({ field: 'assistant_recommended_next_step', type: 'markdown' });
		assert.equal(resolveView(row, 'record').entry.id, 'markdown');
	});

	test('…and in a CELL too — ViewMarkdown owns the one-line form, so row heights are its problem', () => {
		assert.equal(resolveView(field({ type: 'markdown' }), 'cell').entry.id, 'markdown');
	});

	test('the body role resolves to markdown on the record page', () => {
		const row = field({ field: 'description', type: 'markdown', role: 'body' });
		assert.equal(resolveView(row, 'record').entry.id, 'markdown');
	});

	test('a plain `string` field is untouched — it is NOT markdown and must stay on ViewText', () => {
		assert.equal(resolveView(field({ type: 'string' }), 'record').entry.id, 'text');
		assert.equal(kindDefaultViews['string'], undefined);
	});

	test('an authored `viewer` outranks the type default', () => {
		const row = field({ type: 'markdown', viewer: 'json' });
		assert.equal(resolveView(row, 'record').entry.id, 'json');
	});

	test('an unknown `viewer` falls back to the type default, says so in the console, and badges nothing', () => {
		let resolved!: ReturnType<typeof resolveView>;
		const said = warnings(() => {
			resolved = resolveView(field({ field: 'notes', type: 'markdown', viewer: 'map-pin' }), 'record');
		});
		assert.equal(resolved.entry.id, 'markdown');
		assert.equal(said.length, 1);
		assert.match(said[0] ?? '', /c\.notes names viewer 'map-pin'/);
	});
});

describe('resolveEdit — the shape decides the control', () => {
	test('the wire types reach their controls by their authored names', () => {
		assert.equal(resolveEdit(field({ type: 'markdown' })).entry.id, 'textarea');
		assert.equal(resolveEdit(field({ type: 'number' })).entry.id, 'input-number');
		assert.equal(resolveEdit(field({ type: 'object' })).entry.id, 'json');
		assert.equal(resolveEdit(field({ type: 'map' })).entry.id, 'json');
	});

	test('the body, a reference, an enum, a list and an object with sub-fields each get their own', () => {
		assert.equal(resolveEdit(field({ type: 'markdown', role: 'body' })).entry.id, 'markdown-body');
		assert.equal(resolveEdit(field({ role: 'reference' })).entry.id, 'relation-picker');
		assert.equal(resolveEdit(field({ role: 'reference_many', many: true })).entry.id, 'relation-picker');
		assert.equal(resolveEdit(field({ editor_options: { choices: [{ label: 'A', value: 'a' }] } })).entry.id, 'select-dropdown');
		assert.equal(resolveEdit(field({ many: true })).entry.id, 'tags');
		assert.equal(resolveEdit(field({ type: 'object', many: true })).entry.id, 'list');
		assert.equal(resolveEdit(field({ type: 'object', editor_options: { fields: [fieldRow('street')] } })).entry.id, 'nested');
		assert.equal(resolveView(field({ type: 'object', many: true })).entry.id, 'list');
		assert.equal(resolveView(field({ many: true })).entry.id, 'tags');
	});

	test('an unknown `editor` draws the type default and warns in the console only', () => {
		let resolved!: ReturnType<typeof resolveEdit>;
		const said = warnings(() => {
			resolved = resolveEdit(field({ field: 'where', editor: 'map-picker' }));
		});
		assert.equal(resolved.entry.id, 'input');
		assert.deepEqual(said.length, 1);
		assert.match(said[0] ?? '', /c\.where names editor 'map-picker'.*string default/);
	});
});

describe('mdToPlainText — the cell form', () => {
	test('inline markers are stripped, the words survive', () => {
		assert.equal(mdToPlainText('**status:** todo · 1,680 *deliberate*'), 'status: todo · 1,680 deliberate');
	});

	test('an RTL value keeps its own characters and loses only the markup', () => {
		assert.equal(mdToPlainText('**الحالة:** todo'), 'الحالة: todo');
	});

	test('a link keeps its label and drops its href', () => {
		assert.equal(mdToPlainText('see [the record](tasks/2026-08-30--x) now'), 'see the record now');
	});

	test('inline code keeps its contents verbatim, asterisks and all', () => {
		assert.equal(mdToPlainText('run `trading-ing*GMF*` today'), 'run trading-ing*GMF* today');
	});

	test('block markers go: heading, quote, bullet, ordered, task', () => {
		assert.equal(mdToPlainText('## Head\n> quoted\n- one\n2. two\n- [x] done'), 'Head quoted one two done');
	});

	test('paragraphs join into ONE line — a cell has one line', () => {
		assert.equal(mdToPlainText('first para\n\nsecond para'), 'first para second para');
	});

	test('a fenced block is dropped whole rather than pasted in as noise', () => {
		assert.equal(mdToPlainText('before\n```\nconst x = 1;\n```\nafter'), 'before after');
	});

	test('a table becomes a middot run, and its separator row vanishes', () => {
		assert.equal(mdToPlainText('| a | b |\n|---|---|\n| 1 | 2 |'), 'a · b 1 · 2');
	});

	test('a horizontal rule leaves nothing behind', () => {
		assert.equal(mdToPlainText('one\n\n---\n\ntwo'), 'one two');
	});

	test('null/undefined are empty, not "null"', () => {
		assert.equal(mdToPlainText(null), '');
		assert.equal(mdToPlainText(undefined), '');
	});
});

describe('renderMd — every block decides its own direction', () => {
	test('a paragraph carries dir=auto, so an RTL line resolves its neutrals against an RTL base', () => {
		const [p] = renderMd('الحالة: todo, 1,680.') as { props?: Record<string, unknown> }[];
		assert.equal(p?.props?.['dir'], 'auto');
	});

	test('a blockquote gets an EXPLICIT dir — `auto` skips children that carry their own', () => {
		const [q] = renderMd('> الحالة') as { props?: Record<string, unknown> }[];
		assert.equal(q?.props?.['dir'], 'rtl');
	});
});
