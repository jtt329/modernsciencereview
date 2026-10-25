import {test,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));const require=createRequire(path.join(root,'artifacts/api-server/package.json'));const {build}=require('esbuild');
const dir=await mkdtemp(path.join(tmpdir(),'formal-literature-'));after(()=>rm(dir,{recursive:true,force:true}));
await build({entryPoints:[path.join(root,'artifacts/api-server/src/formal/literature.ts')],outfile:path.join(dir,'literature.mjs'),platform:'node',bundle:true,format:'esm',logLevel:'silent',plugins:[{name:'ai-boundary',setup(b){b.onResolve({filter:/^\.\/model$/},()=>({path:'model',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"export function getCurrentFormalModel(){return {model:'gpt-6.1-sol'}};export async function callFormalAI(options){return await globalThis.__literatureAI(options)}"}));}}]});
await build({entryPoints:[path.join(root,'artifacts/api-server/src/formal/package.ts')],outfile:path.join(dir,'package.mjs'),platform:'node',bundle:true,format:'esm',logLevel:'silent'});
const {validateLiteratureQueries,buildLiteratureSearchUrl,parseArxivLiterature,parseCrossrefLiterature,deduplicateLiterature,validateLiteratureReview,runLiteratureAssessment}=await import(pathToFileURL(path.join(dir,'literature.mjs')).href);
const {packageDigest}=await import(pathToFileURL(path.join(dir,'package.mjs')).href);
const originalFetch=globalThis.fetch;
const source={id:'11111111-1111-4111-8111-111111111111',sha256:'b'.repeat(64),lines:[{id:'p1-l001',page:1,line:1,text:'A canonical boundary response is proposed.'}]};
const atom=`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/1611.03096v2</id><title>Gravity Degrees of Freedom on a Null Surface</title><published>2016-11-09T00:00:00Z</published><author><name>Florian Hopfmuller</name></author><summary>Canonical null surface pairs and boundary terms are derived under the stated conventions.</summary><arxiv:doi>10.1103/PhysRevD.95.104006</arxiv:doi></entry></feed>`;
const crossref={message:{items:[{DOI:'10.1103/PhysRevD.95.104006',title:['Gravity Degrees of Freedom on a Null Surface'],author:[{given:'Florian',family:'Hopfmuller'}],issued:{'date-parts':[[2017,5,1]]},abstract:'<jats:p>Canonical null surface pairs and boundary terms.</jats:p>'},{DOI:'10.1103/PhysRevD.87.124011',title:['Structure of the Gravitational Action'],issued:{'date-parts':[[2013]]}}]}};
const sectionIds=['inputs-construction-output','explanation','already-known','proposed-advance','contribution-to-field','limitations'];
function review(papers){return {summary:'A proposed construction should be compared with the retrieved foundations; novelty remains unestablished.',sections:sectionIds.map(id=>({id,title:id,text:'The manuscript states a canonical response. Retrieved records give limited comparison context; full-text checks remain necessary.',sourceLineIds:['p1-l001'],paperIds:papers.length?[papers[0].id]:[],evidenceBasis:papers.length?'mixed':'manuscript'})),comparisons:papers.map(paper=>({paperId:paper.id,relationship:'uncertain',alreadyKnown:'The retrieved record describes canonical structures.',proposedDifference:'The precise difference needs full-text comparison.',neededEvidence:['Relevant full texts and theorem conventions.']})),relevance:papers.map(paper=>({paperId:paper.id,text:'Possible foundational connection; the exact theorem needs full text.'}))};}
beforeEach(()=>{globalThis.fetch=async url=>new URL(url).hostname==='export.arxiv.org'?new Response(atom,{headers:{'Content-Type':'application/atom+xml'}}):new Response(JSON.stringify(crossref),{headers:{'Content-Type':'application/json'}});globalThis.__literatureAI=async options=>({data:options.payload.papers?review(options.payload.papers):{queries:[{text:'null boundary canonical response',rationale:'Find the closest mathematical construction.'}]},model:'gpt-6.1-sol'});});
afterEach(()=>{globalThis.fetch=originalFetch;delete globalThis.__literatureAI;});

