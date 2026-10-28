import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'artifacts/api-server/package.json'));
const {build}=require('esbuild');
const dir=await mkdtemp(path.join(tmpdir(),'formal-saved-review-'));
after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:[path.join(root,'artifacts/scireview/src/components/formalSavedReview.ts')],bundle:true,platform:'browser',format:'esm',outfile:path.join(dir,'adapter.mjs'),logLevel:'silent'});
const api=await import(pathToFileURL(path.join(dir,'adapter.mjs')).href);
const rawText=await readFile(path.join(root,'artifacts/scireview/public/boundary-mechanics-paper/evidence.json'),'utf8');
const original=JSON.parse(rawText),fresh=()=>JSON.parse(rawText);
const options={evidenceUrl:'/boundary-mechanics-paper/evidence.json',paperUrl:'/boundary-mechanics-paper/paper.pdf',standaloneUrl:'/boundary-mechanics-paper/report.html',expectedSourceSha256:original.identity.sourceSha256,expectedPackageDigest:original.identity.packageDigest};
const snapshot=api.createSavedReviewSnapshot(original,options);

const contextEntry=path.join(dir,'context-entry.tsx');
await writeFile(contextEntry,`import React from 'react';\nimport {renderToStaticMarkup} from 'react-dom/server';\nimport {SavedFormalReviewProvider,useSavedFormalReview} from ${JSON.stringify(path.join(root,'artifacts/scireview/src/components/FormalSavedReviewContext.tsx'))};\nexport function render(snapshot,submission,provider=true){function Probe(){const value=useSavedFormalReview(submission);return <span>{value?'bound saved evidence':'no saved evidence'}</span>;}return renderToStaticMarkup(provider?<SavedFormalReviewProvider snapshot={snapshot}><Probe/></SavedFormalReviewProvider>:<Probe/>);}\n`);
await build({entryPoints:[contextEntry],bundle:true,platform:'node',format:'cjs',nodePaths:[path.join(root,'artifacts/scireview/node_modules')],outfile:path.join(dir,'context.cjs'),logLevel:'silent'});
const context=require(path.join(dir,'context.cjs'));

test('actual completed seven-page export projects exact reports and source, with only two PDF display links changed',()=>{
 assert.equal(snapshot.submission.sourceDocument.lines.length,527);
 assert.equal(snapshot.submission.currentRevision.verification.claims.length,60);
 assert.equal(snapshot.events.length,original.sourceAndProcessingLog.events.length);
 assert.deepEqual(snapshot.assessment,original.scientificAssessment);
 assert.deepEqual(snapshot.canonical,original.canonicalAssessment);
 assert.deepEqual(snapshot.literature,original.literatureAssessment);
 assert.deepEqual(snapshot.independentQA,original.independentQA);
 assert.deepEqual(snapshot.submission.currentRevision.verification,original.mathematicalVerification);
 assert.deepEqual(snapshot.submission.currentRevision.outputs,original.originalGeneratedOutputs);
 assert.deepEqual(snapshot.events,original.sourceAndProcessingLog.events);
 const expectedPacket=structuredClone(original.proposedFormulation);expectedPacket.source.url=options.paperUrl;
 const expectedSource=structuredClone(original.source.numberedSnapshot);expectedSource.fileUrl=options.paperUrl;
 assert.deepEqual(snapshot.submission.currentRevision.package,expectedPacket);
 assert.deepEqual(snapshot.submission.sourceDocument,expectedSource);
 assert.equal(snapshot.createdAt,original.identity.completedAt);
 assert.equal(JSON.stringify(original),JSON.stringify(JSON.parse(rawText)),'input evidence must stay unchanged');
});

test('public viewing creates no approval, publication consent or production submission identity and is immutable',()=>{
 const {submission}=snapshot;
 assert.match(submission.id,/^saved-review:/);
 assert.match(submission.currentRevision.id,/^saved-review:/);
 assert.equal(submission.currentRevision.approvedAt,null);
 assert.equal(submission.currentRevision.publishConsent,false);
 assert.equal(submission.currentRevision.submissionId,submission.id);
 assert.equal(submission.currentRevision.digest,original.identity.packageDigest);
 assert.equal(submission.sourceDocument.id,original.identity.sourceId);
 assert.equal(submission.sourceDocument.sha256,original.identity.sourceSha256);
 assert.equal(Object.isFrozen(snapshot),true);
 assert.equal(Object.isFrozen(snapshot.assessment.overall),true);
 assert.throws(()=>{snapshot.assessment.overall.judgment='Invented judgment';},TypeError);
 assert.throws(()=>{submission.currentRevision.approvedAt='2026-10-28';},TypeError);
});

test('missing final stages and required source/log/evidence parts fail visibly rather than rendering an incomplete review',()=>{
 for(const key of ['scientificAssessment','canonicalAssessment','literatureAssessment','mathematicalVerification','originalGeneratedOutputs','sourceAndProcessingLog','independentQA']){
  const value=fresh();delete value[key];assert.throws(()=>api.createSavedReviewSnapshot(value,options),/incomplete|different evidence/,key);
 }
 for(const key of ['canonicalCompleted','literatureCompleted','integratedAssessmentCompleted']){
  const value=fresh();value.runSummary.counts[key]=false;assert.throws(()=>api.createSavedReviewSnapshot(value,options),/incomplete|different evidence/,key);
 }
 const value=fresh();value.sourceAndProcessingLog.events[0].at='not a date';assert.throws(()=>api.createSavedReviewSnapshot(value,options),/event date/);
});

