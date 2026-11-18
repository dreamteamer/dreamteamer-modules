// `data-vscode-context` is how a webview tells VS Code what a piece of its DOM stands for: the JSON
// below lands on the `webviewSection` / `dtCollection` / `dtId` context keys of the right-clicked
// element, and the extension's `webview/context` menu items (package.json, `when: webviewSection ==
// dt-row`) receive that same object as their command argument.
//
// So the row menus are NATIVE VS Code menus, not an in-app popup we style and position ourselves —
// which is the whole point: right-clicking a record row should feel like right-clicking a file.
//
// It carries collection + id, never a path. The extension host resolves the file (src/reveal.ts),
// so the app never learns where the workspace lives on disk.

/**
 * Mark an element as record `id` of `collection`, for the extension's row context menu.
 *
 * `selection` is the current checkbox selection (browse-state's `selectedIds`). When the
 * right-clicked row is IN it and more than one row is picked, the whole selection travels with the
 * command as `dtIds` and the batch gestures (Copy Path / Copy Relative Path) act on all of them —
 * right-clicking a row OUTSIDE the selection still means just that row, which is how the explorer
 * behaves. Single-target gestures (reveal) ignore `dtIds` and use `dtId`.
 */
export function rowContext(collection: string, id: string, selection?: Iterable<string>): string {
	const picked = selection ? [...selection] : [];
	const batch = picked.length > 1 && picked.includes(id) ? picked : undefined;
	return JSON.stringify({ webviewSection: 'dt-row', dtCollection: collection, dtId: id, dtIds: batch });
}

/**
 * Mark an element as ONE ROW of the Schema tab — a module, a collection, a skill, a ui-view.
 *
 * `kind` is the system collection the row belongs to, and it is what the `when` clauses switch on
 * (`dtSchemaKind == 'modules'`), so one command set serves every kind and the host resolves the rest.
 *
 * `module` and `location` travel because two REFUSALS depend on them and both must be knowable
 * BEFORE the click: a write into an `node_modules`-shaped module is erased by the next
 * `npm install`, and a module selector is only offered where more than one module declares the
 * entity. Still no path — the host owns the filesystem (`src/reveal.ts`).
 */
export function schemaRowContext(kind: string, id: string, module?: string, location?: string): string {
	return JSON.stringify({
		webviewSection: 'dt-schema-row',
		dtSchemaKind: kind,
		dtSchemaId: id,
		dtSchemaModule: module,
		dtSchemaLocation: location,
	});
}

/** Mark a KIND row in the left rail, so New… is reachable with no row selected. */
export function schemaKindContext(kind: string): string {
	return JSON.stringify({ webviewSection: 'dt-schema-kind', dtSchemaKind: kind });
}
