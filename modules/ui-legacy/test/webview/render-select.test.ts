/**
 * THE RENDER TIER OPENS A DROPDOWN (cr-vscode-010). A module choice became a `DtSelect`, and a test of
 * what the form offers has to reach the options a person sees — through the panel they open, never
 * through a component's props, which this tier does not expose. Opening one used to fail three ways:
 * `document`/`window` listeners on open, the search input's `v-model` calling `el.addEventListener` on
 * a `TestNode` above the search threshold, and `focus` on the control after a pick. The harness now
 * gives element nodes no-op DOM methods and installs the two globals; this file pins that a 14-choice
 * dropdown — above the threshold — opens, lists every option and reaches its emit. Synthetic values.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { defineComponent, h, ref } from 'vue';
import { all, find, flush, installDomShims, openSelect, pickOption, render, text, unmountAll } from './render';
import DtSelect from '../../src/components/DtSelect.vue';
import { SEARCH_THRESHOLD } from '../../src/lib/listbox';

installDomShims();
afterEach(() => unmountAll());

const CHOICES = Array.from({ length: 14 }, (_, i) => ({ value: `m${i}`, text: `Module ${i}` }));

function host(seen: unknown[]) {
	return defineComponent({
		setup() {
			const value = ref<unknown>(null);
			return () => h(DtSelect, {
				modelValue: value.value,
				choices: CHOICES,
				ariaLabel: 'Module',
				'onUpdate:modelValue': (v: unknown) => { value.value = v; seen.push(v); },
			});
		},
	});
}

test('a dropdown above the search threshold opens to every option, with its search box', async () => {
	assert.ok(CHOICES.length > SEARCH_THRESHOLD, 'the fixture is above the threshold, so the search input mounts');
	const root = await render(host([]));
	const options = await openSelect(root, 'Module');
	assert.equal(options.length, 14);
	assert.equal(all(root, (n) => n.tag === 'input' && n.props['aria-label'] === 'Search options').length, 1);
});

test('picking an option by its label emits its value and closes the panel', async () => {
	const seen: unknown[] = [];
	const root = await render(host(seen));
	await pickOption(root, 'Module', 'Module 8');
	assert.deepEqual(seen, ['m8']);
	assert.equal(all(root, (n) => n.props['role'] === 'option').length, 0, 'the panel is shut after the pick');
	const control = find(root, (n) => n.props['role'] === 'combobox')!;
	assert.match(text(control), /Module 8/, 'and the control reads the picked label');
});

test('opening twice leaves the panel open — the helper never toggles it shut', async () => {
	const root = await render(host([]));
	await openSelect(root, 'Module');
	const again = await openSelect(root, 'Module');
	assert.equal(again.length, 14);
});

test('unmounting with the panel open throws nothing', async () => {
	const root = await render(host([]));
	await openSelect(root, 'Module');
	assert.doesNotThrow(() => unmountAll());
	await flush();
});
