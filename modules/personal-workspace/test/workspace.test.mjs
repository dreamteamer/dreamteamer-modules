import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {CHANNELS, cleanup, virginWorkspace, compileAndCheck, compiledDescriptor, run, packedFiles} from '../../../tests/helpers/workspace.mjs';

after(cleanup);
for (const [channel, install] of Object.entries(CHANNELS)) {
  test(`${channel}: private notes and active task views compile with core only`, () => {
    const root = virginWorkspace();
    install(root, ['core', 'personal-workspace']);
    compileAndCheck(root);
    for (const collection of ['briefs', 'blurbs', 'meta-analyses']) {
      assert.ok(compiledDescriptor(root, collection), `${collection} must be discovered`);
      const add = run(root, ['add', collection, '--name', 'Synthetic review', '--status', 'draft']);
      assert.equal(add.status, 0, add.stdout + add.stderr);
    }
    const check = run(root, ['check']);
    assert.equal(check.status, 0, check.stdout + check.stderr);
    for (const kind of ['board','list']) {
      const file = path.join(root, '.dreamteamer', 'ui-views', `personal-tasks-${kind}.ui-view.yaml`);
      assert.ok(fs.existsSync(file), `view ${kind} compiled`);
      const text = fs.readFileSync(file, 'utf8');
      assert.match(text, /todo/); assert.match(text, /doing/); assert.match(text, /blocked/);
    }
  });
}
test('package ships schemas and views but no data or tests', () => {
  const files = packedFiles('personal-workspace');
  assert.equal(files.filter(f=>f.startsWith('collections/')).length, 3);
  assert.equal(files.filter(f=>f.startsWith('ui-views/')).length, 2);
  assert.ok(!files.some(f=>f.startsWith('data/') || f.startsWith('test/')));
});
