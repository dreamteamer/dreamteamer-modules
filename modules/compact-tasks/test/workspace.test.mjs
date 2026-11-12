import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import yaml from 'js-yaml';
import {CHANNELS,cleanup,virginWorkspace,compileAndCheck,run,compiledDescriptor} from '../../../tests/helpers/workspace.mjs';
after(cleanup);
for(const [channel,install] of Object.entries(CHANNELS))test(`${channel}: compact navigation preserves task lifecycle, records and deep links`,()=>{
  const root=virginWorkspace();install(root,['core','compact-tasks']);compileAndCheck(root);
  for(const status of ['suggested','todo','doing','blocked','done','closed']){
    const r=run(root,['add','tasks','--name',`Example ${status}`,'--status',status]);assert.equal(r.status,0,r.stdout+r.stderr);
  }
  const dir=path.join(root,'data','tasks');const before=fs.readdirSync(dir).map(f=>[f,fs.readFileSync(path.join(dir,f),'utf8')]);
  compileAndCheck(root);assert.deepEqual(fs.readdirSync(dir).map(f=>[f,fs.readFileSync(path.join(dir,f),'utf8')]),before);
  const load=n=>yaml.load(fs.readFileSync(path.join(root,'.dreamteamer','ui-views',`${n}.ui-view.yaml`),'utf8'));
  for(const n of ['tasks-board','tasks-list']){
    const d=load(n);assert.deepEqual(d.filter.status._in,['suggested','todo','doing','blocked']);
    assert.ok(d.display.list.columns.includes('created'));
  }
  assert.equal(load('tasks-board').route,'/tasks/board');
  assert.equal(load('tasks-list').route,'/tasks/list');
  assert.ok(load('tasks-board').display.list.options.group_by == null);
  for(const n of ['tasks-suggested','tasks-mine','tasks-by-assignee','tasks-planned-gantt','tasks-active-gantt','tasks-retro-gantt']){
    const d=load(n);assert.ok(d.route,'deep link preserved');assert.ok(d.display.nav == null);
  }
  const task=yaml.load(compiledDescriptor(root,'tasks'));assert.deepEqual(task.fields.status.enum,['suggested','todo','doing','blocked','done','closed']);
});
