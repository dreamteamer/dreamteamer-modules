#!/usr/bin/env node
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {renderPlan,inspectRepository} from '../lib/identities.mjs';

export function main(args=process.argv.slice(2)) {
  const [verb,configFile,repo]=args;
  if (!['plan','doctor'].includes(verb) || !configFile || (verb==='doctor'&&!repo) || args.length>(verb==='doctor'?3:2)) {
    console.error('Usage: dt-git-identities plan <private-config.json> | doctor <private-config.json> <repository>'); return 2;
  }
  try {
    const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
    const result=verb==='plan'?renderPlan(config):inspectRepository(repo,config);
    console.log(JSON.stringify(result,null,2));
    return verb==='doctor'&&result.state!=='configured'?1:0;
  } catch { console.error('Cannot read or validate identity configuration. Check the documented schema and local file access. No changes made.'); return 2; }
}
if (process.argv[1] && fs.realpathSync(process.argv[1])===fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode=main();
