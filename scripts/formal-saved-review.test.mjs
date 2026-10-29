import {createHash} from 'node:crypto';
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
const options={evidenceUrl:'/boundary-mechanics-paper/evidence.json',paperUrl:'/boundary-mechanics-paper/paper.pdf',standaloneUrl:'/boundary-mechanics-paper/export.html',originalEvidenceUrl:'/boundary-mechanics-paper/original-evidence.json',expectedSourceSha256:original.identity.sourceSha256,expectedPackageDigest:original.identity.packageDigest};
const snapshot=api.createSavedReviewSnapshot(original,options);

const contextEntry=path.join(dir,'context-entry.tsx');
await writeFile(contextEntry,`import React from 'react';\nimport {renderToStaticMarkup} from 'react-dom/server';\nimport {SavedFormalReviewProvider,useSavedFormalReview} from ${JSON.stringify(path.join(root,'artifacts/scireview/src/components/FormalSavedReviewContext.tsx'))};\nexport function render(snapshot,submission,provider=true){function Probe(){const value=useSavedFormalReview(submission);return <span>{value?'bound saved evidence':'no saved evidence'}</span>;}return renderToStaticMarkup(provider?<SavedFormalReviewProvider snapshot={snapshot}><Probe/></SavedFormalReviewProvider>:<Probe/>);}\n`);
await build({entryPoints:[contextEntry],bundle:true,platform:'node',format:'cjs',nodePaths:[path.join(root,'artifacts/scireview/node_modules')],outfile:path.join(dir,'context.cjs'),logLevel:'silent'});
const context=require(path.join(dir,'context.cjs'));

test('actual completed seven-page export projects exact scientific records with recorded wording and two PDF display-link changes',()=>{
 assert.equal(snapshot.submission.sourceDocument.lines.length,527);
 assert.equal(snapshot.submission.currentRevision.verification.claims.length,60);
 assert.equal(snapshot.events.length,original.sourceAndProcessingLog.events.length);
 const expectedAssessment=structuredClone(original.scientificAssessment);
 for(const amendment of original.editorialAmendments||[])expectedAssessment.novelty.fieldContribution=amendment.replacementText;
 assert.deepEqual(snapshot.assessment,expectedAssessment);
 assert.deepEqual(snapshot.editorialAmendments,original.editorialAmendments);
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
 for(const link of ['https://other.invalid/file','//other.invalid/file','/\\other.invalid/file','javascript:alert(1)','/bad path','/%5cother.invalid/file'])for(const key of ['evidenceUrl','paperUrl','standaloneUrl','originalEvidenceUrl'])assert.throws(()=>api.createSavedReviewSnapshot(original,{...options,[key]:link}));
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


test('wording amendment retains the byte-exact original and changes no scientific evidence',async()=>{
 const archiveBytes=await readFile(path.join(root,'artifacts/scireview/public/boundary-mechanics-paper/original-evidence.json'));
 assert.equal(createHash('sha256').update(archiveBytes).digest('hex'),'8c25caa549e697c17916b14a8409fb52cc03eac2f4f10aa2f23ce2db7a09d593');
 const archive=JSON.parse(archiveBytes),current=fresh();delete current.editorialAmendments;
 assert.deepEqual(current,archive);
 const historical=api.createSavedReviewSnapshot(archive,options);
 assert.deepEqual(historical.assessment,archive.scientificAssessment);
 assert.deepEqual(historical.editorialAmendments,[]);
 const amendment=snapshot.editorialAmendments[0];
 assert.equal(amendment.field,'scientificAssessment.novelty.fieldContribution');
 assert.equal(amendment.originalText,archive.scientificAssessment.novelty.fieldContribution);
 assert.equal(snapshot.assessment.novelty.fieldContribution,amendment.replacementText);
 assert.equal(amendment.newModelRun,false);
 assert.equal(amendment.scientificEvidenceUnchanged,true);
 assert.match(amendment.attribution,/author.*request/i);
 assert.doesNotMatch(amendment.replacementText,/if adopted|community|consensus|prestige/i);
 assert.match(amendment.replacementText,/stated boundary prescription/);
 assert.equal(snapshot.assessment.evidenceFingerprint,historical.assessment.evidenceFingerprint);
 assert.deepEqual(snapshot.assessment.overall,historical.assessment.overall);
 assert.deepEqual(snapshot.assessment.readiness,historical.assessment.readiness);
 assert.deepEqual(snapshot.assessment.rigor,historical.assessment.rigor);
});

test('wording amendments cannot change other fields, lose exact source binding or masquerade as a new model run',()=>{
 for(const [key,value] of [['version','new-version'],['kind','scientific-verdict'],['field','scientificAssessment.overall.judgment'],['sourceSha256','0'.repeat(64)],['packageDigest','0'.repeat(64)],['assessmentFingerprint','0'.repeat(64)],['originalText','Some other original'],['newModelRun',true],['scientificEvidenceUnchanged',false],['replacementText',''],['attribution','']]){
  const raw=fresh();raw.editorialAmendments[0][key]=value;
  assert.throws(()=>api.createSavedReviewSnapshot(raw,options),/editorial/,key);
 }
 const duplicate=fresh();duplicate.editorialAmendments.push(duplicate.editorialAmendments[0]);
 assert.throws(()=>api.createSavedReviewSnapshot(duplicate,options),/editorial amendment count/);
 assert.throws(()=>api.createSavedReviewSnapshot(fresh(),{...options,originalEvidenceUrl:undefined}),/editorial original evidence URL/);
});

test('public downloads and readable views expose the same current wording with the original kept in history',async()=>{
 const folder=path.join(root,'artifacts/scireview/public/boundary-mechanics-paper');
 const manifest=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
 for(const file of manifest.files){const bytes=await readFile(path.join(folder,file.name));assert.equal(bytes.length,file.bytes,file.name);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.name);}
 const amendment=original.editorialAmendments[0];
 const summary=await readFile(path.join(folder,'review-summary.txt'),'utf8');
 assert.ok(summary.includes('Field contribution: '+amendment.replacementText));
 assert.ok(summary.includes('Original contribution wording: '+amendment.originalText));
 const html=await readFile(path.join(folder,'export.html'),'utf8');
 assert.ok(html.includes('<dt>Field Contribution</dt><dd>'+amendment.replacementText+'</dd>'));
 assert.ok(html.includes('id="editorial-wording-history"'));
 assert.ok(html.includes(amendment.originalText));
});
