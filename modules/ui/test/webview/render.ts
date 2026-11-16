/**
 * TIER 2 — the webview RENDER tier, and why it had to exist.
 *
 * Tier 1 stubs every `.vue` file (`scripts/test.mjs`) and tier 3 asserts inside the extension host,
 * where no component exists. So NOTHING asserted what a control actually renders — and that gap
 * shipped a live defect under a green suite: tier 3's "revert is refused" test asserted that
 * `api.handle` answers ≥400 and that `/presentation` carries `meta.readonly` + `readonly_hint`, and
 * passed happily while the rendered Restore button was enabled, opened a confirm, and swallowed the
 * refusal whole. A test that asserts a projection is CARRIED is not a test that it is CONSUMED.
 *
 * The renderer is Vue's own `createRenderer` over a plain object tree — no DOM, no jsdom, no new
 * dependency. That buys the client lifecycle tier 1 cannot have (`onMounted` fires, so a component
 * that loads its own data loads it) and the attribute-level inspection an SSR string cannot give
 * (`disabled` and `title` as VALUES, not as substrings of markup).
 *
 * What it cannot do: anything that reaches for `document`, `window` or layout. A component under
 * test here must be one whose decision is expressible in its own props and state — which is the
 * same discipline that keeps `nav.ts` and `titles.ts` testable in tier 1.
 */
import { createRenderer, nextTick, type App, type Component } from 'vue';

export interface TestNode {
	tag: string;
	props: Record<string, unknown>;
	children: Array<TestNode | string>;
	parent: TestNode | null;
}

/**
 * The DOM methods a component reaches for on its OWN elements — a `v-model` input's listeners, a
 * control's `focus` after a pick, a panel's `querySelector`/`scrollIntoView`, a rect to place a panel
 * against. No-ops here, and NON-ENUMERABLE, so they never show up in `props` or in a structural
 * comparison. Without them a `DtSelect` could not be opened in this tier (cr-vscode-010): above its
 * search threshold the search input's `v-model` threw `el.addEventListener is not a function`.
 */
const NOOP = (): void => {};
/** Every element a component focused, in order — `focus` is otherwise a no-op here, so a test of "the field is
 *  focused when it opens" reads this. */
export const focused: unknown[] = [];
const ELEMENT_METHODS: Record<string, unknown> = {
	addEventListener: NOOP,
	removeEventListener: NOOP,
	focus(this: unknown) { focused.push(this); },
	blur: NOOP,
	scrollIntoView: NOOP,
	querySelector: () => null,
	getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }),
};

/**
 * `querySelectorAll` for the attribute and class selectors a component asks its OWN elements for (DtMenu finds its items
 * with `[role="menuitem"], …`): a comma list of compounds, each an optional tag, `.class`es and `[attr]` /
 * `[attr="value"]`. Anything else matches nothing. `getAttribute` reads a prop the way the DOM reads an attribute, and
 * `textContent` is the visible words — both non-enumerable like the methods above.
 */
function matchesCompound(n: TestNode, compound: string): boolean {
	const m = /^([a-z][a-z0-9-]*)?((?:\.[\w-]+|\[[^\]]+\])*)$/i.exec(compound.trim());
	if (!m) return false;
	if (m[1] && n.tag !== m[1]) return false;
	for (const part of m[2]!.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []) {
		if (part.startsWith('.')) {
			if (!String(n.props['class'] ?? '').split(/\s+/).includes(part.slice(1))) return false;
			continue;
		}
		const a = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
		if (!a) return false;
		const v = n.props[a[1]!];
		if (v == null || v === false) return false;
		if (a[2] !== undefined && String(v) !== a[2]) return false;
	}
	return true;
}
function querySelectorAll(this: TestNode, selector: string): TestNode[] {
	const compounds = selector.split(',');
	const out: TestNode[] = [];
	const walk = (x: TestNode): void => {
		for (const c of x.children) {
			if (typeof c === 'string' || c.tag.startsWith('#')) continue;
			if (compounds.some((k) => matchesCompound(c, k))) out.push(c);
			walk(c);
		}
	};
	walk(this);
	return out;
}
function getAttribute(this: TestNode, name: string): string | null {
	const v = this.props[name];
	return v == null || v === false ? null : String(v);
}

