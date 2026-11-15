#!/usr/bin/env node
// dt-web-hook — Claude Code's UserPromptSubmit hook for the pane (cr-modules-017 §6): prints at most three lines of
// what the connected pane shows, selects and queued; on anything else prints nothing. Always exits 0, inside its
// 1.5 s budget; never starts a server. Installed by `dt web hook --install`.
const HARD_STOP_MS = 1800;
setTimeout(() => process.exit(0), HARD_STOP_MS).unref();
let out = '';
try {
	const { runHook, HOOK_BUDGET_MS } = await import('../src/hook.js');
	const t0 = Date.now();
	const chunks = [];
	await new Promise((resolve) => {
		process.stdin.on('data', (c) => chunks.push(c));
		process.stdin.on('end', resolve);
		process.stdin.on('error', resolve);
		setTimeout(resolve, HOOK_BUDGET_MS / 2).unref();
	});
	out = await runHook(Buffer.concat(chunks).toString('utf8'), { budgetMs: Math.max(1, HOOK_BUDGET_MS - (Date.now() - t0)) });
} catch { out = ''; }
if (out) process.stdout.write(out, () => process.exit(0));
else process.exit(0);