test('query plans are bounded text and URLs are built only for official metadata providers',()=>{
 const queries=validateLiteratureQueries({queries:[{text:'horizon canonical force',rationale:'Nearest claims.'}]});assert.equal(queries[0].text,'horizon canonical force');
 for(const provider of ['arxiv','crossref']){const url=new URL(buildLiteratureSearchUrl(provider,queries[0].text));assert.equal(url.hostname,provider==='arxiv'?'export.arxiv.org':'api.crossref.org');assert.equal(url.searchParams.get(provider==='arxiv'?'max_results':'rows'),'6');}
 for(const text of ['http://127.0.0.1/secrets','is or','a '.repeat(15),'x'])assert.throws(()=>validateLiteratureQueries({queries:[{text,rationale:'Test.'}]}));
 assert.throws(()=>validateLiteratureQueries({queries:[],host:'evil'}));
});

test('arXiv Atom and Crossref records retain actual identifiers, dates and evidence level',()=>{
 const arxiv=parseArxivLiterature(atom);assert.equal(arxiv.length,1);assert.equal(arxiv[0].arxivId,'1611.03096v2');assert.equal(arxiv[0].year,2016);assert.equal(arxiv[0].doi,'10.1103/physrevd.95.104006');assert.equal(arxiv[0].evidenceLevel,'abstract');
 const cr=parseCrossrefLiterature(crossref);assert.equal(cr.length,2);assert.equal(cr[1].evidenceLevel,'metadata');assert.equal(cr[0].url,'https://doi.org/10.1103/physrevd.95.104006');
 assert.throws(()=>parseArxivLiterature('<!DOCTYPE feed [<!ENTITY secret SYSTEM "file:///etc/passwd">]>'+atom),/Invalid/);
 assert.throws(()=>parseArxivLiterature('<feed><entry><id>http://arxiv.org/api/errors</id></entry></feed>'),/error feed/);
 assert.deepEqual(parseArxivLiterature(atom.replace('http://arxiv.org/abs/1611.03096v2','http://evil.example/abs/1611.03096v2')),[]);
 for(const malformed of ['<error>bad request</error>','<feed>','<feed xmlns="http://www.w3.org/2005/Atom"><entry></feed>'])assert.throws(()=>parseArxivLiterature(malformed),/complete Atom/);
 assert.deepEqual(parseArxivLiterature('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'),[]);
});

test('deduplication joins DOI/title matches and retains stronger retrieved abstract evidence',()=>{
 const arxiv=parseArxivLiterature(atom);const cr=parseCrossrefLiterature(crossref);const papers=deduplicateLiterature([...arxiv,...cr]);assert.equal(papers.length,2);assert.equal(papers[0].arxivId,'1611.03096v2');assert.equal(papers[0].evidenceLevel,'abstract');
 const first={...arxiv[0]};delete first.doi;const joined=deduplicateLiterature([first,cr[0],{...cr[0],title:'Different deposited title'}]);assert.equal(joined.length,1);
 const conflict={...cr[0],id:'other-doi',doi:'10.9999/distinct',abstract:'A different paper abstract.'};assert.equal(deduplicateLiterature([cr[0],conflict]).length,2);
 const authorConflict={...cr[0],id:'other-author',doi:undefined,arxivId:'2601.12345',authors:['Different Author']};assert.equal(deduplicateLiterature([first,authorConflict]).length,2);
});

test('review evidence cannot fabricate papers, source lines, full-text levels or omit requested sections',()=>{
 const papers=deduplicateLiterature([...parseArxivLiterature(atom),...parseCrossrefLiterature(crossref)]);assert.equal(validateLiteratureReview(review(papers),source,papers).sections.length,6);
 for(const change of [v=>v.sections[0].paperIds=['made-up'],v=>v.sections[0].sourceLineIds=['p1-l999'],v=>v.sections.pop(),v=>v.sections[0].evidenceBasis='fulltext',v=>v.relevance.pop(),v=>v.noveltyEstablished=true]){const value=review(papers);change(value);assert.throws(()=>validateLiteratureReview(value,source,papers));}
 const falseAbstract=review(papers);falseAbstract.sections[0].paperIds=[papers[1].id];falseAbstract.sections[0].evidenceBasis='abstract';assert.throws(()=>validateLiteratureReview(falseAbstract,source,papers),/metadata-only/);
});

