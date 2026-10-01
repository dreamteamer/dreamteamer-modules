#!/usr/bin/env node
// The package's own CLI, run from inside the workspace that installed it:
//
//   npx dt-extensions setup                       wire this workspace up, then show the board
//   npx dt-extensions doctor                      show the board and change nothing
//   npx dt-extensions link <clone>                preview a LOCAL clone of this package instead of the published one
//   npx dt-extensions unlink                      go back to the published one
//   npx dt-extensions migrate                     move a workspace whose records predate 0.2.0 onto perspective
//   npx dt-extensions migrate-world               move 0.2.x–0.8.x records into the perspective/world namespace
//   npx dt-extensions migrate-plan                convert free-text activities.phase into `phases` records
//   npx dt-extensions migrate-code-to-slug        rename `code` to `slug` where it was never a code
//   npx dt-extensions notebook persona <id>       apply NOTEBOOKLM.md's persona to one notebook, in one call
//   npx dt-extensions notebook restore <id>       rebuild the notebook a record describes, on any account
//   npx dt-extensions notebook capture <id>       write a live notebook's sources onto its record
//   npx dt-extensions find <question>             the effort ladder over the workspace's own records
//   npx dt-extensions wiki init <id>              a notebook on a folder — no account, no network
//   npx dt-extensions wiki incomplete             every source that still needs scraping; exit 1 if any
//   npx dt-extensions wiki pull <record>          mirror a live notebook's sources into a folder
//
// `doctor` is read-only by construction: it spends no network request, touches no file, and exits 0
// unless you pass --strict. `setup` does only the in-workspace edits listed under "what setup will
// do" and prints everything else as a fix for a person to run. ⚠ the `notebook` verbs and `wiki pull`
// are the ONLY ones that reach the network — always to one notebook the operator named — and they
// still never install anything and never log in (bin/notebook.mjs and bin/wiki.mjs say why each
// exists). every OTHER `wiki` verb is a folder read or a folder write, which is the whole claim: the
// notebook capability has no prerequisite.
//
// Nothing here knows a thing about any particular person, machine or account.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { execSync } from 'node:child_process';
import { capabilities, capState, worst, findWorkspace, readJson, installedModules, gitignores, BUNDLE_FLOOR } from '../lib/capabilities.mjs';

const args = process.argv.slice(2);
const verb = args.find((a) => !a.startsWith('-')) ?? 'doctor';
const flag = (n) => args.includes(`--${n}`);
const C = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (s, code) => (C ? `[${code}m${s}[0m` : s);
const dim = (s) => paint(s, '2');
const bold = (s) => paint(s, '1');
const GLYPH = { ok: paint('✔', '32'), warn: paint('▲', '33'), bad: paint('✖', '31') };
const STATE = { READY: paint('READY', '32'), DEGRADED: paint('DEGRADED', '33'), UNAVAILABLE: paint('UNAVAILABLE', '31') };

const root = findWorkspace();
if (!root) {
	console.error('Not inside a dreamteamer workspace.\nRun this from the workspace that installed the package — the folder with package.json and package-lock.json.');
	process.exit(1);
}

function board(caps) {
	console.log(`\n  ${bold('@dreamteamer/extensions')}  ${dim(root)}\n`);
	for (const c of caps) {
		console.log(`  ${bold(c.name.padEnd(14))} ${STATE[capState(c)]}`);
		console.log(`  ${dim(c.note)}`);
		for (const chk of c.checks) {
			console.log(`    ${GLYPH[chk.state]} ${chk.label}${chk.detail ? dim(`  ${chk.detail}`) : ''}`);
			if (chk.state !== 'ok' && chk.fix) console.log(`        ${dim('fix:')} ${chk.fix}`);
		}
		console.log('');
	}
	console.log(`  overall  ${STATE[worst(caps)]}\n`);
}

if (verb === 'doctor') {
	const caps = capabilities(root);
	if (flag('json')) console.log(JSON.stringify({ root, overall: worst(caps), capabilities: caps }, null, 2));
	else board(caps);
	process.exit(flag('strict') && worst(caps) !== 'READY' ? 1 : 0);
}

if (verb === 'migrate') {
	// One-shot, and the only place in this package where the old spelling is legal. It refuses on a
	// dirty tree, refuses on any frontmatter key no descriptor declares, and ends by running the
	// engine's own `check` — which is the result that says whether it worked, not its own summary.
	const { main } = await import('./migrate.mjs');
	process.exit(main(args.filter((a) => a !== 'migrate'), root));
}

