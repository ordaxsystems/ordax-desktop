'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  parseArchive,encodeArchive,fileBytes,integrity,buildDelta,digest,decodeJson,
}=require('./dev-shell-delta.cjs');
function fixture(){
  const first=Buffer.from('console.log("old")\n');
  const manifest=Buffer.from('{"name":"ordax-os-desktop-dev","version":"0.1.0-alpha.20"}\n');
  const payload=Buffer.concat([first,manifest]);
  return encodeArchive({files:{
    'main.cjs':{size:first.length,offset:'0',integrity:integrity(first)},
    'package.json':{size:manifest.length,offset:String(first.length),integrity:integrity(manifest)},
    'node_modules':{files:{nested:{files:{'fixture.js':{
      size:5,offset:String(payload.length-5),integrity:integrity(payload.subarray(-5)),
    }}}}},
  }},payload);
}
test('ASAR payload and header encode round-trip with existing integrity',()=>{
  const original=fixture();
  const parsed=parseArchive(original);
  assert.equal(fileBytes(parsed,'main.cjs').toString(),'console.log("old")\n');
  assert.equal(fileBytes(parsed,'package.json').toString().includes('ordax-os'),true);
  assert.equal(parsed.payload[0],0x63);
});
test('append-only shell delta updates source while retaining unknown Native payload',()=>{
  const original=fixture();
  const originalPayload=parseArchive(original).payload;
  const updated=Buffer.from('console.log("updated")\n');
  const added=Buffer.from('exports.sample=true\n');
  const next=buildDelta(original,{'main.cjs':updated,'window-layout.cjs':added});
  assert.equal(next.changed,true);
  assert.deepEqual(next.changes,['main.cjs','window-layout.cjs']);
  const inspected=parseArchive(next.archive);
  assert.ok(inspected.payload.subarray(0,originalPayload.length).equals(originalPayload));
  assert.ok(fileBytes(inspected,'main.cjs').equals(updated));
  assert.ok(fileBytes(inspected,'window-layout.cjs').equals(added));
  assert.ok(fileBytes(inspected,'package.json').equals(
    fileBytes(parseArchive(original),'package.json')));
  assert.ok(inspected.header.files.node_modules.files.nested.files['fixture.js']);
  assert.equal(inspected.header.files['main.cjs'].integrity.hash,digest(updated));
});
test('same Git bytes are a no-op: never rewrite the installed ASAR',()=>{
  const original=fixture();
  const source=fileBytes(parseArchive(original),'main.cjs');
  const next=buildDelta(original,{'main.cjs':source});
  assert.equal(next.changed,false);
  assert.strictEqual(next.archive,original);
  assert.deepEqual(next.changes,[]);
});
test('corrupted original header, lengths, and source integrity fail closed',()=>{
  const badSize=Buffer.from(fixture());badSize.writeUInt32LE(3,0);
  assert.throws(()=>parseArchive(badSize),/Invalid ASAR header/);
  const corrupt=Buffer.from(fixture());
  const position=parseArchive(corrupt).start;
  corrupt[position]^=0xff;
  assert.throws(()=>buildDelta(corrupt,{'main.cjs':Buffer.from('next')}),/integrity failed/);
  const invalid=Buffer.from(fixture());invalid.writeUInt32LE(99999999,12);
  assert.throws(()=>parseArchive(invalid),/Invalid ASAR header/);
});
test('shell writes never target arbitrary paths or invalid source blobs',()=>{
  const a=fixture();
  assert.throws(()=>buildDelta(a,{'../main.cjs':Buffer.from('oops')}),/Unsafe/);
  assert.throws(()=>buildDelta(a,{'node_modules/file.cjs':Buffer.from('oops')}),/Unsafe/);
  assert.throws(()=>buildDelta(a,{'main.cjs':Buffer.alloc(0)}),/Unsafe/);
});
test('unpacked and linked entries cannot be replaced by shell deltas',()=>{
  const original=parseArchive(fixture());
  original.header.files['main.cjs'].unpacked=true;
  assert.throws(()=>buildDelta(encodeArchive(original.header,original.payload),
    {'main.cjs':Buffer.from('replace')}),/unpacked or linked/);
  const other=parseArchive(fixture());
  other.header.files['main.cjs'].link='elsewhere';
  assert.throws(()=>buildDelta(encodeArchive(other.header,other.payload),
    {'main.cjs':Buffer.from('replace')}),/unpacked or linked/);
});
test('verified ASAR integrity cannot be forged with unchanged metadata',()=>{
  const old=parseArchive(fixture());
  old.header.files['main.cjs'].integrity.hash='f'.repeat(64);
  const fake=encodeArchive(old.header,old.payload);
  assert.throws(()=>fileBytes(parseArchive(fake),'main.cjs'),/integrity failed/);
});

