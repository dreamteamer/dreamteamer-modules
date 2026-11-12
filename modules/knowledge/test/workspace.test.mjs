import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CHANNELS, cleanup, virginWorkspace, compileAndCheck, compiledDescriptor, run, packedFiles} from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const hash = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const fixtures = {
  blurbs: ['blurb', 'name: Preserve an idea\nstatus: draft\nraw_input: "Maybe try this later, not a commitment."\ntags: [idea]\n', 'Original interpretation.'],
  briefs: ['brief', 'name: A reader document\nstatus: final\naudience: A project team\npurpose: Explain an option\nprojects: [Example workstream]\nsources: ["file:notes/example.md"]\nsource: "file:notes/example.md"\nconfidence: normal\n', 'A source-grounded report.'],
  'meta-analyses': ['meta-analysis', 'title: A cross-domain pattern\nperiod_start: 2026-01-01\nperiod_end: 2026-01-31\nsources_count: 3\nsources_token_count: 1000\nsources_description: Three synthetic notes, estimated tokens\nprompt: Review the same three notes\n', 'Thoughts and documents show a recurring pattern.']
};
for (const [channel, install] of Object.entries(CHANNELS)) {
  test(`${channel}: preserves existing dated records and operates all three collections`, () => {
    const root=virginWorkspace();
    install(root,['core','knowledge']);
    const paths=[];
    for(const [name,[suffix,fields,body]] of Object.entries(fixtures)){
      const folder=path.join(root,'data',name);fs.mkdirSync(folder,{recursive:true});
      const file=path.join(folder,`2026-01-31--example.${suffix}.md`);
      fs.writeFileSync(file,`---\n${fields}created: 2026-01-31T12:00:00Z\n---\n\n${body}\n`);paths.push(file);
    }
    const before=paths.map(hash);
    compileAndCheck(root);
    assert.deepEqual(paths.map(hash),before,'schema adoption must not rewrite data');
    for(const name of Object.keys(fixtures)){
      assert.ok(compiledDescriptor(root,name));
      const get=run(root,['get',`${name}/2026-01-31--example`]);assert.equal(get.status,0,get.stdout+get.stderr);
    }
    const digest=run(root,['set','blurbs/2026-01-31--example','--status','digested']);assert.equal(digest.status,0,digest.stdout+digest.stderr);
    assert.match(fs.readFileSync(paths[0],'utf8'),/Maybe try this later, not a commitment/);
    const invalid=run(root,['set','blurbs/2026-01-31--example','--status','final']);assert.notEqual(invalid.status,0);
    const brief=run(root,['add','briefs','--name','New reader document','--status','draft']);assert.equal(brief.status,0,brief.stdout+brief.stderr);
    const meta=run(root,['add','meta-analyses','--title','A new pattern']);assert.equal(meta.status,0,meta.stdout+meta.stderr);
    const files=fs.readdirSync(path.join(root,'data','meta-analyses'));assert.ok(files.some(f=>/^\d{4}-\d{2}-\d{2}--a-new-pattern\.meta-analysis\.md$/.test(f)));
    compileAndCheck(root);
    assert.ok(fs.existsSync(path.join(root,'.dreamteamer','skills','working-with-knowledge','SKILL.md')));
  });
}
test('package excludes data/tests and includes the working procedure',()=>{
  const files=packedFiles('knowledge');assert.ok(files.includes('skills/working-with-knowledge/SKILL.md'));
  assert.ok(!files.some(f=>f.startsWith('data/')||f.startsWith('test/')));
});
