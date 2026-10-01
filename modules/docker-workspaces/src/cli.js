// cli.js — the `dt-docker` verb surface: `dt-docker <verb> <container|image>[/<id>] [<id>] [flags]`.
// Every flag is checked against the table below BEFORE Docker is asked anything, so a typo is a
// refusal naming the flags that verb takes, never a flag silently ignored.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { emit } from './util.js';
import {
	NOUNS, api, ok, imageRef, pullImage, listImages, inspectImage, imageRow, listContainers, inspectContainer,
	containerDetail, startContainer, stopContainer, removeContainer, launchUrl, openUrl, setup,
} from './containers.js';
import { exportContainer, importContainer } from './archive.js';

export const USAGE = `dt-docker — a dreamteamer workspace as a local Docker container (Docker Engine API over its socket;
no workspace and no engine needed — Node and Docker are enough)

  setup       make THIS MACHINE ready: checks Docker, writes ~/.dreamteamer/.env with its defaults
              (DT_PORT_BASE 8100 · DT_BIND 127.0.0.1 · DT_REGISTRY · DT_DOCKER_TIMEOUT 30 — seconds
              a request to Docker may sit idle before the verb fails), lists the templates present,
              pulls one on request [--template <t>] [--json]
  start       container <name> --template <t>   create-if-absent and start: a code-server editor at
              http://localhost:<port>/ — the machine home — over a compiled workspace, three named
              volumes (workspace · home · files), its own bridge network dreamteamer-<name>, image
              <DT_REGISTRY>/<template>:<DT_TEMPLATE_TAG> or DT_IMAGE_<template>. The workspace is
              mounted at /workspaces/<name>. Idempotent. NO credential is ever injected — log in
              INSIDE, once; the home volume keeps it. An image with a URL token (hq 0.6+) prints the
              URL as ?tkn=<token>, read from the container; the token is never written on the host.
              [--rotate-token]    replace the image's URL token and print the new URL
              [--workspace [<w>]] open /workspaces/<w> (default: its own) instead of the home
              [--repo <git url>]  clone an EXISTING workspace into the volume on first start, instead
                                  of laying the template down (no credentials in the URL)
              [--mount <host-path|volume>:<container-path>[:ro]]  extra mounts, repeatable; targets
                                  under /workspaces · /home/node · /files · /mnt, none at or under
                                  another mount's target, no bind source inside another
              [--name <git name>] [--email <git email>] [--no-open] [--json]
  stop        container <name>                  stop it; every volume kept [--json]
  open        container <name>                  print (and open) its URL, token included [--no-open] [--json]
              [--workspace [<w>]]
              [--vscode]  print (and open) the Dev Containers attach URI instead — the host's own
                          VS Code inside the container, extensions from the image's metadata label
  list        containers | images               singular or plural, either spelling [--json]
  get         container <name> | image <ref>    the detail as JSON; --json the raw inspect
  rm          container <name> [--force]        removes it and its network; keeps the volumes unless --force
  add         image --template <t>              pull a template's image
  rm          image <ref> [--force]             remove one
  export      container <name> --out <file>     its WORKSPACES as one file — every folder under
              /workspaces, never the home or a login; node_modules and .files stay behind. Works on
              a stopped container. Encrypted with the owner passphrase (DT_EXPORT_PASSPHRASE, else a
              prompt — never a flag). [--workspace <w>]... only these  [--no-encrypt] a plain .tar.gz
              [--json] (both verbs) the summary as JSON on stdout, every other line on stderr
              Secrets stay behind: .env and .env.* (not .example/.sample/.template), .envrc,
              .npmrc, .netrc, .git-credentials, .pypirc, .docker/config.json, and the credentials in
              each .git/config. [--with-secrets] carries them unchanged. A symlink that leaves its
              workspace is skipped and reported — import would refuse it.
  import      container <name> <file>           unpack an export into a RUNNING container, owned by
              node. Refuses a wrong passphrase, a damaged file, an entry leaving its workspace and a
              workspace already holding files — each before anything is written. The upload lands
              in a staging folder inside the workspace and replaces it only once all of it arrived.
              [--workspace <w>]... only these  [--replace] replace a workspace that holds files
              [--as <name>] land the ONE workspace in /workspaces/<name> — e.g. another container's
                            own volume folder (never the container's own layer)
  help        this text          --version   the package version

The export format: docs/container-export-format.md in this package.`;