test('Windows PowerShell UTF-8 BOM receipts parse without weakening JSON validation',()=>{
  assert.deepEqual(decodeJson('\uFEFF{"schema":"test"}'),{schema:'test'});
  assert.throws(()=>decodeJson('\uFEFF{broken'),SyntaxError);
});

const fsTxn=require('node:fs');
const osTxn=require('node:os');
const pathTxn=require('node:path');
const {install}=require('./dev-shell-delta.cjs');

function isolatedTransaction(original=fixture()){
  const root=fsTxn.mkdtempSync(pathTxn.join(osTxn.tmpdir(),'ordax-shell-swap-proof-'));
  const installation=pathTxn.join(root,'installation');
  const resources=pathTxn.join(installation,'resources');
  const profile=pathTxn.join(root,'profile');
  fsTxn.mkdirSync(resources,{recursive:true});
  fsTxn.mkdirSync(profile,{recursive:true});
  const live=pathTxn.join(resources,'app.asar');
  const exe=pathTxn.join(installation,'OrdaX OS Desktop Dev.exe');
  fsTxn.writeFileSync(live,original);
  fsTxn.writeFileSync(exe,'isolated fixture (never executed)');
  fsTxn.writeFileSync(pathTxn.join(profile,'desktop-dev-update-state.json'),
    JSON.stringify({pendingSha:null,attemptedSha:null}));
  const oldSource=fileBytes(parseArchive(original),'main.cjs');
  const changed=Buffer.concat([oldSource,Buffer.from('// isolated development shell proof\n')]);
  const candidateBytes=buildDelta(original,{'main.cjs':changed});
  const candidate=pathTxn.join(root,'candidate.asar');
  fsTxn.writeFileSync(candidate,candidateBytes.archive);
  const prepared={changed:true,candidate,receipt:{
    source_commit:'f'.repeat(40),old_asar_sha256:digest(original),
    new_asar_sha256:digest(candidateBytes.archive)}};
  return {root,loc:{live,profile,exe,install:installation},prepared,original,changed,
    backup:pathTxn.join(resources,'app.asar.delta-rollback'),
    temporary:pathTxn.join(resources,'app.asar.delta-ready')};
}
const injectedHealthy={
  list:()=>[],
  boot:async()=>true,
  restart:()=>{throw Error('Old launch must not occur for healthy update')},
};
test('isolated disk transaction swaps actual ASAR bytes and records one receipt',async t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  assert.equal(await install(f.loc,f.prepared,injectedHealthy),'INSTALLED');
  const updated=fsTxn.readFileSync(f.loc.live);
  assert.equal(digest(updated),f.prepared.receipt.new_asar_sha256);
  assert.ok(fileBytes(parseArchive(updated),'main.cjs').equals(f.changed));
  const receipt=JSON.parse(fsTxn.readFileSync(
    pathTxn.join(f.loc.profile,'desktop-shell-delta-receipt.json'),'utf8'));
  assert.equal(receipt.boot_smoke,'Native Surface ready');
  assert.equal(receipt.installed_asar_sha256,digest(updated));
  assert.equal(fsTxn.existsSync(f.backup),false);
  assert.equal(fsTxn.existsSync(f.temporary),false);
});
test('failed health proof atomically restores previous ASAR and restarts old shell',async t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  let restarts=0;
  await assert.rejects(install(f.loc,f.prepared,{
    list:()=>[],boot:async()=>false,restart:()=>{restarts++},
  }),/Native Surface did not become healthy/);
  assert.equal(restarts,1);
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
  assert.equal(fsTxn.existsSync(f.backup),false);
  assert.equal(fsTxn.existsSync(f.temporary),false);
});
test('corrupt staged candidate fails before swap and cleans temporary file',async t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.appendFileSync(f.prepared.candidate,'tampered');
  await assert.rejects(install(f.loc,f.prepared,injectedHealthy),
    /Copied Desktop delta verification failed/);
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
  assert.equal(fsTxn.existsSync(f.backup),false);
  assert.equal(fsTxn.existsSync(f.temporary),false);
});
test('running Desktop and pending Native transaction block before swap',async t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  await assert.rejects(install(f.loc,f.prepared,{list:()=>[100]}),/Desktop is running/);
  fsTxn.writeFileSync(pathTxn.join(f.loc.profile,'desktop-dev-update-state.json'),
    JSON.stringify({pendingSha:'a'.repeat(40),attemptedSha:null}));
  await assert.rejects(install(f.loc,f.prepared,injectedHealthy),/Native OS update transaction active/);
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
  assert.equal(fsTxn.existsSync(f.temporary),false);
});
test('Desktop reopening between initial checks and swap aborts without leaving a candidate',async t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  let calls=0;
  await assert.rejects(install(f.loc,f.prepared,{
    list:()=>++calls===1?[]:[101],
  }),/Desktop reopened before shell swap/);
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
  assert.equal(fsTxn.existsSync(f.temporary),false);
  assert.equal(fsTxn.existsSync(f.backup),false);
});
test('unresolved receipt transaction blocks without overwriting previous evidence',async t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  const rec=pathTxn.join(f.loc.profile,'desktop-shell-delta-receipt.json.tmp');
  fsTxn.writeFileSync(rec,'previous incomplete evidence');
  await assert.rejects(install(f.loc,f.prepared,injectedHealthy),
    /Unresolved previous Desktop delta/);
  assert.equal(fsTxn.readFileSync(rec,'utf8'),'previous incomplete evidence');
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
});

