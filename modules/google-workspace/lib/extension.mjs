// @dreamteamer/google-workspace — the engine extension entry (API 1). It contributes one namespaced
// command, `dreamteamer google-setup`, and local doctor rows; both read the same inspect. Nothing
// here starts the MCP server, opens a browser, refreshes a token or reaches the network.
import { inspect, plan, apply, engineDoctorRows } from './google-setup.mjs';
import { redact, SetupRefusal } from './setup-kit.mjs';

export const apiVersion = 1;

export const USAGE = '  google-setup inspect|plan [--account <email>]…|apply create-credential-store --target <dir> --parent-id <id> --workspace <root>  [--json]   Google Workspace setup: local checks, next steps and their effects (SETUP.md)';

const take = (argv, name) => {
	const values = [];
	for (let i = 0; i < argv.length; i++) if (argv[i] === name) { if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new SetupRefusal('usage', `${name} needs a value.`); values.push(argv[++i]); }
	return values;
};

function render(result) {
	const lines = [];
	if (result.workspace) lines.push(`workspace: ${result.workspace.name ?? '(unnamed)'}  ${result.workspace.root}`);
	for (const c of result.checks ?? []) lines.push(`${c.state.padEnd(4)} ${c.status.padEnd(10)} ${c.label} — ${c.detail}`);
	for (const a of result.actions ?? []) lines.push(`action ${a.id}${a.account ? ` (${a.account})` : ''}: ${a.state}${a.reason ? ` — ${a.reason}` : ''}${a.effects ? `\n    effects: ${a.effects.join(' · ')}` : ''}${a.command && a.state === 'ready' ? `\n    ${a.runBy === 'owner' ? 'owner runs' : 'after approval'}: ${a.command.join(' ')}` : ''}`);
	if ('changed' in result) lines.push(result.changed ? `${result.action}: done` : `${result.action}: nothing to do — ${result.reason}`);
	return lines.join('\n');
}

/** The command body, with its inputs explicit so it can be exercised without the engine. */
export function setupCommand({ root, argv = [], env = process.env, out = console.log, err = console.error }) {
	const json = argv.includes('--json');
	const args = argv.filter((a) => a !== '--json');
	try {
		const verb = args[0];
		const allowed = { inspect: [], plan: ['--account'], apply: ['--workspace', '--target', '--parent-id'] }[verb];
		if (!allowed) throw new SetupRefusal('usage', `Expected inspect, plan or apply.\n${USAGE}`);
		const positional = [];
		for (let i = 1; i < args.length; i++) {
			if (args[i].startsWith('--')) { if (!allowed.includes(args[i])) throw new SetupRefusal('usage', `Unknown option ${args[i]}.`); i++; }
			else positional.push(args[i]);
		}
		if (positional.length > (verb === 'apply' ? 1 : 0)) throw new SetupRefusal('usage', 'Unexpected argument.');
		let result;
		if (verb === 'inspect') result = inspect({ root, env });
		else if (verb === 'plan') result = plan({ root, env, accounts: take(args, '--account') });
		else result = apply({ root, env, action: positional[0], workspace: take(args, '--workspace')[0], target: take(args, '--target')[0], parentId: take(args, '--parent-id')[0] });
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

export default function activate() {
	return {
		commands: { 'google-setup': { usage: USAGE, run: (ws, argv) => setupCommand({ root: ws.root, argv }) } },
		doctor: ({ root }) => engineDoctorRows({ root }),
	};
}