// ---- flags -------------------------------------------------------------------------------------
/** The flags each form takes. A form absent here is not a verb on that noun. */
export const FLAGS = {
	'start containers': ['template', 'name', 'email', 'no-open', 'json', 'mount', 'repo', 'rotate-token', 'workspace'],
	'stop containers': ['json'],
	'open containers': ['json', 'no-open', 'vscode', 'workspace'],
	'rm containers': ['force'],
	'get containers': ['json'],
	'list containers': ['json'],
	'export containers': ['workspace', 'out', 'no-encrypt', 'with-secrets', 'json'],
	'import containers': ['workspace', 'replace', 'as', 'json'],
	'list images': ['json'],
	'get images': ['json'],
	'add images': ['template'],
	'rm images': ['force'],
};
const SETUP_FLAGS = ['template', 'json'];
/** Flags that never take a value, so `--no-open hq-dana` leaves the name where it is. */
const BOOLEAN = new Set(['no-open', 'json', 'force', 'vscode', 'rotate-token', 'no-encrypt', 'with-secrets', 'replace']);

/** `--k v`, `--k=v`, bare `--k` → true. `--mount` repeats into an array; `--workspace` repeats into
 *  `workspaces` (export/import read every value; start/open keep the last). Any other repeat: last wins. */
export function parseFlags(args) {
	const flags = {}; const pos = [];
	const put = (k, v) => {
		if (k === 'mount') flags.mount = [...(flags.mount ?? []), v]; else flags[k] = v;
		if (k === 'workspace') flags.workspaces = [...(flags.workspaces ?? []), v];
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (!a.startsWith('--')) { pos.push(a); continue; }
		const eq = a.indexOf('=');
		if (eq > -1) put(a.slice(2, eq), a.slice(eq + 1));
		else if (!BOOLEAN.has(a.slice(2)) && i + 1 < args.length && !args[i + 1].startsWith('--')) put(a.slice(2), args[++i]);
		else put(a.slice(2), true);
	}
	return { flags, pos };
}

function refuseUnknown(flags, known, spelling) {
	if ('passphrase' in flags) throw new Error('the passphrase is never a flag (every local user\'s `ps` reads argv) — set DT_EXPORT_PASSPHRASE, or let the prompt ask');
	const bad = Object.keys(flags).find((f) => f !== 'workspaces' && !known.includes(f));
	if (bad) throw new Error(`unknown flag "--${bad}" on \`dt-docker ${spelling}\` — known: ${known.map((f) => `--${f}`).join(', ') || '(none)'}`);
}

/** `containers`, `container`, `containers/<id>` → { collection, id }; null when the word is not ours. */
export function target(word) {
	if (!word || word.startsWith('--')) return null;
	const slash = word.indexOf('/');
	const collection = NOUNS[slash === -1 ? word : word.slice(0, slash)];
	return collection ? { collection, id: slash === -1 ? undefined : word.slice(slash + 1) } : null;
}

const table = (rows, cols) => {
	if (!rows.length) return '(none)';
	const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
	return rows.map((r) => cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join('  ').trimEnd()).join('\n');
};

const VERBS = new Set(['start', 'stop', 'open', 'rm', 'get', 'list', 'add', 'export', 'import']);