function node(tag: string): TestNode {
	const n: TestNode = { tag, props: {}, children: [], parent: null };
	for (const [key, value] of Object.entries(ELEMENT_METHODS)) Object.defineProperty(n, key, { value, enumerable: false, writable: true, configurable: true });
	Object.defineProperty(n, 'querySelectorAll', { value: querySelectorAll, enumerable: false, writable: true, configurable: true });
	Object.defineProperty(n, 'getAttribute', { value: getAttribute, enumerable: false, writable: true, configurable: true });
	Object.defineProperty(n, 'textContent', { get() { return text(n); }, enumerable: false, configurable: true });
	// What Vue's <Transition> / <TransitionGroup> reach for on an element (the toast stack animates in and out): a class
	// list that keeps the transition classes apart from `class`, a style object, a node type, a parent, a clone to measure
	// and a document to force a reflow on. A test that mounts one also gives `window` a getComputedStyle with no
	// durations and the global a requestAnimationFrame, so every transition ends at once.
	const transitionClasses = new Set<string>();
	const hidden: Record<string, unknown> = {
		classList: { add: (c: string) => void transitionClasses.add(c), remove: (c: string) => void transitionClasses.delete(c), contains: (c: string) => transitionClasses.has(c) },
		style: {},
		nodeType: tag === '#text' ? 3 : tag === '#comment' ? 8 : 1,
		cloneNode: () => node(tag),
		appendChild: (c: TestNode) => insert(c, n, null),
		removeChild: (c: TestNode) => remove(c),
		ownerDocument: { body: { offsetHeight: 0 } },
	};
	for (const [key, value] of Object.entries(hidden)) Object.defineProperty(n, key, { value, enumerable: false, writable: true, configurable: true });
	Object.defineProperty(n, 'parentNode', { get() { return n.parent; }, enumerable: false, configurable: true });
	return n;
}

/**
 * Where a `<Teleport>` lands. reka-ui's dialogs portal to `body`, and Vue resolves a string target
 * through the renderer's own `querySelector` — absent, it hands the insert a null container and the
 * mount dies. So teleported content goes into ONE detached node: off the tree the assertions walk,
 * which is exactly where an unopened dialog belongs.
 */
const teleported = node('#teleported');

function insert(child: TestNode | string, parent: TestNode, anchor: TestNode | string | null): void {
	// Detach FIRST, then reparent — an insert is also how Vue MOVES a node, and dropping it from its
	// old parent after claiming the new one leaves it in both (a v-for reorder then renders twice).
	remove(child);
	if (typeof child !== 'string') child.parent = parent;
	const at = anchor == null ? -1 : parent.children.indexOf(anchor);
	parent.children.splice(at < 0 ? parent.children.length : at, 0, child);
}

function remove(child: TestNode | string): void {
	if (typeof child === 'string') return;
	const parent = child.parent;
	if (!parent) return;
	const at = parent.children.indexOf(child);
	if (at >= 0) parent.children.splice(at, 1);
	child.parent = null;
}

/**
 * `text` and `comment` nodes are objects rather than raw strings, because Vue mutates a text node
 * in place (`setText`) and identifies anchors by reference — a bare string would collide with any
 * other equal string in the same parent.
 */
const { createApp } = createRenderer<TestNode | string, TestNode>({
	createElement: (tag) => node(tag),
	createText: (t) => Object.assign(node('#text'), { props: { text: t } }),
	createComment: (t) => Object.assign(node('#comment'), { props: { text: t } }),
	setText: (n, t) => {
		if (typeof n !== 'string') n.props['text'] = t;
	},
	setElementText: (n, t) => {
		n.children = [Object.assign(node('#text'), { props: { text: t }, parent: n })];
	},
	insert: (child, parent, anchor) => insert(child, parent ?? teleported, anchor ?? null),
	querySelector: () => teleported,
	remove,
	parentNode: (n) => (typeof n === 'string' ? null : n.parent),
	nextSibling: (n) => {
		if (typeof n === 'string' || !n.parent) return null;
		return n.parent.children[n.parent.children.indexOf(n) + 1] ?? null;
	},
	patchProp: (el, key, _prev, next) => {
		if (key.startsWith('on')) el.props[key] = next;
		else if (next == null || next === false) delete el.props[key];
		else el.props[key] = next;
	},
});

/** Every app `render` mounted, so a file whose tests leave live trees behind can tear them down. */
const mounted: App[] = [];

/** Unmount every tree `render` mounted — for an `afterEach` in a file whose tests interact (a click
 *  that changes state) and must not leave a reactive tree answering the next test's host changes. */
export function unmountAll(): void {
	while (mounted.length) mounted.pop()!.unmount();
}

