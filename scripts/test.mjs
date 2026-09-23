import ts from 'typescript';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
fs.mkdirSync('.test-build',{recursive:true});
for(const file of fs.readdirSync('src')) {
  if(file.endsWith('.ts')) {
    const {outputText}=ts.transpileModule(fs.readFileSync('src/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}});
    fs.writeFileSync('.test-build/'+file.replace(/\.ts$/,'.js'),outputText);
  } else if(file.endsWith('.json')) fs.copyFileSync('src/'+file,'.test-build/'+file);
}
fs.writeFileSync('.test-build/package.json','{"type":"commonjs"}');
const r=spawnSync(process.execPath,['--test','tests/core.test.cjs'],{stdio:'inherit'});process.exit(r.status??1);
