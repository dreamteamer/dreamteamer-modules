// Mapping a session to a repository — as TEXT, because most of these repos no longer exist here.
//
// The person's trees move, get deleted, live under several account identities
// (~/Documents/<workspace>/projects/<identity>/<repo>) and get talked about from a PARENT folder. So:
//   `repo`          = where the session RAN   (resolved from cwd, best effort, may be a parent)
//   `subject_repos` = what it was ABOUT       (inferred from touched paths — computed in metrics.mjs)
// Those two disagree constantly and that disagreement is the point.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cache = new Map();

function gitRootOf(dir) {
	let d = dir;
	for (let i = 0; i < 40; i++) {
		if (fs.existsSync(path.join(d, '.git'))) return d;
		const up = path.dirname(d);
		if (up === d) return null;
		d = up;
	}
	return null;
}

function remoteOf(gitRoot) {
	// read .git/config directly — no subprocess per session, this runs 5,000 times
	try {
		const cfg = fs.readFileSync(path.join(gitRoot, '.git', 'config'), 'utf8');
		const m = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(cfg);
		return m ? m[1] : '';
	} catch { return ''; }
}

/** `git@github.com:owner/name.git` / `https://host/owner/name` → `owner/name`. */
export function shortRemote(url) {
	if (!url) return '';
	const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url.trim());
	return m ? `${m[1]}/${m[2]}` : url;
}

/**
 * Resolve a cwd to a text repo identifier, in descending order of trustworthiness:
 *   kind `git`      — a real .git on disk → the remote's owner/name, else the root's folder name
 *   kind `projects` — `…/projects/<identity>/<repo>/…`, the multi-identity layout under a workspace
 *   kind `guess`    — just the last path segment. NOT a repo; callers filter these out of
 *                     `subject_repos`, or the field fills with "Documents" and "scratchpad".
 * Result is memoized: a scan hits the same handful of cwds thousands of times.
 */
export function resolveRepo(cwd) {
	if (!cwd) return { repo: 'unknown', repo_remote: '', kind: 'none' };
	if (cache.has(cwd)) return cache.get(cwd);
	let out;
	const root = fs.existsSync(cwd) ? gitRootOf(cwd) : null;
	if (root) {
		const remote = remoteOf(root);
		out = { repo: shortRemote(remote) || path.basename(root), repo_remote: remote, kind: 'git' };
	} else {
		const parts = cwd.split('/').filter(Boolean);
		const pi = parts.lastIndexOf('projects');
		if (pi >= 0 && parts.length > pi + 2) out = { repo: `${parts[pi + 1]}/${parts[pi + 2]}`, repo_remote: '', kind: 'projects' };
		else if (parts.length) out = { repo: parts[parts.length - 1], repo_remote: '', kind: 'guess' };
		else out = { repo: 'unknown', repo_remote: '', kind: 'none' };
	}
	cache.set(cwd, out);
	return out;
}

// Directories that say nothing about what a session was about. Counting them wrecks both
// topic_entropy (everything touches /tmp) and subject_repos (every session is "about" Documents).
const BORING = /^\/(tmp|private|var|etc|usr|opt|bin|sbin|dev|proc|System|Library|Applications)(\/|$)/;
// `.claude*` matters more than it looks: the agent's own memory/ and projects/ folders live there,
// and without this every session that read its memory file counts as being "about" a transcript dir.
const BORING_SEG = /(^|\/)(node_modules|\.git|\.claude[^/]*|\.dreamteamer|\.cache|\.venv|__pycache__|dist|build|\.next|coverage)(\/|$)/;

/** Is this a path worth attributing a session to? */
// `home` defaults to os.homedir() rather than the HOME variable: homedir() is the same answer
// without an environment lookup a workspace would have to declare.
export function interestingDir(dir, home = os.homedir()) {
	if (!dir || dir === '/' || dir === '.') return false;
	if (BORING.test(dir) || BORING_SEG.test(dir)) return false;
	if (home && (dir === home || dir === path.join(home, 'Documents') || dir === path.join(home, 'Downloads'))) return false;
	return true;
}

/** The encoded `projects/<dir>` name back into a path guess, for transcripts with no cwd record. */
export function decodeProjectDir(name) {
	return name.replace(/^-/, '/').replace(/-/g, '/');
}
