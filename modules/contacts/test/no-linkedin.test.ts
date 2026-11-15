// CONTACTS ALONE REACHES NO LINKEDIN (cr-modules-018). The scraper, `/scrape-contact` and the two LinkedIn
// views left contacts for `@dreamteamer/connectors-linkedin`; contacts keeps every field, the `linkedin*`
// ones included, because a record written before the move must still check. Measured on the real engine:
// the packed closure compiled in a fresh workspace, never a reading of the source tree alone.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import { virginWorkspace, installPacked, closure, pkgOf, packed, run, cleanup, compiledDescriptor } from '../../../tests/helpers/workspace.ts';

after(cleanup);

describe('contacts alone: no LinkedIn scraper, command, view or env key', () => {
	let root;
	before(() => {
		root = virginWorkspace();
		installPacked(root, [...closure('contacts')]);
		const c = run(root, ['compile']);
		assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`);
	});

	test('compiles no /scrape-contact command and no scraping-contacts skill', () => {
		assert.ok(!fs.existsSync(path.join(root, '.dreamteamer', 'commands', 'scrape-contact.command.md')), '/scrape-contact was compiled');
		assert.ok(!fs.existsSync(path.join(root, '.dreamteamer', 'skills', 'scraping-contacts')), 'the scraping-contacts skill was compiled');
	});

	test('compiles neither LinkedIn view', () => {
		const dir = path.join(root, '.dreamteamer', 'ui-views');
		const views = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
		assert.deepEqual(views.filter((v) => /^contacts-(needs|review)-linkedin/.test(v)), []);
	});

	test('declares no env key, so .env.example and dt status ask for no LINKEDIN_USER_AGENT', () => {
		assert.equal(pkgOf('contacts').dreamteamer.env, undefined);
		const example = path.join(root, '.env.example');
		if (fs.existsSync(example)) assert.doesNotMatch(fs.readFileSync(example, 'utf8'), /LINKEDIN_USER_AGENT/);
		const s = run(root, ['status']);
		assert.equal(s.status, 0, s.stderr);
		assert.doesNotMatch(s.stdout + s.stderr, /LINKEDIN_USER_AGENT/);
	});

	test('the compiled descriptor keeps linkedin, linkedin_degree and linkedin_mutuals with their types', () => {
		const text = compiledDescriptor(root, 'contacts');
		assert.ok(text, 'no compiled contacts descriptor');
		const { fields } = yaml.load(text);
		assert.equal(fields.linkedin?.type, 'url');
		assert.equal(fields.linkedin_degree?.type, 'string');
		assert.deepEqual(fields.linkedin_degree?.enum, ['1st', '2nd', '3rd', 'none']);
		assert.equal(fields.linkedin_mutuals?.type, 'integer');
		assert.deepEqual(fields.status?.enum, ['draft', 'enriched', 'verified']);
		assert.equal(fields.status?.default, 'draft');
	});
});

// A person reading contacts 0.2.0 — its README, its descriptor — is never sent to a command or skill the
// package no longer ships, unless the same sentence names the package that ships it.
test('no shipped file of contacts names /scrape-contact or scraping-contacts without naming connectors-linkedin', () => {
	const dir = fs.mkdtempSync(path.join(path.dirname(packed('contacts')), 'unpacked-'));
	execFileSync('tar', ['-xzf', packed('contacts'), '-C', dir, '--strip-components', '1']);
	const offenders = [];
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) { walk(p); continue; }
			const text = fs.readFileSync(p, 'utf8');
			// a sentence: split on a full stop followed by space or a line end, and on blank lines
			for (const sentence of text.split(/\.\s+|\n\s*\n/)) {
				if (/\/scrape-contact|scraping-contacts/.test(sentence) && !sentence.includes('@dreamteamer/connectors-linkedin')) {
					offenders.push(`${path.relative(dir, p)}: ${sentence.trim().slice(0, 120)}`);
				}
			}
		}
	};
	walk(dir);
	assert.deepEqual(offenders, []);
});
