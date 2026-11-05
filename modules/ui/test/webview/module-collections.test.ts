/**
 * A module opens on THE record page now (operator 2026-10-29: the hand-built module form — comma text,
 * a Save at the bottom — was not how a record edits). What only a module has rides under that page:
 * New collection… aimed at it, disabled where a write cannot survive. Rendered against the host stub,
 * so the module list comes through the real adapter and composable.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { onHostRequest, resetHost } from './host-stub';
import { find, flush, hasClass, render, text } from './render';
import ModuleCollections from '../../webview/src/components/ModuleCollections.vue';

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/settings/schema/modules/project-alpha');
	await r.isReady();
	return r;
}

test('New collection… is offered under a module page — and disabled for a node_modules one, saying why', async () => {
	resetHost();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { modules: [{ name: 'project-alpha', location: 'git_modules' }, { name: 'tasks', location: 'node_modules' }] };
		if (method === 'GET' && path.startsWith('/collections/modules/records')) {
			return { records: [{ id: 'project-alpha', name: 'project-alpha' }, { id: 'tasks', name: 'tasks' }], total: 2, sources: [] };
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
	const button = (root: Parameters<typeof find>[0]) => find(root, (n) => n.tag === 'button' && hasClass(n, 'dt-btn'))!;

	const own = await render(ModuleCollections, { moduleId: 'project-alpha' }, [await router()]);
	await flush();
	assert.match(text(button(own)), /New collection in this module/);
	assert.notEqual(button(own).props['disabled'], true, 'a git_modules module takes a new collection');

	const npm = await render(ModuleCollections, { moduleId: 'tasks' }, [await router()]);
	await flush();
	assert.equal(button(npm).props['disabled'], true);
	assert.match(String(button(npm).props['title']), /npm install/);
});
