// Shared harness for cr-modules-001's held-out tests: run one workflow step's own `run` under the
// runner's shell (`bash -e`) in a scratch repo. Written by the test stage from the held-out records.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const workflow = (name) => yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8'));
export const leakStep = (name) => workflow('leak-scan.yml').jobs.scan.steps.find((s) => s.name === name);
export const releaseStep = (re) => workflow('release.yml').jobs.publish.steps.find((s) => re.test(s.name ?? ''));
export const ID = { GIT_AUTHOR_NAME: 'Dana Oren', GIT_AUTHOR_EMAIL: 'dana@northwind.example', GIT_COMMITTER_NAME: 'Dana Oren', GIT_COMMITTER_EMAIL: 'dana@northwind.example' };

export function repo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldout-'));
	const git = (args, env = {}) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...ID, ...env }, encoding: 'utf8' }).trim();
	git(['init', '-q', '-b', 'main']);
	git(['config', 'commit.gpgsign', 'false']);
	const write = (file, text) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	const commit = (file, text, message = `edit ${file}`, env = {}) => {
		if (file) {
			if (text === null) fs.rmSync(path.join(dir, file));
			else write(file, text);
		}
		git(['add', '-A']);
		git(['commit', '-q', '--allow-empty', '-m', message], env);
		return git(['rev-parse', 'HEAD']);
	};
	return { dir, git, write, commit };
}

export function runStep(run, { cwd, env = {}, shell = ['-e'] } = {}) {
	return spawnSync('bash', ['--noprofile', '--norc', ...shell, '-c', run], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
}

export function collect(r, env) {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
	const res = runStep(leakStep('collect added lines').run, {
		cwd: r.dir,
		env: { RUNNER_TEMP: tmp, EVENT_NAME: 'push', REF: 'refs/heads/feature', BEFORE: '', PR_BASE: '', ...env },
	});
	const file = path.join(tmp, 'added.txt');
	return { ...res, tmp, added: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
}