if (verb === 'migrate-world') {
	// The 0.7.0 move: the observed world into the `perspective/world` namespace. Separate from
	// `migrate` because the two answer different questions — that one is "my records predate 0.2.0",
	// this one is "my records are 0.2.x–0.6.x". A workspace on 0.1.x runs `migrate` ALONE: it folds
	// both moves, because the intermediate state fails the `check` it ends by running.
	const { main } = await import('./migrate-world.mjs');
	process.exit(main(args.filter((a) => a !== 'migrate-world'), root));
}

if (verb === 'migrate-code-to-slug') {
	// `code` was one name for two things. `activities.code` (`a-01`) and `risks.code` (`rk-01`) are
	// identifiers a room says out loud and reads in ORDER; on `tasks`, `decisions`, `goals` and
	// `deliverables` the same field existed only so a name in any script could produce a typeable id.
	// That is a slug, and calling it a code made a workaround look like a domain concept — and made it
	// REQUIRED on every record of four collections. Optional now, which engine 0.25.0's ordered
	// `id.generate` list is what made expressible.
	const { main } = await import('./migrate-code-to-slug.mjs');
	process.exit(main(args.filter((a) => a !== 'migrate-code-to-slug'), root));
}

if (verb === 'migrate-plan') {
	// The 0.9.0 change on the OTHER side of the package: `activities.phase` stopped being free text
	// and became a reference to the new `phases` collection. Separate from `migrate-world` because a
	// workspace may install `projects` and not `perspective`, or the reverse — and because this one
	// MINTS records rather than moving them, deriving each phase's dates from the activities that
	// carried its name and refusing, by name, every group it cannot date.
	const { main } = await import('./migrate-plan.mjs');
	process.exit(main(args.filter((a) => a !== 'migrate-plan'), root));
}

if (verb === 'link' || verb === 'unlink' || verb === 'guard') {
	const { main } = await import('./link.mjs');
	process.exit(await main(args.filter((a) => a !== verb), root, verb));
}

// `find` — the effort ladder over the WORKSPACE's records, not over one assembled corpus. It is the
// only verb with a rung 3, because only records carry references, and a question about records is
// often a question about the graph rather than about the prose (bin/find.mjs says why each rung is
// shaped the way it is, and what was measured to decide it).
if (verb === 'find') {
	const { main } = await import('./find.mjs');
	process.exit(main(args.filter((a) => a !== 'find'), root));
}

if (verb === 'notebook') {
	const { main } = await import('./notebook.mjs');
	process.exit(main(args.filter((a) => a !== 'notebook'), root));
}

if (verb === 'wiki') {
	// The LOCAL adapter — a notebook on top of a folder. Every verb but `pull` is a folder read or a
	// folder write, which is the whole claim: the notebook capability has no prerequisite. `pull` is
	// the bridge to the extra adapter and is the only one that reaches the network (bin/wiki.mjs says
	// why, and why this package fetches no URL of its own).
	const { main } = await import('./wiki.mjs');
	process.exit(main(args.filter((a) => a !== 'wiki'), root));
}

if (verb !== 'setup') {
	console.error(`unknown command "${verb}" — expected setup, doctor, link, unlink, migrate, migrate-world, migrate-plan, migrate-code-to-slug, notebook or wiki`);
	process.exit(2);
}

// ── setup ────────────────────────────────────────────────────────────────────────────────────
// THE WHOLE BOARD BEFORE ANY QUESTION. Being asked to fix things one at a time, with no idea how
// many are coming or how much is already fine, is what makes a setup script feel like an
// interrogation instead of a report.
console.log(bold('\nHere is where this workspace stands before anything changes.'));
board(capabilities(root));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(`  ${q} `, (a) => r(a.trim().toLowerCase())));
const yes = async (q) => (flag('yes') ? true : ['y', 'yes', ''].includes(await ask(`${q} [Y/n]`)));

const pkgPath = path.join(root, 'package.json');
const pkg = readJson(pkgPath) ?? {};
pkg.dreamteamer ??= {};
const mods = installedModules(root);
const has = (m) => mods.has(m);
let changed = false;
const done = [];
const skipped = [];

