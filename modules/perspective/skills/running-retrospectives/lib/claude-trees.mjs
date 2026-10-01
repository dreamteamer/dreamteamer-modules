// Which ~/.claude* trees exist and which .jsonl files in them are CONVERSATIONS (vs subagent sidecars).
// The account is knowable only from the tree; nothing inside a transcript records it.
// There are no hard-coded extra trees: the perimeter is measured per machine, never declared.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const accountName = (dirName) => (dirName === '.claude' ? 'default' : dirName.replace(/^\.claude-/, ''));

/** Every `<home>/.claude*` dir that has a `projects/` folder. */
export function claudeHomes(home = os.homedir()) {
	if (!fs.existsSync(home)) return [];
	return fs.readdirSync(home)
		.filter((n) => n === '.claude' || n.startsWith('.claude-'))
		.sort()
		.map((n) => ({ account: accountName(n), root: path.join(home, n), projects: path.join(home, n, 'projects') }))
		.filter((h) => fs.existsSync(h.projects) && fs.statSync(h.projects).isDirectory());
}

export function walkJsonl(dir) {
	const out = [];
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith('.jsonl')) out.push(p);
		}
	};
	if (fs.existsSync(dir)) walk(dir);
	return out;
}

/** One entry per CONVERSATION. Sidecars (agent-*.jsonl, <uuid>/subagents/**) are attached, never listed. */
export function listTranscripts(homes) {
	const out = [];
	for (const h of homes) {
		for (const projectDir of fs.readdirSync(h.projects).sort()) {
			const dir = path.join(h.projects, projectDir);
			if (!fs.statSync(dir).isDirectory()) continue;
			const orphans = [];
			const inDir = [];
			for (const f of fs.readdirSync(dir).sort()) {
				if (!f.endsWith('.jsonl')) continue;
				const file = path.join(dir, f);
				const id = f.slice(0, -6);
				if (!UUID.test(id)) { orphans.push(file); continue; }
				const sub = path.join(dir, id, 'subagents');
				const entry = { account: h.account, project_dir: projectDir, session_id: id, path: file, bytes: fs.statSync(file).size, subagent_paths: walkJsonl(sub), orphan_subagents: [] };
				inDir.push(entry);
				out.push(entry);
			}
			if (orphans.length && inDir.length === 1) inDir[0].orphan_subagents = orphans; // ambiguous orphans are dropped, never promoted
		}
	}
	return out;
}

/** Reconciliation: every .jsonl on disk accounted for. Quote this before any count. */
export function reconcile(homes, transcripts) {
	const onDisk = homes.reduce((n, h) => n + walkJsonl(h.projects).length, 0);
	const sidecars = transcripts.reduce((n, t) => n + t.subagent_paths.length + t.orphan_subagents.length, 0);
	return { files: onDisk, conversations: transcripts.length, sidecars, unattributed: onDisk - transcripts.length - sidecars };
}
