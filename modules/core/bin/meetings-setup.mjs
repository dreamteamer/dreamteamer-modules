#!/usr/bin/env node
// Meetings calendar setup, run from inside the workspace (SETUP.md beside this package explains it):
//
//   node node_modules/@dreamteamer/core/bin/meetings-setup.mjs inspect [--json]
//   node node_modules/@dreamteamer/core/bin/meetings-setup.mjs plan [--row "<calendar> | <company> | <account>"]… [--json]
//   node node_modules/@dreamteamer/core/bin/meetings-setup.mjs apply add-calendar-rows --workspace <root> --expect <fingerprint> --row "…"… [--json]
//
// The path above is the direct npm install; a composed `@dreamteamer/core` carries this script as
// `bin/meetings-setup.mjs`, and an inline or git_modules copy sits elsewhere. A plan's `command` argv
// always names the script that is actually installed, relative to the workspace — run that.
//
// inspect reads and starts nothing. plan writes nothing; with rows it asks read-only Git whether `.env`
// is tracked or ignored. apply performs one previewed `.env` edit, only while the file still has the
// previewed fingerprint and Git still keeps it out of commits. Nothing here reaches the network or
// reads a credential.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWorkspace } from '../lib/workspace-root.mjs';
import { inspect, plan, apply } from '../lib/meetings-setup.mjs';
import { SetupRefusal, redact } from '../lib/setup-kit.mjs';

const USAGE = 'usage: setup.mjs inspect | plan [--row "<calendar> | <company> | <account>"]… | apply add-calendar-rows --workspace <root> --expect <fingerprint> --row "…"…  [--json]';

function render(result) {
	const lines = [];
	if (result.workspace) lines.push(`workspace: ${result.workspace.name ?? '(unnamed)'}  ${result.workspace.root}`);
	for (const c of result.checks ?? []) lines.push(`${c.state.padEnd(4)} ${c.status.padEnd(10)} ${c.label} — ${c.detail}`);
	for (const a of result.actions ?? []) {
		lines.push(`action ${a.id}: ${a.state}${a.reason ? ` — ${a.reason}` : ''}`);
		if (a.effects) lines.push(`    effects: ${a.effects.join(' · ')}`);
		if (a.preview) lines.push(`    ${a.preview.change}: keeps ${a.preview.keeps} row(s), adds ${a.preview.adds.length}:`, ...a.preview.adds.map((r) => `      + ${r}`));
		if (a.command && a.state === 'ready') lines.push(`    ${a.runBy === 'owner' ? 'owner runs' : 'after approval'}: ${a.command.map((x) => (/[\s|"'#]/.test(x) ? JSON.stringify(x) : x)).join(' ')}`);
	}
	if ('changed' in result) lines.push(result.changed ? `${result.action}: wrote ${result.wrote} (${result.added} row(s) added)` : `${result.action}: nothing to do — ${result.reason}`);
	return lines.join('\n');
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env, out = console.log, err = console.error } = {}) {
	const json = argv.includes('--json');
	const args = argv.filter((a) => a !== '--json');
	const values = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
	try {
		const verb = args[0];
		const allowed = { inspect: [], plan: ['--row'], apply: ['--workspace', '--expect', '--row'] }[verb];
		if (!allowed) throw new SetupRefusal('usage', USAGE);
		const positional = [];
		for (let i = 1; i < args.length; i++) {
			if (!args[i].startsWith('--')) { positional.push(args[i]); continue; }
			if (!allowed.includes(args[i]) || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new SetupRefusal('usage', USAGE);
			i++;
		}
		if (positional.length > (verb === 'apply' ? 1 : 0)) throw new SetupRefusal('usage', USAGE);
		const root = findWorkspace(cwd);
		if (!root) throw new SetupRefusal('workspace', 'Not inside a dreamteamer workspace (no package.json with package-lock.json here or above).');
		const result = verb === 'inspect' ? inspect({ root, env })
			: verb === 'plan' ? plan({ root, env, rows: values('--row') })
				: apply({ root, env, action: positional[0], workspace: values('--workspace')[0], expect: values('--expect')[0], rows: values('--row') });
		out(json ? JSON.stringify(result, null, 2) : render(result));
		return 0;
	} catch (error) {
		const refusal = error instanceof SetupRefusal;
		const message = refusal ? error.message : `Setup step failed: ${redact(error.message)}`;
		if (json) out(JSON.stringify({ error: refusal ? error.code : 'failed', message }));
		else err(message);
		return refusal && error.code === 'usage' ? 2 : 1;
	}
}

/** Run as a script, including through a symlink: both sides are realpathed before they are compared. */
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) process.exitCode = main();