console.log(bold('\nWhat setup will do, in this workspace only:'));
console.log('  · declare the template variables your installed modules need');
console.log('  · add to .env.example the keys it lacks, and create .env with every value BLANK if there is none yet — never touching a value');
console.log('  · chain the perspective record guard into `npm run check`');
console.log('  · declare the notebooklm harness, so compile writes NOTEBOOKLM.md — when the notebooks module is installed');
console.log('  · add .cache/ to .gitignore, where notebook downloads land — when the notebooks module is installed');
console.log('  · declare FILES_FOLDER, where wiki corpora live — when the notebooks module is installed');
console.log('  · register every wiki corpus with qmd, so a corpus can be ASKED and not only grepped — when qmd is installed');
console.log('  · recompile\n');
console.log(dim('  Anything needing a download, a login or a package manager is printed as a fix, never run for you.\n'));

// 1. the template variables
const wanted = [
	['FILES_FOLDER', has('recordings') || has('meetings') || has('rnd') || has('notebooks'), 'where recordings, meeting files, generated media packs and wiki corpora are kept', '~/Documents/vault-files'],
	['INBOX_FOLDERS', has('recordings'), 'the folders new recordings and screenshots arrive in, one per line', '~/Documents/vault-inbox'],
	['REPOS_FOLDER', has('perspective'), 'where the git checkouts a retrospective reads live', '~/Documents/projects'],
].filter(([, needed]) => needed);
const missing = wanted.filter(([n]) => !(pkg.dreamteamer.vars ?? []).includes(n));
if (missing.length) {
	if (await yes(`Declare ${missing.map(([n]) => n).join(', ')} in dreamteamer.vars?`)) {
		pkg.dreamteamer.vars = [...new Set([...(pkg.dreamteamer.vars ?? []), ...missing.map(([n]) => n)])];
		fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
		changed = true; done.push(`declared ${missing.map(([n]) => n).join(', ')}`);
	} else skipped.push('the template variables — templates using them cannot render until they are declared');
}

// 2. .env.example, and .env only when absent. Two rules, both learned in a real consumer on 2026-09-09:
//   · .env.example gets only the keys it does not already declare — a hand-written file is not re-declared;
//   · .env is written with EVERY value BLANK. The example values belong to the example file; written into
//     .env they read as set, and the doctor reported READY on a workspace pointed at ~/Documents/vault-files.
{
	const entries = [];
	for (const [name, , why, example] of wanted) entries.push({ key: name, lines: [`# ${why}`, `${name}=${example}`] });
	if (has("meetings")) entries.push({ key: "WORK_CALENDARS", lines: ["# The calendars that count as work: calendar-id | default-company | account-email, one row each.",
		"WORK_CALENDARS=\"you@example.com | your-company | you@example.com\""] });
	if (has("recordings") && mods.get("recordings").channel === "node_modules") {
		entries.push({ key: "TRANSCRIBING_MODELS_DIR", lines: ["# Where the ~1.6 GB of transcription weights live. Set this when the package comes from npm:",
			"# npm ci deletes node_modules, and weights kept inside it would download again every time.",
			"TRANSCRIBING_MODELS_DIR=~/.cache/dreamteamer/transcribing-models"] });
	}
	if (has("perspective")) entries.push({ key: "ASANA_PAT", lines: ["# Read by the perspective Asana reader and nothing else. Leave empty to skip that source.", "ASANA_PAT="] });
	const render = (es) => ["# ── @dreamteamer/extensions ──────────────────────────────────────────────",
		"# Every key here is OPTIONAL. Reading, writing, validating and committing records need none of them.",
		"# A missing key degrades exactly one capability and says so; it never breaks the workspace.", "",
		...es.flatMap((e) => [...e.lines, ""])].join("\n");
	const blank = (text) => text.replace(/^([A-Z_]+)=.*$/gm, "$1=");
	const examplePath = path.join(root, ".env.example");
	const existing = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, "utf8") : "";
	const declared = new Set([...existing.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]));
	const novel = entries.filter((e) => !declared.has(e.key));
	if (novel.length) {
		if (await yes(`Add ${novel.map((e) => e.key).join(", ")} to .env.example?`)) {
			fs.writeFileSync(examplePath, existing ? `${existing.trimEnd()}\n\n${render(novel)}` : render(novel));
			done.push(`.env.example — added ${novel.map((e) => e.key).join(", ")}`); changed = true;
		} else skipped.push(".env.example");
	}
	if (!fs.existsSync(path.join(root, ".env"))) {
		if (await yes("No .env here yet. Create one with every key present and every value blank, for you to fill?")) {
			fs.writeFileSync(path.join(root, ".env"), blank(render(entries)));
			done.push(".env — every value is blank; fill in what this machine has, it is gitignored"); changed = true;
		} else skipped.push(".env");
	}
}