test('physical Windows ASAR undergoes an isolated real-byte swap and rollback',
  {skip:!process.env.ORDAX_DESKTOP_ISOLATED_ASAR},
  async t=>{
    const installed=fsTxn.readFileSync(process.env.ORDAX_DESKTOP_ISOLATED_ASAR);
    const prior=parseArchive(installed);
    assert.ok(fileBytes(prior,'main.cjs').length>5000,
      'Expected genuine installed Electron shell source');
    const f=isolatedTransaction(installed);
    t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
    const replaced=await install(f.loc,f.prepared,injectedHealthy);
    assert.equal(replaced,'INSTALLED');
    assert.equal(digest(fsTxn.readFileSync(f.loc.live)),
      f.prepared.receipt.new_asar_sha256);
    // Check the same transaction's restore path using the installed app.asar.
    fsTxn.writeFileSync(f.loc.live,installed);
    fsTxn.rmSync(pathTxn.join(f.loc.profile,'desktop-shell-delta-receipt.json'));
    let restarted=0;
    await assert.rejects(install(f.loc,f.prepared,{
      list:()=>[],boot:async()=>false,restart:()=>{restarted++},
    }),/Native Surface did not become healthy/);
    assert.equal(restarted,1);
    assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(installed));
    assert.equal(fsTxn.existsSync(f.backup),false);
    assert.equal(fsTxn.existsSync(f.temporary),false);
  });

