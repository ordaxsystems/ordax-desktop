'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  parseArchive,encodeArchive,fileBytes,integrity,buildDelta,digest,
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
