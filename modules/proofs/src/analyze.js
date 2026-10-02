// The compile-time half of proofs — the extension's `analyze(draft)`.
//
// A proof declares behaviour this package judges, so every key in one is a value that gets
// INTERPRETED — which by the engine's rule (validate a value iff you interpret it) makes all of them
// compile's to validate. The two silent failures this refuses: `about: skills/greter` names no
// artifact, so the proof proves nothing and says so nowhere; `where: { statuz: … }` fails CLOSED in
// the filter, so a `count` over it passes or fails FOREVER for a reason no output names.
//
// The draft is data only (the staged entries, the FINAL merged descriptors, the modules, declared
// var and env NAMES, the previous manifest), and this returns data only — nothing is printed here.
import { artifactRefs, proofPathFor, validateProofShape, stepWarnings } from './prove.js';

/** Is this workspace-relative source path inside an installed package? A nudge to write a file
 *  there would name a path the next `npm install` erases. */
const inNodeModules = (p) => /(^|[\\/])node_modules([\\/]|$)/.test(String(p));

/**
 * @param {import('dreamteamer').CompileDraft} draft
 * @returns {{ errors: string[], warnings: string[], notes: string[] }}
 */
export function analyze(draft) {
	const errors = [];
	const warnings = [];
	const notes = [];
	const { entries } = draft;
	// computed unconditionally: the coverage line prints its denominators on every compile
	const artifacts = artifactRefs(entries);
	const proofEntries = [...entries].filter(([rt]) => rt.startsWith('proofs/'));
	/** every artifact ref named by at least one proof — the coverage numerators, and the nudge's silencer */
	const proven = new Set();
	const ctx = { descriptors: draft.descriptors, declaredVars: draft.declaredVars, moduleEnv: new Set(draft.declaredEnv), artifacts: artifacts.all };
	for (const [rt] of proofEntries) {
		let proof;
		try { proof = draft.parse(rt); } catch (e) { errors.push(`${rt}: ${String(e.message).split('\n')[0]}`); continue; }
		for (const m of validateProofShape(proof, ctx)) errors.push(`${rt}: ${m}`);
		// warnings, not errors: a step is a shell string, and a brace nobody substitutes is as likely
		// to be `awk '{print}'` as a typo'd `{recrod}` — naming it costs a line and refuses nothing
		for (const w of stepWarnings(proof)) warnings.push(`${rt}: ${w}`);
		for (const ref of proof?.about ?? []) proven.add(String(ref));
	}

	// ---- coverage: one line on every compile, even at zero
	const covered = (list) => `${list.filter((a) => proven.has(a)).length}/${list.length}`;
	notes.push(`proofs: ${proofEntries.length} declared · commands ${covered(artifacts.commands)} · skills ${covered(artifacts.skills)} · scripts ${covered(artifacts.scripts)} · bindings ${covered(artifacts.bindings)}`);

	// ---- the nudge: ONCE, per NEW artifact with no proof ------------------------------------------
	// New, not merely uncovered: it fires only for an artifact absent from the previous manifest, so
	// adopting proofs in a workspace full of unproven artifacts prints nothing, and neither does a
	// first-ever compile. An artifact shipped from node_modules is skipped — a proof written there is
	// erased by npm install. A script added to an existing module does not nudge: the manifest keys a
	// module by its package.json, which a new `bin/` file does not change. Coverage still counts it.
	const prev = draft.previousManifest?.entries;
	if (prev) {
		// module id → workspace-relative ROOT, longest first so a nested module wins over its parent
		// and the root layout's `.` matches last. The root comes off the module, never off the file
		// path — in the root layout a command's source has no module segment at all.
		const roots = draft.modules.map((m) => ({ id: m.id, root: m.root || '.' })).sort((a, b) => b.root.length - a.root.length);
		const ownerRoot = (src) => roots.find(({ root: r }) => r === '.' || src === r || src.startsWith(`${r}/`))?.root ?? '.';
		const sourceOf = (ref) => {
			const key = ref.startsWith('commands/') ? `${ref}.command.md`
				: ref.startsWith('skills/') ? `${ref}/SKILL.md`
				: null;
			if (key) {
				const src = entries.get(key)?.sources?.[0]?.path ?? '';
				return src ? { src, moduleRoot: ownerRoot(src), isNew: !(key in prev) } : null;
			}
			// a module script: `<module-id>/bin/<file>` — its entry is the module record compile projected
			const mod = ref.slice(0, ref.indexOf('/'));
			const modKey = `modules/${mod}.module.yaml`;
			const entry = entries.get(modKey);
			if (!entry) return null;
			return { src: entry.sources?.[0]?.path ?? '', moduleRoot: roots.find((m) => m.id === mod)?.root ?? '.', isNew: !(modKey in prev) };
		};
		for (const ref of [...artifacts.commands, ...artifacts.skills, ...artifacts.scripts]) {
			if (proven.has(ref)) continue;
			const known = sourceOf(ref);
			if (!known || !known.isNew || inNodeModules(known.src)) continue;
			notes.push(`no proof yet for ${ref} — ${proofPathFor(ref, known.moduleRoot)} (see the proving-artifacts skill)`);
		}
	}
	return { errors, warnings, notes };
}