test('Native update beginning during copying prevents any ASAR swap',async t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  let probes=0;
  await assert.rejects(install(f.loc,f.prepared,{
    list:()=>{
      if(++probes===2)fsTxn.writeFileSync(
        pathTxn.join(f.loc.profile,'desktop-dev-update-state.json'),
        JSON.stringify({pendingSha:'e'.repeat(40),attemptedSha:null}));
      return [];
    },
  }),/Native OS update transaction active/);
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
  assert.equal(fsTxn.existsSync(f.temporary),false);
  assert.equal(fsTxn.existsSync(f.backup),false);
});
test('unhealthy shell still running retains rollback rather than corrupting live bytes',async t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  let probes=0;
  await assert.rejects(install(f.loc,f.prepared,{
    list:()=>++probes>2?[123]:[],
    boot:async()=>false,
    restart:()=>{throw Error('Cannot restart while unknown shell still running')},
  }),/backup retained/);
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),
    f.prepared.receipt.new_asar_sha256);
  assert.equal(digest(fsTxn.readFileSync(f.backup)),digest(f.original));
  assert.equal(fsTxn.existsSync(f.temporary),false);
});

test('stopFailedBoot stops only the launched candidate PID',async()=>{
  const {stopFailedBoot}=require('./dev-shell-delta.cjs');
  const candidate={pid:37519},calls=[];
  let running=true;
  const result=await stopFailedBoot(candidate,{
    alive:()=>running,
    terminate:pid=>{calls.push(pid);running=false},
  });
  assert.equal(result,'STOPPED');
  assert.deepEqual(calls,[37519]);
});
test('stopFailedBoot never kills an already exited candidate',async()=>{
  const {stopFailedBoot}=require('./dev-shell-delta.cjs');
  assert.equal(await stopFailedBoot({pid:123},{
    alive:()=>false,
    terminate:()=>{throw Error('Must not terminate an exited PID')},
  }),'ALREADY_STOPPED');
});
test('stopFailedBoot refuses an invalid PID before termination',async()=>{
  const {stopFailedBoot}=require('./dev-shell-delta.cjs');
  await assert.rejects(stopFailedBoot({pid:-1},{
    alive:()=>true,terminate:()=>{throw Error('Must not call taskkill')},
  }),/Invalid candidate Desktop PID/);
});
test('failed candidate termination preserves backup instead of implying recovery',async()=>{
  const {stopFailedBoot}=require('./dev-shell-delta.cjs');
  await assert.rejects(stopFailedBoot({pid:1234},{
    alive:()=>true,terminate:()=>{throw Error('access denied')},
  }),/Cannot stop unhealthy candidate/);
});
test('targeted Windows process-tree stop works against an isolated node child',
 {skip:process.platform!=='win32'},async t=>{
  const {spawn}=require('node:child_process');
  const {stopFailedBoot,childAlive}=require('./dev-shell-delta.cjs');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{
    stdio:'ignore',windowsHide:true});
  t.after(()=>{if(childAlive(child))child.kill()});
  // There is no OrdaX process or user session involved in this test.
  assert.ok(Number.isSafeInteger(child.pid));
  assert.equal(await stopFailedBoot(child),'STOPPED');
  assert.equal(childAlive(child),false);
});

