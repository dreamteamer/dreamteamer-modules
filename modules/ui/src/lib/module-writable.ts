/**
 * Whether a module can take a source write: one installed under `node_modules` cannot — the next
 * `npm install` erases it. One rule for every picker that offers modules, in the UI and in a host's own
 * native pickers, so they never disagree about which row is a write target.
 */
export function isUnwritableModule(m: { location?: string | null; path?: string | null }): boolean {
	return m.location === 'node_modules' || /(^|\/)node_modules\//.test(m.path ?? '');
}
