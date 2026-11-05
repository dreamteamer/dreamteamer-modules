/**
 * THE RECORD PAGE SAYS WHERE A RECORD COMES FROM, AND ITS REPO STATE, IN ONE LINE (design 2026-10-30,
 * Q1-D + Q2-A/E): the header's commit band ends with `● project-a layer · ahead 1 · uncommitted`; an
 * env-pointed record says `never committed`; a record no commit holds still gets the line. The old
 * "shared from ● project-a" line under the title is gone, so the page names its source once.
 * PageHeader is real; the origin comes through `lib/record-origin.ts` off the payload keys the host
 * sends (`$source`, `$source-kind`, `$repo`, `$dirty`, `$ahead`). Synthetic names only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { find, flush, hasClass, render, text } from './render';
import PageHeader from '../../webview/src/components/PageHeader.vue';
import { recordOrigin } from '../../webview/src/lib/record-origin';

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/tasks/fix-login');
	await r.isReady();
	return r;
}

const COMMIT = { author: 'Dana Oren', message: 'tasks: fix login', date: '2026-10-30T10:00:00+02:00' };
const band = async (origin: ReturnType<typeof recordOrigin>, commit: typeof COMMIT | null = COMMIT) => {
	const root = await render(PageHeader, { icon: 'tasklist', title: 'Fix login', commit, origin }, [await router()]);
	await flush();
	return find(root, (n) => hasClass(n, 'dt-page-commit'));
};
// the render tier's text() joins sibling nodes with no space, so compare with whitespace removed
const squash = (s: string) => s.replace(/\s+/g, '');

test('a layer record: the mark, the kind, ahead and uncommitted — beside the commit', async () => {
	const b = await band(recordOrigin({ $source: 'project-a', '$source-kind': 'layer', $repo: 'git_modules/project-a', $dirty: true, $ahead: 1 }));
	assert.ok(b, 'the band draws');
	const origin = find(b!, (n) => hasClass(n, 'dt-page-commit__origin'))!;
	assert.equal(squash(text(origin)), 'project-alayer·ahead1·uncommitted');
	assert.ok(squash(text(b!)).startsWith('DODanaOrentasks:fixlogin'), 'the commit is still there, first');
	assert.match(String(origin.props['title']), /git_modules\/project-a/);
});

test('an env-pointed record: never committed — and the band draws with no commit at all', async () => {
	const b = await band(recordOrigin({ $source: 'my-hq', '$source-kind': 'own', $repo: null }), null);
	assert.ok(b, 'the band draws for the origin alone');
	assert.equal(squash(text(find(b!, (n) => hasClass(n, 'dt-page-commit__origin'))!)), 'envfolder·nevercommitted');
	assert.doesNotMatch(squash(text(b!)), /nocommitholds/, 'outside every repo: "never committed" says it, nothing more');
});

test('a new workspace record no commit holds yet: says so — only because the engine named its repo', async () => {
	const b = await band(recordOrigin({ $source: 'my-hq', '$source-kind': 'own', $repo: '.', $dirty: true, $ahead: 0 }), null);
	assert.match(squash(text(b!)), /^nocommitholdsthisrecordyet/);
	const compiled = await band(recordOrigin({ $source: 'org', '$source-kind': 'module' }), null);
	assert.doesNotMatch(squash(text(compiled!)), /nocommitholds/, 'no $repo (a compiled kind, an older engine): no claim about commits');
});

test('a clean record of the workspace itself: the mark alone, no state words', async () => {
	const b = await band(recordOrigin({ $source: 'my-hq', '$source-kind': 'own', $repo: '.', $dirty: false, $ahead: 0 }));
	assert.equal(squash(text(find(b!, (n) => hasClass(n, 'dt-page-commit__origin'))!)), 'my-hq');
});

test('an engine without $repo (0.39.1 and older): the origin alone, no guessed repo state', async () => {
	const b = await band(recordOrigin({ $source: 'org', '$source-kind': 'module' }));
	assert.equal(squash(text(find(b!, (n) => hasClass(n, 'dt-page-commit__origin'))!)), 'orgmodule');
});

test('no origin and no commit (create mode): no band', async () => {
	assert.equal(await band(null, null), null);
});