const {recoverInterrupted}=require('./dev-shell-delta.cjs');
test('interrupted pre-swap staging is cleaned without touching installed ASAR',t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.copyFileSync(f.prepared.candidate,f.temporary);
  assert.equal(recoverInterrupted(f.loc,{list:()=>[]}), 'CLEANED');
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
  assert.equal(fsTxn.existsSync(f.temporary),false);
});
test('crash after live-to-backup rename restores missing shell automatically',t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.renameSync(f.loc.live,f.backup);
  fsTxn.copyFileSync(f.prepared.candidate,f.temporary);
  assert.equal(recoverInterrupted(f.loc,{list:()=>[]}), 'RESTORED');
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
  assert.equal(fsTxn.existsSync(f.backup),false);
  assert.equal(fsTxn.existsSync(f.temporary),false);
});
test('crash after candidate swap but before health receipt restores old ASAR',t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.renameSync(f.loc.live,f.backup);
  fsTxn.copyFileSync(f.prepared.candidate,f.loc.live);
  assert.equal(recoverInterrupted(f.loc,{list:()=>[]}), 'RESTORED');
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
  assert.equal(fsTxn.existsSync(f.backup),false);
});
test('crash after verified health receipt retains new ASAR and removes leftover backup',t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.renameSync(f.loc.live,f.backup);
  fsTxn.copyFileSync(f.prepared.candidate,f.loc.live);
  const accepted={schema:'ordax.desktop-shell-delta-installed/1',
    installed_asar_sha256:f.prepared.receipt.new_asar_sha256,
    desktop_source_sha:f.prepared.receipt.source_commit,
    boot_smoke:'Native Surface ready'};
  fsTxn.writeFileSync(pathTxn.join(f.loc.profile,'desktop-shell-delta-receipt.json'),
    JSON.stringify(accepted));
  assert.equal(recoverInterrupted(f.loc,{list:()=>[]}), 'COMMITTED');
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),
    f.prepared.receipt.new_asar_sha256);
  assert.equal(fsTxn.existsSync(f.backup),false);
});
test('previous receipt attests original backup and allows safe restoration',t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.writeFileSync(pathTxn.join(f.loc.profile,'desktop-shell-delta-receipt.json'),
    JSON.stringify({schema:'ordax.desktop-shell-delta-installed/1',
      installed_asar_sha256:digest(f.original)}));
  fsTxn.renameSync(f.loc.live,f.backup);
  fsTxn.copyFileSync(f.prepared.candidate,f.loc.live);
  assert.equal(recoverInterrupted(f.loc,{list:()=>[]}), 'RESTORED');
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
});
test('unknown receipt or tampered backup blocks recovery without erasing evidence',t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.renameSync(f.loc.live,f.backup);
  fsTxn.copyFileSync(f.prepared.candidate,f.loc.live);
  fsTxn.writeFileSync(pathTxn.join(f.loc.profile,'desktop-shell-delta-receipt.json'),
    JSON.stringify({schema:'ordax.desktop-shell-delta-installed/1',
      installed_asar_sha256:'a'.repeat(64)}));
  assert.throws(()=>recoverInterrupted(f.loc,{list:()=>[]}),/Neither live nor backup/);
  assert.equal(fsTxn.existsSync(f.backup),true);
  fsTxn.writeFileSync(pathTxn.join(f.loc.profile,'desktop-shell-delta-receipt.json'),
    JSON.stringify({schema:'ordax.desktop-shell-delta-installed/1',
      installed_asar_sha256:digest(f.original)}));
  fsTxn.appendFileSync(f.backup,'tamper');
  assert.throws(()=>recoverInterrupted(f.loc,{list:()=>[]}),/Neither live nor backup/);
  assert.equal(fsTxn.existsSync(f.backup),true);
});
test('recovery refuses to swap files while any Desktop process is running',t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.renameSync(f.loc.live,f.backup);
  assert.throws(()=>recoverInterrupted(f.loc,{list:()=>[17234]}),/Desktop running/);
  assert.equal(fsTxn.existsSync(f.backup),true);
  assert.equal(fsTxn.existsSync(f.loc.live),false);
});

