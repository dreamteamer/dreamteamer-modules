import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {installVsix} from '../src/extension-cache.mjs';
test('identical content skips; changed content, missing install, and failed installs do not',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'extension-cache-'));
 try {
  const extensions=path.join(root,'extensions'),vsix=path.join(root,'extension.vsix');await fs.mkdir(extensions);await fs.writeFile(vsix,'one');let calls=0,fail=false;
  const run=async()=>{calls++;if(fail)throw new Error('install failed');await fs.mkdir(path.join(extensions,'example.editor-1'),{recursive:true});await fs.writeFile(path.join(extensions,'example.editor-1/package.json'),'{}');await fs.writeFile(path.join(extensions,'extensions.json'),JSON.stringify([{identifier:{id:'example.editor'},relativeLocation:'example.editor-1'}]));};
  const args={runtime:'code-server',common:[],extensions,profile:root,vsix,id:'example.editor',run};
  assert.equal((await installVsix(args)).installed,true);assert.equal((await installVsix(args)).installed,false);assert.equal(calls,1);
  await fs.writeFile(vsix,'two');assert.equal((await installVsix(args)).installed,true);
  await fs.rm(path.join(extensions,'example.editor-1/package.json'));assert.equal((await installVsix(args)).installed,true);
  await fs.writeFile(vsix,'three');fail=true;await assert.rejects(installVsix(args),/install failed/);fail=false;assert.equal((await installVsix(args)).installed,true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('marketplace replaces same-version local installs, caches verification, and retries failures',async()=>{
 const {installMarketplace}=await import('../src/extension-cache.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'marketplace-cache-'));
 try{
  const extensions=path.join(root,'extensions'), location=path.join(extensions,'example.editor-1.0.0');
  await fs.mkdir(location,{recursive:true});
  const entries=[{identifier:{id:'example.editor'},version:'1.0.0',relativeLocation:'example.editor-1.0.0'}];
  const inventory=path.join(extensions,'extensions.json');
  const seed=async()=>{await fs.writeFile(inventory,JSON.stringify(entries));await fs.writeFile(path.join(location,'package.json'),JSON.stringify({version:'1.0.0'}));};
  await seed();const calls=[];let fail=false;
  const run=async(_,args)=>{calls.push(args);if(args.includes('--uninstall-extension'))await fs.writeFile(inventory,'[]');else{if(fail)throw new Error('offline');await seed();}};
  const args={runtime:'code-server',common:[],extensions,profile:root,id:'example.editor',version:'1.0.0',run};
  assert.equal((await installMarketplace(args)).installed,true);
  assert.ok(calls[0].includes('--uninstall-extension'));assert.ok(calls[1].includes('example.editor@1.0.0'));
  assert.equal((await installMarketplace(args)).installed,false);assert.equal(calls.length,2);
  await fs.writeFile(inventory,'[]');fail=true;await assert.rejects(installMarketplace(args),/offline/);
  fail=false;assert.equal((await installMarketplace(args)).installed,true);
  await assert.rejects(installMarketplace({...args,version:'latest'}),/exact/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
