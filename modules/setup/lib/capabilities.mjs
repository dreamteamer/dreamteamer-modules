// Every check this package makes, defined once. Both surfaces read this same array: `doctor`
// reports it read-only, `setup` walks it and fixes what it safely can.
//
// Two rules:
//
//   · A check is defined HERE or nowhere. Two copies drift, and the day they disagree is the day
//     one of them is quietly wrong.
//   · `fix` is prose shown to a person and NEVER executed. A check opts into being run by also
//     passing `run`, an identical or narrower command. Default-deny: advice cannot become a
//     subprocess by accident, which is what happens when a "fix" like "macOS: brew install x ·
//     Linux: apt-get install x" is handed to a shell.
//
// Nothing here knows anything about any particular person, machine or account. Every path comes
// from the workspace being checked or from the environment it is running in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const cap = (name, note) => {
	const c = { name, note, checks: [] };
	return {
		cap: c,
		ok: (label, detail = '') => c.checks.push({ label, state: 'ok', detail }),
		warn: (label, fix, detail = '', run) => c.checks.push({ label, state: 'warn', fix, detail, run: run || null }),
		bad: (label, fix, detail = '', run) => c.checks.push({ label, state: 'bad', fix, detail, run: run || null }),
	};
};

/** Is `name` on PATH? Returns the resolved path, or null. */
export function bin(name) {
	try { return execFileSync('command', ['-v', name], { shell: true, encoding: 'utf8' }).trim() || null; }
	catch { return null; }
}

/** The workspace root: the nearest ancestor with package.json AND package-lock.json, skipping any
 *  candidate sitting directly inside `git_modules/` — a module clone is never a workspace. */
export function findWorkspace(from = process.cwd()) {
	for (let d = path.resolve(from); ; d = path.dirname(d)) {
		const inGitModules = path.basename(path.dirname(d)) === 'git_modules';
		if (!inGitModules && fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'package-lock.json'))) return d;
		if (path.dirname(d) === d) return null;
	}
}

export const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** JSON out of a command's stdout, skipping any banner before the first `{`. */
export const readJsonText = (s) => { try { return JSON.parse(s.slice(s.indexOf('{'))); } catch { return null; } };

/** Run a local command and return its stdout, or '' when it is missing or fails. Memoised per
 *  process: the doctor is drawn twice by `setup` and many times by the tests, and each vendor call
 *  is a Python interpreter start. */