test('interrupted recovery does not race a pending Native OS activation',t=>{
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.renameSync(f.loc.live,f.backup);
  fsTxn.writeFileSync(pathTxn.join(f.loc.profile,'desktop-dev-update-state.json'),
    JSON.stringify({pendingSha:'a'.repeat(40),attemptedSha:null}));
  assert.throws(()=>recoverInterrupted(f.loc,{list:()=>[]}),
    /Native OS update transaction active/);
  assert.equal(fsTxn.existsSync(f.backup),true);
  assert.equal(fsTxn.existsSync(f.loc.live),false);
});
test('installed Windows ASAR is restored after interrupted candidate swap in isolated workspace',
 {skip:!process.env.ORDAX_DESKTOP_ISOLATED_ASAR},t=>{
  const original=fsTxn.readFileSync(process.env.ORDAX_DESKTOP_ISOLATED_ASAR);
  const f=isolatedTransaction(original);
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.renameSync(f.loc.live,f.backup);
  fsTxn.copyFileSync(f.prepared.candidate,f.loc.live);
  assert.equal(recoverInterrupted(f.loc,{list:()=>[]}), 'RESTORED');
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(original));
  assert.equal(fsTxn.existsSync(f.backup),false);
});

function versionedShellFixture(name,version){
  const code=Buffer.from('console.log("unmodified trusted shell")\n');
  const manifest=Buffer.from(JSON.stringify({name,version})+'\n');
  return encodeArchive({files:{
    'main.cjs':{size:code.length,offset:'0',integrity:integrity(code)},
    'package.json':{size:manifest.length,offset:String(code.length),
      integrity:integrity(manifest)},
  }},Buffer.concat([code,manifest]));
}
test('interrupted recovery accepts future canonical Dev package versions',t=>{
  for(const version of ['0.1.0-alpha.21','0.2.0-alpha.1','1.0.0']){
    const f=isolatedTransaction(versionedShellFixture('ordax-os-desktop-dev',version));
    t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
    fsTxn.renameSync(f.loc.live,f.backup);
    fsTxn.copyFileSync(f.prepared.candidate,f.loc.live);
    assert.equal(recoverInterrupted(f.loc,{list:()=>[]}), 'RESTORED',version);
    assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original),version);
  }
});
test('interrupted recovery rejects wrong product identity and malformed version',t=>{
  for(const [name,version] of [
    ['another-desktop','0.1.0-alpha.21'],
    ['ordax-os-desktop-dev','bad version'],
  ]){
    const f=isolatedTransaction(versionedShellFixture(name,version));
    t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
    fsTxn.renameSync(f.loc.live,f.backup);
    assert.throws(()=>recoverInterrupted(f.loc,{list:()=>[]}),
      /Interrupted shell package identity mismatch/);
    assert.equal(fsTxn.existsSync(f.backup),true);
  }
});

test('untrusted Git source blocks interrupted recovery before any file change',t=>{
  const {validatedRecovery}=require('./dev-shell-delta.cjs');
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.renameSync(f.loc.live,f.backup);
  let recoveryCalled=false;
  assert.throws(()=>validatedRecovery({...f.loc,repo:'untrusted'},{
    readSource:()=>{throw Error('Desktop source checkout dirty')},
    recover:()=>{recoveryCalled=true},
  }),/source checkout dirty/);
  assert.equal(recoveryCalled,false);
  assert.equal(fsTxn.existsSync(f.backup),true);
  assert.equal(fsTxn.existsSync(f.loc.live),false);
});
test('trusted Git source is checked once before interrupted recovery and reused',t=>{
  const {validatedRecovery}=require('./dev-shell-delta.cjs');
  const f=isolatedTransaction();
  t.after(()=>fsTxn.rmSync(f.root,{recursive:true,force:true}));
  fsTxn.renameSync(f.loc.live,f.backup);
  const trusted={revision:'b'.repeat(40),files:{}};
  const calls=[];
  const gate=validatedRecovery({...f.loc,repo:'canonical-main'},{
    readSource:repo=>{calls.push('read:'+repo);return trusted},
    recover:loc=>{
      calls.push('recover');
      return recoverInterrupted(loc,{list:()=>[]});
    },
  });
  assert.deepEqual(calls,['read:canonical-main','recover']);
  assert.equal(gate.trusted,trusted);
  assert.equal(gate.recovery,'RESTORED');
  assert.equal(digest(fsTxn.readFileSync(f.loc.live)),digest(f.original));
});
