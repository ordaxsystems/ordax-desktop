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