const shMemo = new Map();
export function sh(cmd, args) {
	const key = `${cmd} ${args.join(' ')}`;
	if (!shMemo.has(key)) {
		try { shMemo.set(key, execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
		catch { shMemo.set(key, ''); }
	}
	return shMemo.get(key);
}

/** Does `.gitignore` carry `pattern` as a line of its own (trailing slash optional)? */
export function gitignores(root, pattern) {
	try {
		const want = pattern.replace(/\/$/, '');
		return fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').some((l) => l.trim().replace(/\/$/, '') === want);
	} catch { return false; }
}

/** The vendor CLI release the using-notebooklm skill was measured on. Older ones lack `skill status`
 *  and keep auth at a path the skill no longer names. */
export const NOTEBOOKLM_FLOOR = '0.7.3';
/** The `qmd` the answering flow was measured on. Below it the CLI's flags and output shape drift. */
export const QMD_FLOOR = '2.8.3';

/** `.env` keys that have a non-empty value. Names only — a value is never read out of here. */
export function envKeys(root) {
	const set = new Set();
	try {
		for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
			const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
			if (m && m[2].trim() !== '') set.add(m[1]);
		}
	} catch { /* no .env is a normal, working state */ }
	return set;
}

/** Which modules the workspace actually has, by channel — the same walk the engine's discovery does,
 *  including dropping a module named bare in `dreamteamer.disable`. A switched-off module must not be
 *  asked for its variables or shown a capability, and the engine never compiles it, so it is not
 *  "installed" in any sense a person means. */
/** The module ids a manifest's `disable` switches off whole: its `modules/<id>` entries. */
const disabledModules = (dt) => (dt?.disable ?? []).filter((d) => typeof d === 'string' && d.startsWith('modules/')).map((d) => d.slice('modules/'.length));

export function installedModules(root) {
	const wsPkg = readJson(path.join(root, 'package.json')) ?? {};
	// keyed by MODULE ID: an official package `@dreamteamer/contacts` is `contacts` here, the id every
	// capability below asks about. A whole module is disabled as `modules/<id>`.
	const idOf = (n) => String(n).replace(/^@dreamteamer\//, '');
	const disabled = new Set(disabledModules(wsPkg.dreamteamer));
	const found = new Map();
	const add = (name, channel, at) => { const id = idOf(name); if (!disabled.has(id) && !found.has(id)) found.set(id, { channel, root: at }); };
	const scan = (dir, channel, unpack) => {
		if (!fs.existsSync(dir)) return;
		for (const name of fs.readdirSync(dir)) {
			const at = path.join(dir, name);
			const pkg = readJson(path.join(at, 'package.json'));
			if (!pkg || !('dreamteamer' in pkg)) continue;
			if (unpack && fs.existsSync(path.join(at, 'modules'))) { scan(path.join(at, 'modules'), channel, false); continue; }
			add(pkg.name ?? name, channel, at);
		}
	};
	scan(path.join(root, 'modules'), 'modules', false);
	scan(path.join(root, 'git_modules'), 'git_modules', true);
	for (const d of Object.keys({ ...wsPkg.dependencies })) {
		const at = path.join(root, 'node_modules', d);
		const pkg = readJson(path.join(at, 'package.json'));
		if (!pkg || !('dreamteamer' in pkg)) continue;
		if (fs.existsSync(path.join(at, 'modules'))) scan(path.join(at, 'modules'), 'node_modules', false);
		else add(pkg.name ?? d, 'node_modules', at);
	}
	return found;
}

// `files` has no capability block here: its machine checks (is each drive mounted, cloud-only entries)
// are its own extension's `dt doctor` rows.
/** The transcriber's one folder — the same rule as the skill's locations.transcription_home():
 *  TRANSCRIPTION_HOME, `~` expanded, else ~/.cache/dreamteamer/transcription. Never inside the package.
 *  models/ (diarization/, whisper-ct2/, whisper-ggml/), venv/ and asr/ sit under it. */
export function transcriptionHome(env = process.env, home = os.homedir()) {
	const v = env.TRANSCRIPTION_HOME;
	if (!v) return path.join(home, '.cache', 'dreamteamer', 'transcription');
	return path.resolve(v === '~' || v.startsWith('~/') ? path.join(home, v.slice(2)) : v);
}

// The GPU pass's weights, as the skill's engines.py pins them: the path under the models folder and
// the exact size of the pinned upstream object. A file at any other size is half-copied or evicted.
export const GGML_FILE = path.join('models', 'whisper-ggml', 'ggml-ivrit-large-v3-turbo.bin');
export const GGML_SIZE = 1_624_555_275;
const fileSize = (p) => { try { return fs.statSync(p).size; } catch { return null; } };

/** Can `auto` transcribe on the GPU here? Optional either way: `warn` names what is missing and the
 *  CPU pass runs regardless. Off Apple Silicon there is no GPU engine, which is a fact, not a gap. */
export function gpuCheck({ platform = process.platform, arch = process.arch, whisperCli, ggmlSize }) {
	if (platform !== 'darwin' || arch !== 'arm64') return { state: 'ok', detail: 'cpu — no GPU engine on this machine (metal needs Apple Silicon)' };
	if (!whisperCli) return { state: 'warn', fix: 'brew install whisper-cpp, then re-run the transcriber setup for the 1.6 GB of ggml weights', detail: 'optional: recognition on Metal, ~4-5x faster; without it the CPU pass runs' };
	if (ggmlSize !== GGML_SIZE) return { state: 'warn', fix: 'uv run python transcribe_meeting.py setup (in the transcribing-recordings skill folder)', detail: `optional: whisper-cli is there, the ggml weights are ${ggmlSize == null ? 'missing' : 'incomplete'} — the CPU pass runs until they are` };
	return { state: 'ok', detail: `metal — whisper-cli ${whisperCli} + ggml weights` };
}

export const OURS = ['core', 'assets', 'users', 'companies', 'contacts', 'engagements', 'tasks', 'routines', 'meetings', 'recordings', 'meeting-docs', 'projects', 'perspective', 'wikis', 'notebooklm', 'search', 'rnd', 'proofs', 'worktrees', 'http', 'docker-workspaces', 'code', 'files', 'workflows'];

/** The modules a COMPOSED module stands in for — `compose.json` at its root names its origins. `core`
 *  installed means every capability of users, meetings, files… applies, read from the package itself. */
export function originsOf(mods, id) {
	const root = mods.get(id)?.root;
	const f = root && path.join(root, 'compose.json');
	return f && fs.existsSync(f) ? (readJson(f)?.origins ?? []) : [];
}
/** The root of module `id` — its own package, or the composed module that stands in for it. */
export function rootOf(mods, id) {
	if (mods.has(id)) return mods.get(id).root;
	for (const [m] of mods) if (originsOf(mods, m).includes(id)) return mods.get(m).root;
	return undefined;
}
/** Where module `id`'s `bin/<script>` is — its own package, or the composed copy (`bin/<id>-<script>`). */
export function binOf(mods, id, script) {
	if (mods.has(id)) return path.join(mods.get(id).root, 'bin', script);
	for (const [m] of mods) if (originsOf(mods, m).includes(id)) return path.join(mods.get(m).root, 'bin', `${id}-${script}`);
	return undefined;
}
const cmp = (a, b) => { // returns -1/0/1 comparing dotted versions
	const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
	for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1; }
	return 0;
};

/** THE ENGINE FLOOR — the oldest engine every official module is tested on. Each module also
 *  declares its own `dreamteamer.engine`, which compile enforces; this is the board's early warning. */
export const BUNDLE_FLOOR = '0.30.0';

export function capabilities(root) {
	const pkg = readJson(path.join(root, 'package.json')) ?? {};
	const dt = pkg.dreamteamer ?? {};
	const env = envKeys(root);
	const mods = installedModules(root);
	const composedIn = new Set([...mods.keys()].flatMap((m) => originsOf(mods, m)));
	const mine = OURS.filter((m) => mods.has(m) || composedIn.has(m));
	const has = (m) => mods.has(m) || composedIn.has(m);
	const out = [];

	// ── the workspace itself ─────────────────────────────────────────────────────────────────
	{
		const c = cap('workspace', 'the engine, and which official modules this workspace actually has');
		const enginePkg = readJson(path.join(root, 'node_modules', 'dreamteamer', 'package.json'));
		if (!enginePkg) c.bad('engine', 'npm install dreamteamer', 'no engine installed — nothing can compile', 'npm install dreamteamer');
		else {
			if (mine.length && cmp(enginePkg.version, BUNDLE_FLOOR) < 0) {
				c.bad('engine', `npm install dreamteamer@^${BUNDLE_FLOOR}`,
					`${enginePkg.version} installed — the official modules are tested on ${BUNDLE_FLOOR}+`,
					`npm install dreamteamer@^${BUNDLE_FLOOR}`);
			} else c.ok('engine', `dreamteamer ${enginePkg.version}`);
		}
		if (!mine.length) c.bad('modules', 'npm install @dreamteamer/<module> and what it needs — each module\'s README has the line', 'no official module is installed here');
		else c.ok('modules', `${mine.length} of ${OURS.length}: ${mine.join(' · ')}`);
		const off = disabledModules(dt).filter((d) => OURS.includes(d));
		if (off.length) c.ok('disabled on purpose', off.join(' · '));
		out.push(c.cap);
	}

	// ── the template variables, which only the WORKSPACE can declare ─────────────────────────
	{
		const c = cap('variables', 'records store `${env:NAME}` templates as inert text; only the workspace can declare which names render');
		const wanted = [
			// wikis is on this row for legacy records only: a corpus lives in the repo, but an older `wikis`
			// record may still carry a `${env:FILES_FOLDER}/…` folder.
			['FILES_FOLDER', has('recordings') || has('meetings') || has('rnd') || has('wikis'), 'where recordings, meeting files, generated media packs and legacy wiki corpora are kept'],
			['INBOX_FOLDERS', has('recordings') || has('meetings'), 'the folders new recordings and meeting screenshots arrive in'],
			['REPOS_FOLDER', has('perspective'), 'where the git checkouts a retrospective reads live'],
		].filter(([, needed]) => needed);
		const declared = new Set(dt.vars ?? []);
		for (const [name, , why] of wanted) {
			if (!declared.has(name)) c.bad(`${name} declared`, `add "${name}" to dreamteamer.vars in package.json, then dreamteamer compile`, why);
			else if (!env.has(name)) c.warn(`${name} set`, `add ${name}=… to .env`, `${why} — declared, but unset here, so templates using it cannot render on this machine`);
			else c.ok(name, why);
		}
		if (!wanted.length) c.ok('none needed', 'no installed module uses a template variable');
		out.push(c.cap);
	}

	// ── the guard that check must chain ──────────────────────────────────────────────────────
	if (has('perspective')) {
		const c = cap('record guard', 'the perspective module ships a guard that `dreamteamer check` does not know about');
		const script = pkg.scripts?.check ?? '';
		const rel = path.relative(root, path.join(rootOf(mods, 'perspective'), 'bin', 'check-records.mjs'));
		if (script.includes('check-records.mjs')) c.ok('chained', 'npm run check runs it');
		else c.bad('chained', `set scripts.check to: dreamteamer check && node ${rel}`,
			'without it, perspective records are written but never validated');
		out.push(c.cap);
	}

	// ── meetings ─────────────────────────────────────────────────────────────────────────────
	if (has('meetings')) {
		const c = cap('meetings', 'reading your calendar. Optional: everything else in the module works without it.');
		env.has('WORK_CALENDARS')
			? c.ok('WORK_CALENDARS', 'the calendars that count as work')
			: c.warn('WORK_CALENDARS', 'add WORK_CALENDARS to .env — one row per calendar: calendar-id | default-company | account-email',
				'without it there is nothing to sync from');
		const credDir = path.join(os.homedir(), '.config', 'google-workspace-mcp', 'credentials');
		let accounts = [];
		try { accounts = fs.readdirSync(credDir).filter((f) => f.endsWith('.json') && f !== 'oauth_states.json'); } catch { /* none */ }
		accounts.length
			? c.ok('google account', `${accounts.length} authenticated`)
			: c.warn('google account', 'authenticate an account through the google-workspace MCP server (its start_google_auth tool)',
				'the calendar reader reuses that credential — it never asks for a new grant');
		out.push(c.cap);
	}

	// ── recordings ───────────────────────────────────────────────────────────────────────────
	if (has('recordings')) {
		const c = cap('recordings', 'ingesting audio and transcribing it offline. Optional, and heavy: ~1.6 GB of model weights.');
		const skill = path.join(rootOf(mods, 'recordings'), 'skills', 'transcribing-recordings');
		const ff = bin('ffmpeg');
		ff ? c.ok('ffmpeg', ff) : c.bad('ffmpeg', 'macOS: brew install ffmpeg · Debian/Ubuntu: apt-get install -y ffmpeg', 'the only external binary transcription needs');
		const uv = bin('uv');
		const uvInstall = 'curl -LsSf https://astral.sh/uv/install.sh | sh';
		uv ? c.ok('uv', uv) : c.bad('uv', uvInstall, 'provisions the pinned Python and its venv', uvInstall);
		const home = transcriptionHome();
		if (fs.existsSync(path.join(home, 'models', 'diarization', 'segmentation.onnx'))) {
			c.ok('model weights', path.join(home, 'models'));
		} else {
			c.warn('model weights', `cd ${path.relative(root, skill)} && UV_PROJECT_ENVIRONMENT="${path.join(home, 'venv')}" uv sync && uv run python transcribe_meeting.py setup`,
				`~1.6 GB, downloaded once into ${path.join(home, 'models')}`);
		}
		const gpu = gpuCheck({ whisperCli: bin('whisper-cli'), ggmlSize: fileSize(path.join(home, GGML_FILE)) });
		gpu.state === 'ok' ? c.ok('gpu', gpu.detail) : c.warn('gpu', gpu.fix, gpu.detail);
		out.push(c.cap);
	}

	// ── contacts ─────────────────────────────────────────────────────────────────────────────
	if (has('contacts')) {
		const c = cap('contacts', 'enriching people from LinkedIn. Optional: contacts and companies work fully by hand without it.');
		const docker = bin('docker');
		docker ? c.ok('docker', docker) : c.warn('docker', 'install Docker Desktop, or skip LinkedIn enrichment', 'the scraper runs in a throwaway container');
		fs.existsSync(path.join(os.homedir(), '.linkedin-mcp', 'cookies.json'))
			? c.ok('linkedin session', 'a session exists')
			: c.warn('linkedin session', 'uvx mcp-server-linkedin@latest --import-from-browser', 'one interactive login, reused headlessly after that');
		out.push(c.cap);
	}

	// ── rnd ─────────────────────────────────────────────────────────────────────────────────
	if (has('rnd')) {
		const c = cap('rnd', 'turning a screen recording into frames a reference record can point at. Optional: every rnd record works by hand without it.');
		const ff = bin('ffmpeg');
		ff ? c.ok('ffmpeg', ff) : c.warn('ffmpeg', 'macOS: brew install ffmpeg · Debian/Ubuntu: apt-get install -y ffmpeg', 'the one binary extract-frames.mjs shells out to; a reference without a recording needs nothing');
		out.push(c.cap);
	}

	// ── perspective ────────────────────────────────────────────────────────────────────────
	if (has('perspective')) {
		const c = cap('perspective', 'reading your own past work. Every source is optional and a run says which it could not reach.');
		fs.existsSync(path.join(os.homedir(), '.claude', 'projects'))
			? c.ok('coding-agent transcripts', 'a Claude Code tree is present')
			: c.warn('coding-agent transcripts', 'nothing to do — this source is simply absent on this machine', 'a run proceeds on the other sources');
		env.has('ASANA_PAT')
			? c.ok('ASANA_PAT', 'the ticket reader can run')
			: c.warn('ASANA_PAT', 'add ASANA_PAT to .env, or leave it unset', 'without it the asana source reports unavailable, which is a stated gap rather than a silent one');
		out.push(c.cap);
	}

	// ── wikis ────────────────────────────────────────────────────────────────────────────────
	// Every check here is local: `--version`, `status` and `auth check` without --test read disk only.
	// Nothing here is `bad`: grep is the floor that always answers, and qmd (local, on-device, no
	// account) only adds asking. A warning states the gap; a failure would deny a working capability.
	if (has('wikis')) {
		const c = cap('wikis', 'a corpus you can grep with nothing installed, and ASK once `qmd` is — both local. Nothing here is `bad`: grep is the floor.');
		// ── the retrieval engine: OPTIONAL, and the capability degrades to grep without it ──────
		const q = bin('qmd');
		if (!q) {
			c.warn('qmd', 'npm install -g @tobilu/qmd', 'OPTIONAL — the local adapter\'s retrieval engine, all on-device. Without it `wiki ask` is unavailable and `wiki search` (grep) still works, finding only the words you literally typed');
		} else {
			c.ok('qmd', q);
			const qv = /qmd (\d+\.\d+\.\d+)/.exec(sh('qmd', ['--version']))?.[1];
			if (!qv || cmp(qv, QMD_FLOOR) < 0) c.warn('qmd version', 'npm install -g @tobilu/qmd@latest', `${qv ?? 'unknown'} installed — the flow was measured on ${QMD_FLOOR}`);
			else c.ok('qmd version', qv);
			// A corpus that is registered but never embedded answers lexically and says nothing about it,
			// which is the same silent half-failure grep had. `wiki index` is the one command that fixes both.
			const st = sh('qmd', ['status']);
			const pending = Number(/Pending:\s*(\d+)/.exec(st)?.[1] ?? 0);
			const files = Number(/Total:\s*(\d+)/.exec(st)?.[1] ?? 0);
			if (!files) c.warn('corpora indexed', 'npx dt-wiki index', 'qmd knows about no documents yet — every `wiki ask` would come back empty');
			else if (pending) c.warn('embeddings', 'npx dt-wiki index --embed · or: qmd embed', `${pending} document(s) indexed but not embedded — those answer lexically only, silently`);
			else c.ok('corpora indexed', `${files} document(s) indexed and embedded`);
		}
		// Corpora live in the repo (`wikis/<id>`), so the capability needs no variable; the legacy row
		// names the one case that still does — a record carrying an `${env:FILES_FOLDER}/…` folder.
		c.ok('wikis folder', 'corpora live in the repo under wikis/ — no variable and no mount; the qmd index lives in ~/.cache and is never committed');
		if (!((dt.vars ?? []).includes('FILES_FOLDER') && env.has('FILES_FOLDER'))) {
			c.ok('legacy corpora', 'FILES_FOLDER is unset — fine unless a `wikis` record still carries a ${env:FILES_FOLDER}/… folder, which would refuse by name');
		}
		out.push(c.cap);
	}

	// ── notebooklm ──────────────────────────────────────────────────────────────────────────
	// The EXTRA adapter: a login, a vendor CLI and a harness. Nothing here is `bad` either — a machine
	// with none of it still has every local wiki, and reporting UNAVAILABLE would say the opposite.
	if (has('notebooklm')) {
		const c = cap('notebooklm', 'the NotebookLM export, the harness and the notebook records. Optional: a login and a vendor CLI, and nothing a local wiki needs.');
		const nb = bin('notebooklm');
		if (!nb) c.warn('notebooklm', 'uv tool install notebooklm-py · or: pip install "notebooklm-py[browser]"; then notebooklm skill install', 'the vendor CLI — `dt notebooklm` renders sources without it; syncing and the dt-notebook verbs need it');
		else {
			c.ok('notebooklm', nb);
			const v = /version (\d+\.\d+\.\d+)/.exec(sh('notebooklm', ['--version']))?.[1];
			if (!v || cmp(v, NOTEBOOKLM_FLOOR) < 0) c.warn('version', 'uv tool upgrade notebooklm-py · or: pip install -U notebooklm-py; then notebooklm skill install', `${v ?? 'unknown'} installed — the skill was measured on ${NOTEBOOKLM_FLOOR}`);
			else c.ok('version', v);
			const auth = readJsonText(sh('notebooklm', ['auth', 'check', '--json']));
			auth?.status === 'ok'
				? c.ok('signed in', 'a session file exists — expiry shows only on a real call (notebooklm auth check --test)')
				: c.warn('signed in', 'notebooklm login — opens a browser, so a person runs it', 'no usable session under ~/.notebooklm (or $NOTEBOOKLM_HOME)');
			/Claude Code:\s+Installed/.test(sh('notebooklm', ['skill', 'status']))
				? c.ok('vendor skill', 'installed for Claude Code')
				: c.warn('vendor skill', 'notebooklm skill install', 'the command reference using-notebooklm defers to for every flag');
		}
		(dt.harnesses ?? []).includes('notebooklm')
			? c.ok('harness declared', 'compile writes NOTEBOOKLM.md')
			: c.warn('harness declared', 'add "notebooklm" to dreamteamer.harnesses in package.json, then npx dreamteamer compile', 'this is what makes NOTEBOOKLM.md — and the `dt-notebook persona` verb — exist; a local wiki never reads it');
		gitignores(root, '.cache/')
			? c.ok('.cache/ ignored', 'downloads and the export bundle land there')
			: c.warn('.cache/ ignored', 'add .cache/ to .gitignore', 'notebook downloads and the export bundle land there; a 40 MB podcast must never be staged');
		out.push(c.cap);
	}

	return out;
}

export const worst = (caps) => {
	const states = caps.flatMap((c) => c.checks.map((x) => x.state));
	return states.includes('bad') ? 'UNAVAILABLE' : states.includes('warn') ? 'DEGRADED' : 'READY';
};
export const capState = (c) => {
	const s = c.checks.map((x) => x.state);
	return s.includes('bad') ? 'UNAVAILABLE' : s.includes('warn') ? 'DEGRADED' : 'READY';
};