// 3. the record guard
if (has('perspective')) {
	const rel = path.relative(root, path.join(mods.get('perspective').root, 'bin', 'check-records.mjs'));
	const current = pkg.scripts?.check ?? '';
	if (!current.includes('check-records.mjs')) {
		if (await yes('Chain the perspective record guard into `npm run check`?')) {
			pkg.scripts ??= {};
			pkg.scripts.check = current ? `${current} && node ${rel}` : `dreamteamer check && node ${rel}`;
			fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
			done.push('npm run check now runs the guard'); changed = true;
		} else skipped.push('the record guard — perspective records will be written but never validated');
	}
}

// 3a. qmd — the retrieval engine, and the one hard requirement the notebooks module has.
//
// ⚠ THE INSTALL IS PRINTED, NEVER RUN. It is a global package-manager write and a ~2.1 GB model
// download, and this script's stated contract three screens up is that nothing of that shape happens
// for you. What setup CAN do is the part that is purely local and instant: telling qmd which folders
// are corpora, and handing each one its description as re-rank CONTEXT.
if (has('notebooks')) {
	const qmdHere = spawnSync('qmd', ['--version'], { encoding: 'utf8' }).status === 0;
	if (!qmdHere) {
		skipped.push('qmd is not installed — `wiki ask` cannot run and search stays exact-match only:\n      npm install -g @tobilu/qmd\n      npx dt-extensions wiki index --embed');
	} else if (await yes('Register this workspace\'s wiki corpora with qmd?')) {
		const { main: wikiMain } = await import('./wiki.mjs');
		wikiMain(['index'], root);
		done.push('registered the wiki corpora with qmd');
		// The embed is minutes of local compute and, on a fresh machine, gigabytes of model download.
		// Naming it as the next step is honest; running it inside a setup prompt is not.
		console.log(dim('    then, once, when you have the time:  npx dt-extensions wiki index --embed'));
	} else skipped.push('registering the corpora with qmd — until then `wiki ask` returns nothing');
}

// 3b. the notebooklm harness and the download folder — only when the notebooks module is here
if (has('notebooks')) {
	// ⚠ The engine's default when `harnesses` is UNSET is ['claude-code'] (compile.js). Writing
	// ['notebooklm'] alone would silently switch the operator's coding-agent harness OFF, so an unset
	// list is materialised as the default plus the new one, and a set list is appended to.
	const current = pkg.dreamteamer.harnesses ?? ['claude-code'];
	if (!current.includes('notebooklm')) {
		if (await yes('Declare the notebooklm harness in dreamteamer.harnesses, so compile writes NOTEBOOKLM.md?')) {
			pkg.dreamteamer.harnesses = [...current, 'notebooklm'];
			fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
			changed = true; done.push('declared the notebooklm harness');
		} else skipped.push('the notebooklm harness — without it there is no NOTEBOOKLM.md and no persona to apply');
	}
	if (!gitignores(root, '.cache/')) {
		if (await yes('Add .cache/ to .gitignore? Notebook downloads and the export bundle land there.')) {
			const gi = path.join(root, '.gitignore');
			const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
			fs.writeFileSync(gi, existing && !existing.endsWith('\n') ? `${existing}\n.cache/\n` : `${existing}.cache/\n`);
			done.push('.gitignore — added .cache/'); changed = true;
		} else skipped.push('.cache/ in .gitignore — a downloaded podcast would be staged for commit');
	}
}

// 4. recompile, because every edit above changes what compile produces
if (changed && await yes('Recompile now?')) {
	try { execSync('npx dreamteamer compile', { cwd: root, stdio: 'inherit' }); done.push('recompiled'); }
	catch { skipped.push('the recompile failed — read its output above, then run `npx dreamteamer compile`'); }
}

rl.close();

console.log(bold('\nWhat changed'));
if (done.length) for (const d of done) console.log(`  ${GLYPH.ok} ${d}`);
else console.log(dim('  nothing — everything setup can do was already done'));
if (skipped.length) { console.log(bold('\nLeft for you')); for (const s of skipped) console.log(`  ${GLYPH.warn} ${s}`); }

console.log(bold('\nWhere it stands now'));
const after = capabilities(root);
board(after);
if (worst(after) !== 'READY') {
	console.log(dim('  DEGRADED is a normal, working state: every capability above is optional, and each line'));
	console.log(dim('  names its own fix. Re-run `npx dt-extensions setup` any time — it is safe to repeat.\n'));
}
console.log(dim(`  A package of modules needs engine ${BUNDLE_FLOOR}+; copying a module folder into modules/ works on older ones.\n`));
