/**
 * The density menu in the browse header: three choices, the one in force checked, and a pick that
 * WRITES the table's `row_size` over whatever the view or the collection authored — through the
 * same `setListOptions` the drawer uses, keeping the rest of the slice. Rendered, because "the
 * toolbar wins" is a gesture, and a gesture is proved by performing it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ref, type Ref } from 'vue';
import { all, find, flush, hasClass, render, text } from './render';
import DensityMenu from '../../src/components/browse/DensityMenu.vue';

// The menu closes on an outside mousedown and on Escape — listeners on `document`, which this tier
// does not have. A sink is enough: the test drives the handlers on the nodes directly.
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

function fakeState(authored: Record<string, unknown>) {
	const listOptions = ref({ table: authored }) as Ref<Record<string, Record<string, unknown>>>;
	const writes: Array<{ listId: string; values: Record<string, unknown> }> = [];
	return {
		state: {
			listOptions,
			setListOptions(listId: string, values: Record<string, unknown>) {
				writes.push({ listId, values });
				listOptions.value = { ...listOptions.value, [listId]: values };
			},
		},
		writes,
	};
}

const trigger = (root: Parameters<typeof find>[0]) => find(root, (n) => n.tag === 'button' && hasClass(n, 'dt-density__trigger'));
const items = (root: Parameters<typeof all>[0]) => all(root, (n) => n.tag === 'button' && hasClass(n, 'dt-density__item'));
const click = async (n: NonNullable<ReturnType<typeof find>>) => {
	(n.props['onClick'] as () => void)();
	await flush();
};

test('closed by default; the trigger names the density in force', async () => {
	const { state } = fakeState({ row_size: 'comfortable' });
	const root = await render(DensityMenu, { state });
	assert.equal(items(root).length, 0, 'no menu until opened');
	assert.equal(trigger(root)?.props['title'], 'Row density — Comfortable');
});

test('the authored density is the one checked; nothing authored checks cozy', async () => {
	const authored = await render(DensityMenu, { state: fakeState({ row_size: 'compact' }).state });
	await click(trigger(authored)!);
	const checked = items(authored).filter((n) => n.props['aria-checked'] === true || n.props['aria-checked'] === 'true');
	assert.deepEqual(checked.map((n) => text(n).trim()), ['Compact']);
	assert.deepEqual(items(authored).map((n) => text(n).trim()), ['Compact', 'Cozy', 'Comfortable']);

	const bare = await render(DensityMenu, { state: fakeState({}).state });
	await click(trigger(bare)!);
	const checkedBare = items(bare).filter((n) => n.props['aria-checked'] === true || n.props['aria-checked'] === 'true');
	assert.deepEqual(checkedBare.map((n) => text(n).trim()), ['Cozy']);
});

test('a pick writes row_size over the authored value, keeps the rest of the slice, and closes', async () => {
	const { state, writes } = fakeState({ row_size: 'comfortable', group_by: 'team', page_size: 50 });
	const root = await render(DensityMenu, { state });
	await click(trigger(root)!);
	await click(items(root).find((n) => n.props['data-size'] === 'compact')!);
	assert.deepEqual(writes, [{ listId: 'table', values: { row_size: 'compact', group_by: 'team', page_size: 50 } }]);
	assert.equal(items(root).length, 0, 'the menu closed on the pick');
	assert.equal(trigger(root)?.props['title'], 'Row density — Compact', 'and the trigger follows the write');
});
