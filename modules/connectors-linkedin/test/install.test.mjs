// CONNECTORS-LINKEDIN BRINGS THE SCRAPER BACK, UNCHANGED (cr-modules-018). Installing the package next to
// contacts restores what contacts 0.1.3 carried: `/scrape-contact` and its binding on draft contacts, the
// `scraping-contacts` skill, the two LinkedIn views and the `LINKEDIN_USER_AGENT` key. Measured on the real
// engine with the packed closure, and once through the inline copy channel.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { virginWorkspace, installPacked, installCopied, closure, run, cleanup } from '../../../tests/helpers/workspace.mjs';

after(cleanup);

const ROUTES = { 'contacts-needs-linkedin': '/contacts/needs-linkedin', 'contacts-review-linkedin': '/contacts/review-linkedin' };

describe('connectors-linkedin, installed packed with its closure', () => {
	let root;
	before(() => {
		root = virginWorkspace();
		installPacked(root, [...closure('connectors-linkedin')]);
		const c = run(root, ['compile']);
		assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`);
	});

	test('compiles /scrape-contact and the scraping-contacts skill', () => {
		assert.ok(fs.existsSync(path.join(root, '.dreamteamer', 'commands', 'scrape-contact.command.md')), '/scrape-contact is not compiled');
		assert.ok(fs.existsSync(path.join(root, '.dreamteamer', 'skills', 'scraping-contacts', 'SKILL.md')), 'the scraping-contacts skill is not compiled');
		assert.ok(fs.existsSync(path.join(root, '.dreamteamer', 'skills', 'scraping-contacts', 'bin', 'li.mjs')), 'the skill arrives without li.mjs');
	});

	test('dt next contacts names scrape-contact', () => {
		const n = run(root, ['next', 'contacts']);
		assert.equal(n.status, 0, n.stderr);
		assert.match(n.stdout, /scrape-contact/);
	});

	test('both LinkedIn views compile, with their routes', () => {
		for (const [id, route] of Object.entries(ROUTES)) {
			const f = path.join(root, '.dreamteamer', 'ui-views', `${id}.ui-view.yaml`);
			assert.ok(fs.existsSync(f), `${id} is not compiled`);
			assert.equal(yaml.load(fs.readFileSync(f, 'utf8')).route, route);
		}
	});

	test('.env.example and dt status name LINKEDIN_USER_AGENT under connectors-linkedin', () => {
		const example = path.join(root, '.env.example');
		assert.ok(fs.existsSync(example), 'compile wrote no .env.example');
		assert.match(fs.readFileSync(example, 'utf8'), /# declared by @dreamteamer\/connectors-linkedin\nLINKEDIN_USER_AGENT=/);
		const s = run(root, ['status']);
		assert.equal(s.status, 0, s.stderr);
		assert.match(s.stdout, /connectors-linkedin\s+no setup\s+needs: LINKEDIN_USER_AGENT/);
		assert.doesNotMatch(s.stdout, /^\s*contacts\s.*LINKEDIN_USER_AGENT/m, 'contacts still asks for the key');
	});
});

test('connectors-linkedin through the inline copy channel compiles /scrape-contact', () => {
	const root = virginWorkspace();
	installCopied(root, [...closure('connectors-linkedin')]);
	const c = run(root, ['compile']);
	assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`);
	assert.ok(fs.existsSync(path.join(root, '.dreamteamer', 'commands', 'scrape-contact.command.md')));
	assert.ok(fs.existsSync(path.join(root, '.dreamteamer', 'skills', 'scraping-contacts', 'SKILL.md')));
});