test('real pipeline records actual searches, sends abstracts privately, and preserves the original revision',async()=>{
 const pkg=JSON.parse(await readFile(path.join(root,'artifacts/api-server/src/formal/example.json'),'utf8'));pkg.source.sha256=source.sha256;pkg.analysis={sourceId:source.id,subjectTitle:'Horizon thermodynamics'};const original=JSON.stringify(pkg);const calls=[];const requests=[];
 const fetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{requests.push({url,redirect:options.redirect});return fetch(url,options);};
 globalThis.__literatureAI=async options=>{calls.push(options);return {data:options.payload.papers?review(options.payload.papers):{queries:[{text:'boundary canonical scientific comparison',rationale:'Compare nearest prior constructions.'}]},model:'gpt-6.1-sol'};};
 const report={packageDigest:packageDigest(pkg),checker:'Trusted checker',engine:'SymPy',status:'checked',claims:[{id:'scalar-1',status:'checked',derivationKind:'identity'}],limitations:['Adopted physical inputs remain conditional.']};
 const result=await runLiteratureAssessment(pkg,source,packageDigest(pkg),undefined,report);assert.equal(calls[1].payload.verification.claims[0].id,'scalar-1');assert.equal(calls[1].payload.verification.available,true);assert.ok(!Number.isNaN(Date.parse(calls[1].payload.assessmentTimestampUTC)));assert.equal(result.status,'bounded-literature-assessment');assert.equal(result.noveltyEstablished,false);assert.equal(result.searches.length,2);assert.ok(result.searches.every(search=>search.status==='searched'));assert.equal(result.papers.length,2);assert.ok(!result.papers.some(paper=>Object.hasOwn(paper,'abstract')));assert.ok(calls[1].payload.papers.some(paper=>paper.abstract));assert.ok(requests.every(request=>request.redirect==='error'));assert.equal(result.sections.length,6);assert.equal(JSON.stringify(pkg),original);
 await assert.rejects(()=>runLiteratureAssessment(pkg,source,'a'.repeat(64)),/exact saved/);
 await assert.rejects(()=>runLiteratureAssessment(pkg,source,packageDigest(pkg),undefined,{...report,packageDigest:'c'.repeat(64)}),/mathematical report/);
});

test('unavailable metadata providers never become completed searches or invented literature',async()=>{
 const pkg=JSON.parse(await readFile(path.join(root,'artifacts/api-server/src/formal/example.json'),'utf8'));pkg.source.sha256=source.sha256;pkg.analysis={sourceId:source.id,subjectTitle:'Horizon thermodynamics'};globalThis.fetch=async()=>new Response('down',{status:503});
 globalThis.__literatureAI=async options=>({data:options.payload.papers?review(options.payload.papers):{queries:[{text:'unavailable unusual null boundary search',rationale:'Exercise missing provider evidence.'}]},model:'gpt-6.1-sol'});
 const result=await runLiteratureAssessment(pkg,source,packageDigest(pkg));assert.ok(result.searches.every(search=>search.status==='unavailable'));assert.equal(result.papers.length,0);assert.equal(result.noveltyEstablished,false);assert.equal(result.sections.length,6);
});

test('matching prior searches and cited full-text passages are reused for one grounded synthesis without republishing passages',async()=>{
 const pkg=JSON.parse(await readFile(path.join(root,'artifacts/api-server/src/formal/example.json'),'utf8'));pkg.source.sha256=source.sha256;pkg.analysis={sourceId:source.id,subjectTitle:'Horizon thermodynamics'};
 const references=[{id:'1611.03096',title:'Gravity Degrees of Freedom on a Null Surface',url:'https://arxiv.org/html/1611.03096v2',status:'retrieved',retrievedAt:new Date().toISOString(),excerpts:[{id:'excerpt-1',locator:'https://arxiv.org/html/1611.03096v2#S4',text:'A privately retrieved full-text passage about polarization and boundary terms.'}],extractionNote:'Selected passages only.'}];
 let calls=0;let payload;globalThis.fetch=async()=>{throw new Error('Existing evidence should be reused')};
 globalThis.__literatureAI=async options=>{calls++;payload=options.payload;return {model:'gpt-6.1-sol',data:review(options.payload.papers)};};
 const prepared={packageDigest:packageDigest(pkg),model:'gpt-6.1-sol',queries:[{text:'canonical boundary comparisons',rationale:'Actual earlier query.'}],searches:[],papers:[],primaryReferences:references};
 const result=await runLiteratureAssessment(pkg,source,packageDigest(pkg),undefined,undefined,prepared);
 assert.equal(calls,1);assert.equal(result.papers.length,1);assert.equal(result.papers[0].evidenceLevel,'selected-fulltext');assert.equal(result.papers[0].year,2016);assert.equal(payload.papers[0].passages.length,1);assert.ok(!JSON.stringify(result).includes('privately retrieved full-text passage'));assert.equal(result.searches[0].resultCount,1);assert.equal(result.noveltyEstablished,false);
 await assert.rejects(()=>runLiteratureAssessment(pkg,source,packageDigest(pkg),undefined,undefined,{...prepared,packageDigest:'c'.repeat(64)}),/Prepared literature/);
});
