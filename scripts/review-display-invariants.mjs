import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {build}=require('esbuild');const dir=mkdtempSync(join(tmpdir(),'review-display-'));
try {
 const out=join(dir,'projection.mjs');await build({entryPoints:['artifacts/api-server/src/lib/publicExplanatoryReview.ts'],bundle:true,platform:'node',format:'esm',outfile:out});
 const {projectExplanatoryReview:project,explanatoryPaperIdentity:identity}=await import(pathToFileURL(out));
 const legacy={id:'legacy',score:95,createdAt:'2026-06-28T00:00:00Z'};
 const saved={id:'saved',paperId:'paper',promptName:'explanatory-update-B2.1',promptVersion:'B2.1-v3',recommendedScore:77,createdAt:'2026-07-08T00:00:00Z',correctnessInternal:'sound',evidencePackets:[{private:'secret'}],adjudicatedJson:{scientificReview:'A useful empirical constraint.',frameworkConditionalValue:'internal only',correctnessAssessment:'internal only'}};
 const before=JSON.stringify({legacy,saved});const current=project(saved,legacy);
 assert.equal(current.score,77);assert.equal(current.id,'legacy');assert.equal(JSON.stringify({legacy,saved}),before);
 assert.equal(project({...saved,recommendedScore:94},legacy).score,94);
 assert.equal(JSON.stringify(current).includes('secret'),false);assert.equal(JSON.stringify(current).includes('internal only'),false);
 const corrected=project({...saved,recommendedScore:0,contributionPassage:'Saved re-verification: the contribution survives.',adjudicatedJson:{scientificReview:'Overturned fatal allegation',restorationCorrection:{}}},legacy);
 assert.equal(corrected.score,null);assert.equal(JSON.parse(corrected.coverageLedgerJson).scorePendingReassessment,true);assert.equal(JSON.stringify(corrected).includes('Overturned fatal allegation'),false);
 assert.equal(project(saved,{...legacy,createdAt:'2026-08-01'}),null);
 assert.equal(project({...saved,promptName:'unrelated'}),null);
 assert.equal(project({...saved,correctnessInternal:'fatal_alleged_unverified'}),null);
 assert.equal(project({...saved,recommendedScore:101}),null);
 assert.equal(identity({title:'Same Paper',content:'text',paperAuthors:'A'}),identity({title:'same paper',content:'text',paperAuthors:'A'}));
 assert.notEqual(identity({title:'Same Paper',content:'text',paperAuthors:'A'}),identity({title:'Same Paper',content:'different',paperAuthors:'A'}));
 console.log('Review display invariants passed: later saved scores, immutable legacy records, privacy, correction withholding, newer-review precedence, duplicate identity.');
}finally{rmSync(dir,{recursive:true,force:true});}
