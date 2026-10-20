import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'artifacts/api-server/package.json'));
const {build}=require('esbuild');
const dir=await mkdtemp(path.join(tmpdir(),'formal-lab-tests-'));
after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:[path.join(root,'artifacts/api-server/src/formal/package.ts')],outfile:path.join(dir,'package.mjs'),platform:'node',bundle:true,format:'esm',logLevel:'silent'});
const {validatePackage,packageDigest}=await import(pathToFileURL(path.join(dir,'package.mjs')).href);
await build({entryPoints:[path.join(root,'artifacts/api-server/src/formal/proposalSchema.ts')],outfile:path.join(dir,'proposal.mjs'),platform:'node',bundle:true,format:'esm',logLevel:'silent'});
const {decodeProposal}=await import(pathToFileURL(path.join(dir,'proposal.mjs')).href);
const example=JSON.parse(await readFile(path.join(root,'artifacts/api-server/src/formal/example.json'),'utf8'));
test('one-page packet has complete source and ten bounded candidate claims',()=>{
 const pkg=validatePackage(example);assert.equal(pkg.claims.length,10);assert.ok(pkg.source.excerpt.includes('dU'));assert.match(pkg.source.sha256,/^[a-f0-9]{64}$/);
});
test('canonical digest ignores JSON key order but binds assumptions, claims, source and explanations',()=>{
 const digest=packageDigest(example);
 const reorder=o=>Array.isArray(o)?o.map(reorder):o&&typeof o==='object'?Object.fromEntries(Object.entries(o).reverse().map(([k,v])=>[k,reorder(v)])):o;
 assert.equal(packageDigest(reorder(example)),digest);
 for(const mutate of [p=>p.assumptions.push('Additional physical premise'),p=>p.claims[0].rhs={op:'integer',value:0},p=>p.source.version='changed',p=>p.consequences[0].text+=' Changed interpretation.']) {const p=structuredClone(example);mutate(p);assert.notEqual(packageDigest(p),digest);}
});
test('unapproved executable expressions and unsafe source URLs are rejected at API boundary',()=>{
 for(const mutate of [p=>p.claims[0].lhs={op:'eval',code:'process.env'},p=>p.source.url='javascript:alert(1)',p=>p.source.url='//unrelated.example/x',p=>p.symbols[0].dimensions=[1,2],p=>p.claims[0].rhs={op:'symbol',name:'undefined_symbol'}]) {const p=structuredClone(example);mutate(p);assert.throws(()=>validatePackage(p));}
});
test('explanatory consequences cannot claim support from missing or empty claim references',()=>{
 for(const ids of [[],['missing-claim']]) {const p=structuredClone(example);p.consequences[0].claimIds=ids;assert.throws(()=>validatePackage(p));}
});
test('source changes and revisions remain content-addressed with bounded expressions',()=>{
 const p=structuredClone(example);p.claims[0].rhs={op:'pow',base:{op:'integer',value:2},exponent:100000};assert.throws(()=>validatePackage(p));
 const q=structuredClone(example);q.title='x'.repeat(301);assert.throws(()=>validatePackage(q));
});

test('schema transport decodes AST JSON data and rejects formulas or executable strings',()=>{
 const transport={...example,definitions:example.definitions.map(({expression,...d})=>({...d,expressionJson:JSON.stringify(expression)})),claims:example.claims.map(({lhs,rhs,...c})=>({...c,lhsJson:JSON.stringify(lhs),rhsJson:JSON.stringify(rhs)}))};
 assert.equal(packageDigest(validatePackage(decodeProposal(transport))),packageDigest(example));
 for(const malicious of ['process.env','c^4*A/L','{not JSON}']) {const p=structuredClone(transport);p.claims[0].lhsJson=malicious;assert.throws(()=>decodeProposal(p));}
 const code=structuredClone(transport);code.claims[0].lhsJson=JSON.stringify({op:'execute',script:'process.env'});assert.throws(()=>validatePackage(decodeProposal(code)));
});