/**
 * Mount `component` and let every microtask its `onMounted` started settle. `plugins` are installed
 * before the mount — a page component reading `useRoute` needs a router, and that is a fact about
 * the component, not something the harness should guess.
 */
export async function render(
	component: Component,
	props?: Record<string, unknown>,
	plugins: Array<{ install: (app: App) => void }> = [],
): Promise<TestNode> {
	const root = node('#root');
	const app = createApp(component, props);
	for (const plugin of plugins) app.use(plugin);
	// A component that throws inside its own update is otherwise a Vue warning on stderr and a test
	// that reads the pre-error render as the answer.
	app.config.errorHandler = (err) => {
		throw err;
	};
	app.mount(root);
	mounted.push(app);
	await flush();
	return root;
}

/**
 * Settle everything a mount started. `setImmediate` drains the WHOLE microtask queue, which counting
 * `await Promise.resolve()` rounds does not: a component's data load runs through the client, the
 * adapter and the transport stub, and each `await` on that chain costs its own tick — so a
 * fixed round count silently under-flushes and the test reads an empty list as the component's
 * answer. Then `nextTick` for the render that the resolved data scheduled.
 */
export async function flush(): Promise<void> {
	for (let i = 0; i < 3; i++) {
		await new Promise((resolve) => setImmediate(resolve));
		await nextTick();
	}
}

/** Depth-first, document order — so `all()[0]` is the first match on screen. */
export function all(root: TestNode, predicate: (n: TestNode) => boolean): TestNode[] {
	const out: TestNode[] = [];
	const walk = (n: TestNode): void => {
		if (predicate(n)) out.push(n);
		for (const child of n.children) if (typeof child !== 'string') walk(child);
	};
	walk(root);
	return out;
}

export function find(root: TestNode, predicate: (n: TestNode) => boolean): TestNode | null {
	return all(root, predicate)[0] ?? null;
}

export function hasClass(n: TestNode, name: string): boolean {
	return String(n.props['class'] ?? '').split(/\s+/).includes(name);
}

/** Every text node under `n`, concatenated — the visible words, with no markup. */
export function text(n: TestNode): string {
	let out = '';
	const walk = (x: TestNode): void => {
		if (x.tag === '#text') out += String(x.props['text'] ?? '');
		for (const child of x.children) if (typeof child !== 'string') walk(child);
	};
	walk(n);
	return out;
}

/**
 * `document` and `window`, for a component that listens on them — `DtSelect` adds its outside-click
 * and scroll/resize listeners while open and removes them on unmount, so a file that mounts one calls
 * this once at the top. Only where absent: a file that installed its own keeps it. The window is
 * 1200×1000, the size a panel is placed against.
 */
export function installDomShims(): void {
	const g = globalThis as { document?: unknown; window?: unknown };
	g.document ??= { addEventListener: NOOP, removeEventListener: NOOP };
	g.window ??= { addEventListener: NOOP, removeEventListener: NOOP, innerWidth: 1200, innerHeight: 1000 };
}

function combobox(root: TestNode, ariaLabel: string): TestNode {
	const control = find(root, (n) => n.props['role'] === 'combobox' && n.props['aria-label'] === ariaLabel);
	if (!control) throw new Error(`no combobox labelled "${ariaLabel}"`);
	return control;
}

/**
 * Open the dropdown labelled `ariaLabel` the way a person does — a click on its control — and return
 * its option buttons in order. A control already open is left open: its `aria-expanded` is `true`
 * only while open (a `false` prop is deleted here, so a closed control carries none), and a click
 * would toggle it shut.
 */
export async function openSelect(root: TestNode, ariaLabel: string): Promise<TestNode[]> {
	const control = combobox(root, ariaLabel);
	if (control.props['aria-expanded'] !== true) {
		(control.props['onClick'] as () => void)();
		await flush();
	}
	return all(root, (n) => n.props['role'] === 'option');
}

/** Open the dropdown and click the option whose LABEL (not its trailing hint) is exactly `label`. */
export async function pickOption(root: TestNode, ariaLabel: string, label: string): Promise<void> {
	const options = await openSelect(root, ariaLabel);
	const isLabel = (n: TestNode): boolean => hasClass(n, 'dt-dd__option-label');
	const match = options.find((o) => {
		const span = find(o, isLabel);
		return span !== null && text(span) === label;
	});
	if (!match) throw new Error(`no option labelled "${label}" in "${ariaLabel}" (have: ${options.map((o) => text(find(o, isLabel) ?? o)).join(', ')})`);
	(match.props['onClick'] as () => void)();
	await flush();
}
