import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {validateConfig,renderPlan,inspectRepository} from '../lib/identities.mjs';
const config=(root)=>({identities:[{id:'personal',root,name:'Dana Oren',email:'dana@northwind.example',host:'github.com',sshAlias:'github-personal',keyPath:'~/.ssh/id_personal'}]});

test('render is pure and proposes explicit alias without URL rewrites',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'git-identities-'));
 try {
 const p=renderPlan(config('~/Documents/projects/personal'),{home:dir});
 assert.match(p.gitIncludes,/includeIf "gitdir:/); assert.match(p.gitIncludes,/personal\/"/);
 assert.match(p.sshBlocks,/IdentitiesOnly yes/); assert.equal(p.clonePatterns[0].remote,'git@github-personal:<owner>/<repository>.git');
 assert.ok(!JSON.stringify(p).includes('insteadOf')); assert.deepEqual(fs.readdirSync(dir),[]);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('rejects unsafe lines, globs, relative roots and overlapping identities',()=>{
 for(const [key,value] of [['name','Dana\n[core]'],['sshAlias','x *'],['host','host\nProxyCommand x'],['root','relative'],['root','/tmp/*']]) {
 const c=config('/tmp/personal');c.identities[0][key]=value;assert.throws(()=>validateConfig(c));
 }
 const c=config('/tmp/personal');c.identities.push({...c.identities[0],id:'work',sshAlias:'github-work',root:'/tmp/personal/work'});assert.throws(()=>validateConfig(c),/Overlapping/);
});

test('real Git includeIf resolves nested repo; local override is detected; no files changed',()=>{
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'git-identities-')));
 const env={...process.env,HOME:home,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(home,'.gitconfig')};
 delete env.GIT_CONFIG_COUNT;delete env.GIT_CONFIG_PARAMETERS;
 const git=(args,cwd)=>execFileSync('git',args,{cwd,env,stdio:['ignore','pipe','pipe']});
 try {
 const root=path.join(home,'projects','personal'); const repo=path.join(root,'nested','repo');fs.mkdirSync(repo,{recursive:true});git(['init','-q'],repo);
 const c=config(root),p=renderPlan(c,{home});fs.writeFileSync(env.GIT_CONFIG_GLOBAL,p.gitIncludes);
 for(const f of p.identityFiles)fs.writeFileSync(f.path,f.content);
 git(['remote','add','origin','git@github-personal:northwind/sample.git'],repo);
 const before=fs.readFileSync(path.join(repo,'.git/config'),'utf8');
 let r=inspectRepository(repo,c,{home,env}); assert.equal(r.state,'configured');assert.equal(r.authentication,'not-tested');
 assert.equal(fs.readFileSync(path.join(repo,'.git/config'),'utf8'),before);
 assert.ok(!JSON.stringify(r).includes('dana@'));assert.ok(!JSON.stringify(r).includes(home));
 git(['config','user.email','sam@northwind.example'],repo);r=inspectRepository(repo,c,{home,env});assert.equal(r.state,'degraded');assert.equal(r.checks.commitEmail,false);
 git(['remote','set-url','origin','https://github.com/northwind/sample.git'],repo);assert.equal(inspectRepository(repo,c,{home,env}).checks.originAlias,false);
 assert.equal(inspectRepository(home,c,{home,env}).state,'unavailable');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('CLI rejects malformed config without echoing input values',()=>{
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'git-identities-')));
 try {const file=path.join(home,'bad.json');fs.writeFileSync(file,'PRIVATE INVALID INPUT');
 const r=spawnSync(process.execPath,['modules/git-identities/bin/git-identities.mjs','plan',file],{encoding:'utf8'});
 assert.equal(r.status,2);assert.ok(!r.stderr.includes('PRIVATE'));assert.equal(r.stdout,'');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});

test('distinct folders select distinct identities and never use a global fallback as success',()=>{
 const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'git-identities-')));
 const env={...process.env,HOME:home,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(home,'.gitconfig')};
 delete env.GIT_CONFIG_COUNT;delete env.GIT_CONFIG_PARAMETERS;
 const git=(args,cwd)=>execFileSync('git',args,{cwd,env,stdio:['ignore','pipe','pipe']});
 try {
 const c=config(path.join(home,'personal'));
 c.identities.push({...c.identities[0],id:'work',root:path.join(home,'work'),email:'sam@northwind.example',name:'Sam Diaz',sshAlias:'github-work'});
 const p=renderPlan(c,{home}); fs.writeFileSync(env.GIT_CONFIG_GLOBAL,'[user]\n name = Wrong Fallback\n email = fallback@northwind.example\n'+p.gitIncludes);
 for(const f of p.identityFiles)fs.writeFileSync(f.path,f.content);
 for(const identity of c.identities){
 const repo=path.join(identity.root,'repo');fs.mkdirSync(repo,{recursive:true});git(['init','-q'],repo);
 git(['remote','add','origin',`git@${identity.sshAlias}:northwind/sample.git`],repo);
 assert.equal(inspectRepository(repo,c,{home,env}).state,'configured');
 }
 const outside=path.join(home,'elsewhere');fs.mkdirSync(outside);git(['init','-q'],outside);
 assert.equal(inspectRepository(outside,c,{home,env}).state,'unconfigured');
 fs.writeFileSync(env.GIT_CONFIG_GLOBAL,'[user]\n name = Wrong Fallback\n email = fallback@northwind.example\n');
 assert.equal(inspectRepository(path.join(c.identities[0].root,'repo'),c,{home,env}).state,'degraded');
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