test('digest, source and evidence fingerprint binding is checked across every saved assessment stage',()=>{
 const replacements=[['proposalMetadata','sourceId'],['source','numberedSnapshot','sha256'],['proposedFormulation','source','sha256'],['proposedFormulation','analysis','sourceId'],['mathematicalVerification','packageDigest'],['originalGeneratedOutputs','packageDigest'],['scientificAssessment','sourceSha256'],['scientificAssessment','evidenceFingerprint'],['canonicalAssessment','packageDigest'],['literatureAssessment','sourceId'],['scientificAssessment','geometryEvidence','sourceSha256'],['scientificAssessment','claimVerificationPlan','packageDigest'],['scientificAssessment','restrictedCanonicalDerivation','sourceId'],['sourceAndProcessingLog','packageDigest']];
 for(const fields of replacements){const value=fresh();let item=value;for(const field of fields.slice(0,-1))item=item[field];item[fields.at(-1)]='mismatched';assert.throws(()=>api.createSavedReviewSnapshot(value,options),/incomplete|different evidence/,fields.join('.'));}
 assert.throws(()=>api.createSavedReviewSnapshot(original,{...options,expectedSourceSha256:'0'.repeat(64)}),/expected source hash/);
 assert.throws(()=>api.createSavedReviewSnapshot(original,{...options,expectedPackageDigest:'0'.repeat(64)}),/expected package digest/);
});

test('source coverage and verification cannot silently lose, duplicate or acquire unsupported source or claim references',()=>{
 const variants=[v=>v.mathematicalVerification.claims.pop(),v=>{v.mathematicalVerification.claims[0].id='not-a-proposed-claim';},v=>{v.originalGeneratedOutputs.coverage[0].id='not-a-source-statement';},v=>{v.proposedFormulation.analysis.coverage[0].sourceLineIds=['not-a-source-line'];},v=>{v.source.numberedSnapshot.lines[0].id=v.source.numberedSnapshot.lines[1].id;},v=>{v.scientificAssessment.rigor.core.checked++;},v=>{v.identity.sourceCounts.numberedLines++;}];
 for(const change of variants){const value=fresh();change(value);assert.throws(()=>api.createSavedReviewSnapshot(value,options),/incomplete|different evidence/);}
});

test('only explicitly configured same-origin artifact links are accepted and historical author approval remains false',()=>{
 for(const link of ['https://other.invalid/file','//other.invalid/file','/\\other.invalid/file','javascript:alert(1)','/bad path','/%5cother.invalid/file'])for(const key of ['evidenceUrl','paperUrl','standaloneUrl'])assert.throws(()=>api.createSavedReviewSnapshot(original,{...options,[key]:link}));
 for(const key of ['authorApprovalRecorded','publishConsent','publicationPerformed','productionDatabaseWrites','productionSourceUploadPerformed']){const value=fresh();value.identity[key]=true;assert.throws(()=>api.createSavedReviewSnapshot(value,options),/historical/);}
});

test('snapshot context matching cannot lend evidence to another revision, manuscript or approved production submission',()=>{
 assert.equal(api.savedReviewMatchesSubmission(snapshot,snapshot.submission),true);
 assert.equal(api.savedReviewMatchesSubmission(snapshot,structuredClone(snapshot.submission)),true);
 const variants=[v=>{v.id='production-submission';},v=>{v.currentRevision.id='another-revision';},v=>{v.currentRevision.digest='0'.repeat(64);},v=>{v.currentRevision.submissionId='other-submission';},v=>{v.sourceDocument.id='other-source';},v=>{v.sourceDocument.sha256='0'.repeat(64);},v=>{v.currentRevision.package.source.sha256='0'.repeat(64);},v=>{v.currentRevision.package.analysis.sourceId='other-source';},v=>{v.currentRevision.approvedAt='2026-10-28T00:00:00Z';},v=>{v.currentRevision.publishConsent=true;}];
 for(const change of variants){const submission=structuredClone(snapshot.submission);change(submission);assert.equal(api.savedReviewMatchesSubmission(snapshot,submission),false);}
});

test('actual React provider exposes bound saved evidence only and works without fetching or authentication',()=>{
 assert.equal(context.render(snapshot,snapshot.submission),'<span>bound saved evidence</span>');
 assert.equal(context.render(snapshot,undefined),'<span>bound saved evidence</span>');
 assert.equal(context.render(snapshot,null),'<span>no saved evidence</span>');
 assert.equal(context.render(snapshot,snapshot.submission,false),'<span>no saved evidence</span>');
 const wrong=structuredClone(snapshot.submission);wrong.currentRevision.digest='0'.repeat(64);
 assert.equal(context.render(snapshot,wrong),'<span>no saved evidence</span>');
});
