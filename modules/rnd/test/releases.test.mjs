// RELEASES (0.6.0) — a product's versions, each listing what it ships, walked on a real engine.
//
// What the descriptors, the bindings and the extension promise, measured rather than read: one release per
// product, package and version (`dt add` refuses the id, `dt check` refuses a record whose id stopped naming
// its own fields); a release answers ONE `dt next` verb per state — plan, cut, publish — and nothing once
// published; a change request that names a release is deployed by the release's publication, and its live
// acceptance review opens then and never before. The Northwind cast's records, nothing else. Each walk runs
// twice: rnd copied into the workspace, and rnd as the packed tarball a consumer installs.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { rndWorkspace, run, cleanupAll, put } from './helpers/rnd-workspace.mjs';
import { virginWorkspace, installPacked } from '../../../tests/helpers/workspace.mjs';

after(cleanupAll);

const ok = (r, what) => { assert.equal(r.status, 0, `${what}:\n${r.stderr}${r.stdout}`); return r; };
const dt = (root, ...args) => ok(run(root, args), `dt ${args.join(' ')}`);
const json = (root, ...args) => JSON.parse(dt(root, ...args, '--json').stdout);
const get = (root, ref) => json(root, 'get', ref);
/** The bindings `dt next` lists as AVAILABLE for one record — the verbs a session may run on it now. */
const available = (root, ref) => {
	const out = json(root, 'next', ref);
	const id = ref.replace(/^rnd\/[a-z-]+\//, '');
	return out.commands.filter((c) => c.states?.[id] === 'available').map((c) => c.binding.replace(/^command-bindings\//, ''));
};

const PRODUCT = 'rnd/products/grantee-portal';
const REL = 'rnd/releases/grantee-portal/1.4.0';
const CR = 'rnd/change-requests/otp-expiry';

/** A workspace with rnd PACKED and installed as a dependency — the files list a consumer gets. */
function packedWorkspace() {
	const root = virginWorkspace();
	installPacked(root, ['rnd']);
	fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
	dt(root, 'compile');
	return root;
}

function seed(root) {
	put(root, 'data/rnd/products/grantee-portal.product.md', '---\nname: Grantee portal\n---\n');
	dt(root, 'add', 'repos', '--name', 'grantee-portal', '--url', 'https://git.example/northwind/grantee-portal.git');
}

for (const [how, make] of [['copied', rndWorkspace], ['packed', packedWorkspace]]) {
	describe(`${how}: one release per product, package and version — the id is the identity (acceptance 1)`, () => {
		const root = make();
		seed(root);
		test('a release is added by its version and product, planned, under <product>/<version>', () => {
			const { id } = json(root, 'add', 'rnd/releases', '1.4.0', '--product', PRODUCT);
			assert.equal(id, 'grantee-portal/1.4.0');
			const r = get(root, REL);
			assert.equal(r.version, '1.4.0'); assert.equal(r.status, 'planned');
			assert.ok(fs.existsSync(path.join(root, 'data/rnd/releases/grantee-portal/1.4.0.release.md')));
		});
		test('a product that ships several packages names the package, which joins the id', () => {
			const { id } = json(root, 'add', 'rnd/releases', '0.3.0', '--product', PRODUCT, '--package', 'roster');
			assert.equal(id, 'grantee-portal/roster/0.3.0');
		});
		test('dt add refuses a second release of one product and version', () => {
			const r = run(root, ['add', 'rnd/releases', '1.4.0', '--product', PRODUCT]);
			assert.notEqual(r.status, 0); assert.match(r.stderr + r.stdout, /already exists/);
		});
		test('dt check refuses a hand-written second release of one product and version, naming both', () => {
			dt(root, 'check');
			const copy = put(root, 'data/rnd/releases/grantee-portal/1.4.1.release.md', `---\nproduct: ${PRODUCT}\nversion: 1.4.0\n---\n`);
			const r = run(root, ['check']);
			assert.notEqual(r.status, 0, 'check passed with two releases of grantee-portal 1.4.0');
			const out = r.stderr + r.stdout;
			assert.match(out, /a second release of grantee-portal\/1\.4\.0: rnd\/releases\/grantee-portal\/1\.4\.0 and rnd\/releases\/grantee-portal\/1\.4\.1 both claim it/);
			assert.match(out, /rnd\/releases\/grantee-portal\/1\.4\.1 names grantee-portal\/1\.4\.0 in its fields/);
			fs.rmSync(copy);
			dt(root, 'check');
		});
		test('dt check refuses a release whose version was changed under its id — dt set leaves the id behind', () => {
			dt(root, 'set', REL, 'version=1.5.0');
			const r = run(root, ['check']);
			assert.notEqual(r.status, 0);
			assert.match(r.stderr + r.stdout, /rnd\/releases\/grantee-portal\/1\.4\.0 names grantee-portal\/1\.5\.0 in its fields/);
			dt(root, 'set', REL, 'version=1.4.0');
			dt(root, 'check');
		});
		test('re-versioning a planned release is two writes — set version, then rename — and checks clean after both (r1-02)', () => {
			const old = 'rnd/releases/grantee-portal/roster/0.3.0';
			dt(root, 'add', 'rnd/change-requests', '--key', 'roster-sort', '--name', 'Roster sort', '--products', PRODUCT, '--release', old);
			dt(root, 'set', old, 'version=0.3.1');
			assert.notEqual(run(root, ['check']).status, 0, 'between the two writes the id still says 0.3.0');
			dt(root, 'rename', old, 'grantee-portal/roster/0.3.1');
			assert.equal(get(root, 'rnd/change-requests/roster-sort').release, 'rnd/releases/grantee-portal/roster/0.3.1', 'the rename moved the request\'s release');
			dt(root, 'check');
		});
		test('the step marks are required by their step: a cut needs repo, tag and cut_on; a publication its instant and URLs', () => {
			const cut = run(root, ['set', REL, 'status=cut']);
			assert.notEqual(cut.status, 0, 'a cut with no tag was written');
			const pub = run(root, ['set', REL, 'status=published', 'tag=grantee-portal-v1.4.0', 'repo=repos/grantee-portal', 'cut_on=2026-01-20T10:00:00+02:00']);
			assert.notEqual(pub.status, 0, 'a publication with no published_on was written');
			assert.equal(get(root, REL).status, 'planned', 'nothing was written');
		});
	});

	describe(`${how}: /rnd:release walks plan → cut → publish, one dt next answer per state (acceptance 4)`, () => {
		const root = make();
		seed(root);
		const steps = [];
		const expectNext = (label, binding) => {
			const got = available(root, REL);
			steps.push([label, got]);
			assert.deepEqual(got, binding ? [binding] : [], `${label}: dt next ${REL} named ${JSON.stringify(got)}`);
		};
		test('planned, no notes: plan', () => {
			dt(root, 'add', 'rnd/releases', '1.4.0', '--product', PRODUCT);
			expectNext('planned', 'rnd--release--releases--plan');
		});
		test('the notes written: the cut — a person\'s step, so the binding says the agent stops', () => {
			dt(root, 'set', REL, 'notes=An expired one-time code is refused.');
			expectNext('notes written', 'rnd--release--releases--cut');
			const b = json(root, 'next', REL).commands.find((c) => c.binding.endsWith('rnd--release--releases--cut'));
			assert.match(b.description, /a person's/);
		});
		test('the person tagged, the cut recorded: publish', () => {
			dt(root, 'set', REL, 'status=cut', 'tag=grantee-portal-v1.4.0', 'repo=repos/grantee-portal', 'cut_on=2026-01-20T10:00:00+02:00');
			expectNext('cut', 'rnd--release--releases--publish');
		});
		test('the registries answered: published, and nothing more is open', () => {
			dt(root, 'set', REL, 'status=published', 'published_on=2026-01-20T11:00:00+02:00', 'published_to=https://www.npmjs.com/package/grantee-portal/v/1.4.0');
			expectNext('published', null);
			dt(root, 'check');
		});
		test('a rolled-back release opens nothing either', () => {
			dt(root, 'set', REL, 'status=rolled-back');
			expectNext('rolled back', null);
		});
	});

	describe(`${how}: a request ships in its release — deployed_on at publication, the live review never before (acceptances 2 and 3)`, () => {
		const root = make();
		seed(root);
		test('a verified request that names a planned release answers /rnd:release, not /rnd:deploy', () => {
			dt(root, 'add', 'rnd/releases', '1.4.0', '--product', PRODUCT);
			dt(root, 'add', 'rnd/change-requests', '--key', 'otp-expiry', '--name', 'OTP expiry', '--products', PRODUCT,
				'--description', 'A one-time code older than five minutes is refused.', '--status', 'accepted',
				'--verified_on', '2026-01-15T11:00:00+02:00', '--release', REL);
			assert.deepEqual(available(root, CR), ['rnd--release--change-requests']);
		});
		let ISSUE;
		test('the release lists what it ships back — the request and an issue — and the product lists the release', () => {
			const { id } = json(root, 'add', 'rnd/issues', '--name', 'An expired code is accepted', '--repo', 'repos/grantee-portal', '--product', PRODUCT, '--status', 'fixed', '--release', REL);
			const rel = get(root, REL);
			assert.deepEqual(rel.change_requests, [CR]);
			assert.deepEqual(rel.issues, [`rnd/issues/${id}`]);
			ISSUE = `rnd/issues/${id}`;
			assert.deepEqual(get(root, PRODUCT).releases, [REL]);
		});
		test('deployed_on written by hand while the release is only cut: the live review stays closed', () => {
			dt(root, 'set', REL, 'notes=An expired one-time code is refused.');
			dt(root, 'set', REL, 'status=cut', 'tag=grantee-portal-v1.4.0', 'repo=repos/grantee-portal', 'cut_on=2026-01-20T10:00:00+02:00');
			assert.deepEqual(available(root, CR), ['rnd--release--change-requests'], 'still waiting on the release');
			dt(root, 'set', CR, 'deployed_on=2026-01-20T10:30:00+02:00');
			assert.deepEqual(available(root, CR), [], 'the live review opened before the release was published');
			dt(root, 'set', CR, 'deployed_on=');
			assert.equal(get(root, CR).deployed_on, undefined);
		});
		test('published, the request stamped from it: the live acceptance review is the one verb', () => {
			dt(root, 'set', REL, 'status=published', 'published_on=2026-01-20T11:00:00+02:00', 'published_to=https://www.npmjs.com/package/grantee-portal/v/1.4.0');
			assert.deepEqual(available(root, CR), ['rnd--release--change-requests'], 'published, but deployed_on is the publish step\'s stamp');
			assert.deepEqual(available(root, REL), ['rnd--release--releases--stamp'], 'the release names the stamp while a carried request is unstamped (r1-04)');
			dt(root, 'set', CR, `deployed_on=${get(root, REL).published_on}`);
			assert.deepEqual(available(root, CR), ['rnd--review--change-requests--deploy']);
			assert.deepEqual(available(root, REL), ['rnd--release--releases--stamp'], 'the issue it carries has no fixed_in yet (the test stage\'s h6)');
			dt(root, 'set', ISSUE, `fixed_in=${get(root, REL).tag}`);
			assert.deepEqual(available(root, REL), [], 'every carried request and issue stamped: the release answers nothing');
		});
		test('the live review approves: implemented, nothing open, and the records check clean', () => {
			dt(root, 'set', CR, 'status=implemented');
			assert.deepEqual(available(root, CR), []);
			dt(root, 'check');
		});
		test('the release rolled back: a request it still carries, deployed, has no live review', () => {
			dt(root, 'add', 'rnd/change-requests', '--key', 'roster-csv', '--name', 'Roster CSV', '--products', PRODUCT, '--status', 'accepted',
				'--verified_on', '2026-01-15T11:00:00+02:00', '--release', REL, '--deployed_on', '2026-01-20T11:00:00+02:00');
			assert.deepEqual(available(root, 'rnd/change-requests/roster-csv'), ['rnd--review--change-requests--deploy']);
			dt(root, 'set', REL, 'status=rolled-back');
			// h5: the stamped request still reads deployed — the release names its rollback step, the request /rnd:release
			assert.deepEqual(available(root, 'rnd/change-requests/roster-csv'), ['rnd--release--change-requests']);
			assert.deepEqual(available(root, REL), ['rnd--release--releases--rollback']);
		});
		test('a request scheduled into a rolled-back release answers /rnd:release, and the release its rollback step (h7)', () => {
			dt(root, 'add', 'rnd/change-requests', '--key', 'roster-sort', '--name', 'Roster sort', '--products', PRODUCT, '--status', 'accepted',
				'--verified_on', '2026-01-15T11:00:00+02:00', '--release', REL);
			assert.deepEqual(available(root, 'rnd/change-requests/roster-sort'), ['rnd--release--change-requests']);
			assert.deepEqual(available(root, REL), ['rnd--release--releases--rollback']);
		});
		test('the rollback step moves each one off — to the next planned release, or to none — and then closes', () => {
			const next = 'rnd/releases/grantee-portal/1.4.1';
			dt(root, 'add', 'rnd/releases', '1.4.1', '--product', PRODUCT);
			dt(root, 'set', 'rnd/change-requests/roster-csv', 'deployed_on=', `release=${next}`);
			assert.deepEqual(available(root, 'rnd/change-requests/roster-csv'), ['rnd--release--change-requests'], 'waits for the next release');
			assert.deepEqual(available(root, REL), ['rnd--release--releases--rollback'], 'roster-sort and the issue are still on it');
			dt(root, 'set', 'rnd/change-requests/roster-sort', 'release=');
			assert.deepEqual(available(root, 'rnd/change-requests/roster-sort'), ['rnd--deploy--change-requests'], 'no release: its own deploy');
			dt(root, 'set', ISSUE, 'release=', 'fixed_in=');
			assert.deepEqual(available(root, REL), [], 'only the implemented request is left — a person\'s call, not the step\'s');
			assert.deepEqual(get(root, REL).change_requests, [CR]);
			dt(root, 'check');
		});
		test('a request with no release keeps its own deploy, then the live review', () => {
			dt(root, 'add', 'rnd/change-requests', '--key', 'audit-log', '--name', 'Audit log', '--products', PRODUCT, '--status', 'accepted', '--verified_on', '2026-01-15T11:00:00+02:00');
			assert.deepEqual(available(root, 'rnd/change-requests/audit-log'), ['rnd--deploy--change-requests']);
			dt(root, 'set', 'rnd/change-requests/audit-log', 'deployed_on=2026-01-16T10:00:00+02:00');
			assert.deepEqual(available(root, 'rnd/change-requests/audit-log'), ['rnd--review--change-requests--deploy']);
		});
	});
}

// Retro-filing: a workspace that has shipped before files its past releases as its first records. The fixture
// is that shape in the synthetic cast — a product that ships one package, a product that ships several (two
// versions of one package among them), each release at its TRUE status (one only on a branch: planned, no tag)
// and naming the change requests it carries — checked
// clean on the real engine, so filing real ones is a copy of a record, not a design.
describe('the fixture — a product with several packages and one with one, each release naming what it carries', () => {
	const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'releases-northwind');
	test('copied into a workspace, every record checks clean and each release lists its requests', () => {
		const root = rndWorkspace();
		fs.cpSync(path.join(FIX, 'data'), path.join(root, 'data'), { recursive: true });
		dt(root, 'add', 'repos', '--name', 'northwind-portal', '--url', 'https://git.example/northwind/portal.git');
		dt(root, 'add', 'repos', '--name', 'northwind-modules', '--url', 'https://git.example/northwind/modules.git');
		for (const c of ['rnd/releases', 'rnd/products']) dt(root, 'relations', 'rebuild', c);
		dt(root, 'check');
		const rows = json(root, 'list', 'rnd/releases');
		const ids = (rows.rows ?? rows).map((r) => r.id).sort();
		assert.deepEqual(ids, ['northwind-modules/billing/0.2.0', 'northwind-modules/roster/0.5.1', 'northwind-modules/roster/0.5.2', 'northwind-portal/0.41.0']);
		assert.deepEqual(get(root, 'rnd/releases/northwind-modules/roster/0.5.2').change_requests, ['rnd/change-requests/roster-review-gates']);
		// what is published says so; a version that only exists on a branch is planned, with no tag (r1-01)
		const status = Object.fromEntries(ids.map((id) => [id, get(root, `rnd/releases/${id}`).status]));
		assert.deepEqual(status, { 'northwind-modules/billing/0.2.0': 'planned', 'northwind-modules/roster/0.5.1': 'published', 'northwind-modules/roster/0.5.2': 'published', 'northwind-portal/0.41.0': 'published' });
		assert.equal(get(root, 'rnd/releases/northwind-modules/billing/0.2.0').tag, undefined);
		assert.deepEqual(available(root, 'rnd/change-requests/billing-teams'), ['rnd--release--change-requests'], 'a verified request in a planned release waits for it');
	});
});
