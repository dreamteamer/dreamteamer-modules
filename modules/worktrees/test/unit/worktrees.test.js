// Tier 1 — what a failed sandbox install is reported as. The reason string is the only
// thing a `--json` caller reads, so it must carry the lines that NAME the failure and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDiagnosis } from '../../src/worktrees.js';

test('the ✖ lines and npm\'s error lines survive; the board and npm\'s usage text do not', () => {
	const out = [
		'linked worktree of /w', '▶ dependencies: x missing', '✖ dependencies failed (exit 1)',
		'npm error code EUSAGE', 'npm error', 'npm error Missing: x@ from lock file',
		'npm error Clean install a project', 'npm error Usage:', 'npm error npm ci', 'npm error Options:',
		'✖ compile: compile error: proofs is not a known kind',
	].join('\n');
	assert.deepEqual(installDiagnosis(out), [
		'✖ dependencies failed (exit 1)', 'npm error code EUSAGE', 'npm error Missing: x@ from lock file',
		'✖ compile: compile error: proofs is not a known kind',
	]);
});

test('with nothing named, the last lines; always bounded in count and width', () => {
	assert.deepEqual(installDiagnosis('a\nb\nc'), ['a', 'b', 'c']);
	const many = Array.from({ length: 40 }, (_, i) => `✖ ${i} ${'y'.repeat(500)}`).join('\n');
	const d = installDiagnosis(many);
	assert.equal(d.length, 12);
	assert.ok(d.every((l) => l.length <= 301));
});