// ---- dispatch ----------------------------------------------------------------------------------
/** `dt-docker …` → a promise of the exit code. Throws a sentence on a refusal. */
export async function main(argv) {
	const [cmd, ...rest] = argv;
	if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
		const p = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
		console.log(`${p.name}@${p.version}`);
		return 0;
	}
	if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { emit(USAGE); return 0; }
	if (cmd === 'setup') {
		const { flags } = parseFlags(rest);
		refuseUnknown(flags, SETUP_FLAGS, 'setup');
		const json = flags.json === true;
		const { code, report } = await setup(flags, json ? console.error : console.log);
		if (json) emit(JSON.stringify(report, null, 2));
		return code;
	}
	if (!VERBS.has(cmd)) throw new Error(`unknown command "${cmd}" — dt-docker help lists the verbs`);
	const t = target(rest[0]);
	if (!t) throw new Error(`dt-docker ${cmd} takes container <name> or image <ref>${rest[0] ? ` — "${rest[0]}" is neither` : ''}. dt-docker help`);
	const form = `${cmd} ${t.collection}`;
	if (!FLAGS[form]) {
		if (t.collection === 'images') throw new Error(`\`${cmd}\` is a container verb — an image is started by starting a container from it: dt-docker start container <name> --template <t>`);
		throw new Error(`\`${cmd}\` is not a container verb — a container is made by dt-docker start container <name> --template <t>; dt-docker add image --template <t> pulls an image`);
	}
	const { flags, pos } = parseFlags(rest.slice(1));
	refuseUnknown(flags, FLAGS[form], `${cmd} ${t.collection.slice(0, -1)}`);
	const id = t.id ?? pos.shift();
	const json = flags.json === true;
	// under --json stdout is the JSON document and nothing else — every human line (the URL carrying
	// the image's token among them) goes to stderr, so a script parsing or logging stdout never holds it
	const say = json ? console.error : console.log;
	const out = (v) => emit(JSON.stringify(v, null, 2));

	if (t.collection === 'images') {
		if (cmd === 'list') { const rows = await listImages(); json ? out(rows) : console.log(table(rows, ['template', 'image', 'size_mb', 'ports', 'created'])); return 0; }
		if (cmd === 'add') {
			const tpl = typeof flags.template === 'string' ? flags.template : undefined;
			if (!tpl) throw new Error('dt-docker add image --template <t> pulls the template\'s image');
			const ref = imageRef(tpl); console.log(`… pulling ${ref}`); await pullImage(ref); console.log(`✔ ${ref}`); return 0;
		}
		if (!id) throw new Error(`dt-docker ${cmd} image <ref>`);
		if (cmd === 'get') { const i = await inspectImage(id); if (!i) throw new Error(`no image "${id}"`); out(json ? i : imageRow({ ...i, Labels: i.Config?.Labels, Created: Date.parse(i.Created) / 1000 })); return 0; }
		ok(await api('DELETE', `/images/${encodeURIComponent(id)}${flags.force ? '?force=true' : ''}`), `rm image ${id}`);
		console.log(`✔ removed image ${id}`); return 0;
	}

	if (cmd === 'list') { const rows = await listContainers(); json ? out(rows) : console.log(table(rows, ['name', 'template', 'state', 'editor_url', 'person', 'created'])); return 0; }
	if (!id) throw new Error(`dt-docker ${cmd} container <name>${cmd === 'start' ? ' --template <t>' : cmd === 'export' ? ' --out <file>' : cmd === 'import' ? ' <file>' : ''}`);
	if (cmd === 'get') { const c = await inspectContainer(id); if (!c) throw new Error(`no container "${id}" — dt-docker list containers`); out(json ? c : containerDetail(c)); return 0; }
	if (cmd === 'start') { const d = await startContainer(id, flags, say); if (json) out(d); return 0; }
	if (cmd === 'stop') { const d = await stopContainer(id); say(`✔ stopped ${id} · volumes kept`); if (json) out(d); return 0; }
	if (cmd === 'rm') { await removeContainer(id, { force: flags.force === true }); return 0; }
	if (cmd === 'export') { const r = await exportContainer(id, flags, say); if (json) out(r); return 0; }
	if (cmd === 'import') { const r = await importContainer(id, pos[0], flags, say); if (json) out(r); return 0; }
	// open
	const c = await inspectContainer(id); if (!c) throw new Error(`no container "${id}" — dt-docker list containers`);
	const d = containerDetail(c);
	if (flags.vscode) {
		// Dev Containers attach: the host's own VS Code opens the workspace INSIDE the container, and
		// installs the extensions the image's `devcontainer.metadata` label names into the container's
		// VS Code Server — a second extension host beside code-server's, over the same files.
		say(d.attach_uri);
		if (!flags['no-open']) { try { spawn('code', ['--folder-uri', d.attach_uri], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* the URI is printed either way */ } }
		if (json) out(d);
		return 0;
	}
	if (!d.editor_url) throw new Error(`${id} publishes no port`);
	if (d.state !== 'running') throw new Error(`${id} is ${d.state} — dt-docker start container ${id} starts it and prints its URL`);
	const url = await launchUrl(d, flags);
	say(url.text); if (!flags['no-open']) openUrl(url, say);
	if (json) out(d); // containerDetail: its editor_url never carries the token
	return 0;
}
