'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {
  parseArchive,fileBytes,inspectInstalledShell,recoverInterrupted,
  validatedRecovery,digest,decodeJson,
}=require('./dev-shell-delta.cjs');
const sum=bytes=>createHash('sha256').update(bytes).digest('hex');
const NAME='ordax-os-desktop-dev',VERSION='0.1.0-alpha.21';
const MAIN=Buffer.from('console.log("trusted")\n');
const LAYOUT=Buffer.from('exports.layout=true\n');
const pkg=Buffer.from(JSON.stringify({name:NAME,version:VERSION})+'\n');
function archive(files={'main.cjs':MAIN,'window-layout.cjs':LAYOUT,'package.json':pkg}){
  const entries={},payload=[];
  let size=0;
  for(const [name,data] of Object.entries(files)){
    entries[name]={size:data.length,offset:String(size),integrity:{
      algorithm:'SHA256',hash:sum(data),blockSize:4*1024*1024,blocks:[sum(data)],
    }};
    size+=data.length;payload.push(data);
  }
  const json=Buffer.from(JSON.stringify({files:entries}));
  const pickle=4+json.length+(4-json.length%4)%4;
  const head=Buffer.alloc(12+pickle);
  head.writeUInt32LE(4,0);head.writeUInt32LE(4+pickle,4);
  head.writeUInt32LE(pickle,8);head.writeUInt32LE(json.length,12);
  json.copy(head,16);
  return Buffer.concat([head,...payload]);
}
function scenario(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-safe-shell-inspection-'));
  const install=path.join(root,'install'),profile=path.join(root,'profile');
  const live=path.join(install,'resources','app.asar');
  const exe=path.join(install,'OrdaX OS Desktop Dev.exe');
  fs.mkdirSync(path.dirname(live),{recursive:true});
  fs.mkdirSync(profile,{recursive:true});
  const prior=archive();
  fs.writeFileSync(live,prior);fs.writeFileSync(exe,'dummy executable only');
  fs.writeFileSync(path.join(profile,'desktop-dev-update-state.json'),
    JSON.stringify({pendingSha:null,attemptedSha:null}));
  const approved={
    revision:'a'.repeat(40),
    manifest:{name:NAME,version:VERSION},
    files:{'main.cjs':MAIN,'window-layout.cjs':LAYOUT},
  };
  const loc={repo:root,install,profile,live,exe};
  return {root,loc,prior,approved,
    backup:path.join(install,'resources','app.asar.delta-rollback')};
}
const clean=t=>{
  const f=scenario();
  t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
  return f;
};
test('read-only verification reports CURRENT only for exact Git source bytes',t=>{
  const f=clean(t);
  const before=digest(fs.readFileSync(f.loc.live));
  assert.deepEqual(inspectInstalledShell(f.loc,f.approved),{
    source_commit:'a'.repeat(40),changed_files:[],installer_required:false,
  });
  assert.equal(digest(fs.readFileSync(f.loc.live)),before);
  assert.equal(fs.existsSync(f.backup),false);
});
test('changed Electron bytes require an installer; no ASAR delta is ever written',t=>{
  const f=clean(t);
  const candidate={...f.approved,files:{
    ...f.approved.files,'main.cjs':Buffer.from('console.log("new")\n'),
  }};
  const inspected=inspectInstalledShell(f.loc,candidate);
  assert.equal(inspected.installer_required,true);
  assert.deepEqual(inspected.changed_files,['main.cjs']);
  assert.equal(digest(fs.readFileSync(f.loc.live)),digest(f.prior));
  assert.equal(fs.existsSync(f.backup),false);
  assert.equal(fs.existsSync(path.join(f.loc.install,'resources','app.asar.delta-ready')),false);
});
test('new packaged module is installer-required rather than an unverified copy',t=>{
  const f=clean(t);
  const approved={...f.approved,files:{...f.approved.files,'new-host.cjs':MAIN}};
  assert.deepEqual(inspectInstalledShell(f.loc,approved).changed_files,['new-host.cjs']);
});
test('ASAR header and individual source integrity cannot be fabricated',t=>{
  const f=clean(t);
  const wrong=Buffer.from(f.prior);
  wrong.writeUInt32LE(0,0);
  fs.writeFileSync(f.loc.live,wrong);
  assert.throws(()=>inspectInstalledShell(f.loc,f.approved),/Invalid ASAR header/);
  const corrupted=Buffer.from(f.prior);
  const position=parseArchive(corrupted).start;
  corrupted[position]^=0xff;
  fs.writeFileSync(f.loc.live,corrupted);
  assert.throws(()=>inspectInstalledShell(f.loc,f.approved),/ASAR integrity failed/);
});
test('package identity and existing committed receipt fail closed on mismatch',t=>{
  const f=clean(t);
  assert.throws(()=>inspectInstalledShell(f.loc,{
    ...f.approved,manifest:{name:'foreign-host',version:VERSION},
  }),/identity\/version differs/);
  fs.writeFileSync(path.join(f.loc.profile,'desktop-shell-delta-receipt.json'),
    JSON.stringify({schema:'ordax.desktop-shell-delta-installed/1',
      installed_asar_sha256:'f'.repeat(64)}));
  assert.throws(()=>inspectInstalledShell(f.loc,f.approved),/disagrees with existing health receipt/);
});
test('interrupted transaction restores the exact prior ASAR only with idle Native and Desktop',t=>{
  const f=clean(t),unhealthy=archive({'main.cjs':Buffer.from('changed\n'),
    'window-layout.cjs':LAYOUT,'package.json':pkg});
  fs.writeFileSync(f.backup,f.prior);
  fs.writeFileSync(f.loc.live,unhealthy);
  assert.throws(()=>recoverInterrupted(f.loc,{list:()=>[42]}),/Desktop running/);
  assert.equal(digest(fs.readFileSync(f.loc.live)),digest(unhealthy));
  assert.equal(digest(fs.readFileSync(f.backup)),digest(f.prior));
  assert.equal(recoverInterrupted(f.loc,{list:()=>[]}), 'RESTORED');
  assert.equal(digest(fs.readFileSync(f.loc.live)),digest(f.prior));
  assert.equal(fs.existsSync(f.backup),false);
});
test('pending Native update refuses legacy ASAR recovery before touching files',t=>{
  const f=clean(t);
  fs.writeFileSync(f.backup,f.prior);
  fs.writeFileSync(path.join(f.loc.profile,'desktop-dev-update-state.json'),
    JSON.stringify({pendingSha:'b'.repeat(40),attemptedSha:null}));
  assert.throws(()=>recoverInterrupted(f.loc,{list:()=>[]}),/Native OS update transaction active/);
  assert.equal(digest(fs.readFileSync(f.backup)),digest(f.prior));
});
test('corrupt legacy rollback cannot delete the potentially useful live shell',t=>{
  const f=clean(t);
  fs.writeFileSync(f.backup,Buffer.from('bad ASAR'));
  assert.throws(()=>recoverInterrupted(f.loc,{list:()=>[]}),/Untrusted ASAR size/);
  assert.equal(digest(fs.readFileSync(f.loc.live)),digest(f.prior));
});
test('durably healthy legacy receipt only cleans obsolete rollback, not live shell',t=>{
  const f=clean(t);
  fs.writeFileSync(f.backup,f.prior);
  fs.writeFileSync(path.join(f.loc.profile,'desktop-shell-delta-receipt.json'),
    JSON.stringify({schema:'ordax.desktop-shell-delta-installed/1',
      installed_asar_sha256:digest(f.prior)}));
  assert.equal(recoverInterrupted(f.loc,{list:()=>[]}), 'COMMITTED');
  assert.equal(fs.existsSync(f.backup),false);
  assert.equal(digest(fs.readFileSync(f.loc.live)),digest(f.prior));
});
test('canonical source validation precedes any recovery mutation',t=>{
  const f=clean(t);
  fs.writeFileSync(f.backup,f.prior);
  let recoveryCalled=false;
  assert.throws(()=>validatedRecovery(f.loc,{
    readSource:()=>{throw Error('Git main diverged');},
    recover:()=>{recoveryCalled=true;},
  }),/Git main diverged/);
  assert.equal(recoveryCalled,false);
  assert.equal(fs.existsSync(f.backup),true);
});
test('legacy ASAR install flag refuses mutation on every platform',()=>{
  const r=spawnSync(process.execPath,[path.join(__dirname,'dev-shell-delta.cjs'),'--install'],
    {encoding:'utf8'});
  assert.equal(r.status,1);
  assert.match(r.stderr,/incompatible with embedded Electron integrity/);
});
test('receipt JSON BOM is accepted without ignoring malformed data',()=>{
  assert.deepEqual(decodeJson('\uFEFF{"schema":"test"}'),{schema:'test'});
  assert.throws(()=>decodeJson('{malformed'),SyntaxError);
});
