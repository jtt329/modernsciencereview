/** Layout and file-selection checks only; all API traffic is intercepted and writes are blocked. */
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const base=process.env.FORMAL_LAB_BASE_URL||'http://127.0.0.1:4175',out=process.env.FORMAL_WORKFLOW_OUTPUT_DIR||'/private/tmp/msr-compact-layout';
await fs.mkdir(out,{recursive:true});
const example=JSON.parse(await fs.readFile(new URL('../artifacts/api-server/src/formal/example.json',import.meta.url),'utf8'));
const paper={id:'11111111-1111-4111-8111-111111111111',revisionId:'22222222-2222-4222-8222-222222222222',revision:1,title:'A source-linked mathematical result',authors:'Fixture Author',summary:'A conditional result with an inspectable source and exact mathematical evidence.',mainClaim:'The stated derivative follows under explicit premises.',source:{url:'/fixture.pdf',filename:'fixture.pdf',pageCount:1,sha256:'a'.repeat(64),version:'1'},subject:{slug:'calculus',title:'Calculus',url:'/formal-lab/subjects/calculus'},publishedAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:00:00Z',reviewUrl:'/formal-lab?submission=11111111-1111-4111-8111-111111111111&tab=review',rigor:{equations:1,checkedEquations:1,identities:1,definitionRestatements:0,sourceStatements:1,checkedSourceStatements:1,declaredInputs:1,openStatements:0},concepts:['Derivatives']};
const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],writes=[],measurements=[];
page.on('pageerror',error=>errors.push(error.message));
await context.route('**/api/**',async route=>{
 const request=route.request(),p=new URL(request.url()).pathname;
 if(request.method()!=='GET'){writes.push({path:p,method:request.method()});return route.abort('blockedbyclient');}
 const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
 if(p==='/api/auth/user')return json({user:{id:'layout-owner',firstName:'A deliberately long author display name',email:'fixture@example.invalid'}});
 if(p==='/api/formal-lab/catalog')return json({inputs:example.selectedInputs,example,exampleDigest:'b'.repeat(64),models:[{id:'sol',label:'Offline model fixture',model:'fixture',provider:'openai',available:true}],defaultModel:'sol',capabilities:{checker:'Offline fixture',scope:['Exact algebra']}});
 if(p==='/api/formal-lab/submissions')return json({submissions:[]});
 if(p==='/api/formal-lab/papers')return json({papers:[paper]});
 if(p==='/api/formal-lab/subjects')return json({subjects:[]});
 if(p==='/api/formal-lab/subjects/calculus')return json({slug:'calculus',title:'Calculus',version:0,updatedAt:'2026-10-26T00:00:00Z',nodeKind:'navigation-parent',paragraphs:[],parent:null,children:[]});
 return json({error:'No offline route expected.'},404);
});
async function header(){
 const h=page.locator('.fl-site-header');await h.waitFor();
 for(const [name,href] of [['Explore papers','/'],['Compiled explanations','/?view=subjects']]){const link=h.getByRole('link',{name,exact:true});assert.equal(await link.getAttribute('href'),href);assert.equal(await link.isVisible(),true);const b=await link.boundingBox();assert.ok(b.x>=0&&b.x+b.width<=await page.evaluate(()=>innerWidth)+1);}
 assert.equal(await h.getByText('Scientific library',{exact:true}).count(),0);assert.equal(await h.locator('.fl-header-upload').isVisible(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
}
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844},{width:320,height:900}]){
  await page.setViewportSize(viewport);await page.goto(base+'/');await page.locator('.fl-library-paper').first().waitFor();await header();
  assert.equal(await page.locator('.fl-library-principles,.fl-library-hero-actions').count(),0);
  const hero=await page.locator('.fl-library-hero').boundingBox(),heading=await page.locator('.fl-library-hero h1').boundingBox(),card=await page.locator('.fl-library-paper').first().boundingBox();
  assert.ok(heading.width>=hero.width-3,'Library heading spans the former sidebar area');assert.ok(card.y<(viewport.width>700?650:850),'Paper previews appear higher on the page');
  await page.screenshot({path:path.join(out,`home-${viewport.width}.png`),fullPage:false});
  await page.locator('.fl-header-upload').click();await page.locator('.fl-upload-hero').waitFor();await header();
  assert.equal(await page.locator('.fl-pilot-card,.fl-upload-hero .fl-hero-actions,.fl-upload-hero .fl-button,.fl-upload-hero .fl-hero-footnote').count(),0);
  assert.equal(await page.getByRole('heading',{name:'A one-page test of horizon mechanics',exact:true}).count(),0);
  const uploadHero=await page.locator('.fl-upload-hero').boundingBox(),copy=await page.locator('.fl-upload-hero .fl-hero-copy').boundingBox(),steps=await page.locator('.fl-steps').boundingBox(),drop=await page.locator('.fl-dropzone').boundingBox();
  assert.ok(Math.abs(copy.width-uploadHero.width)<3);assert.ok(Math.abs(steps.width-uploadHero.width)<3);assert.ok(steps.y<(viewport.width>700?300:500));assert.ok(drop.y<(viewport.width>700?530:730),'Paper input is visible without the removed sample panel');
  measurements.push({viewport,homePreviewTop:card.y,uploadStagesTop:steps.y,uploadDropTop:drop.y});
  await page.screenshot({path:path.join(out,`upload-${viewport.width}.png`),fullPage:false});
 }
 const chooser=page.waitForEvent('filechooser');await page.locator('.fl-header-upload').click();await(await chooser).setFiles({name:'layout-paper.txt',mimeType:'text/plain',buffer:Buffer.from('An offline source fixture.')});await page.getByRole('heading',{name:'layout-paper.txt',exact:true}).waitFor();assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 const report={status:'passed',apiTrafficIntercepted:true,noProviderCalls:true,headerNavigationAlwaysVisible:true,heroDuplicatesRemoved:true,fullWidthIntroductions:true,headerFileSelectionWorks:true,measurements,writeRequests:writes,pageErrors:errors};await fs.writeFile(path.join(out,'compact-layout-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await page.screenshot({path:path.join(out,'failure.png'),fullPage:false}).catch(()=>{});console.error(error);process.exitCode=1;}finally{await browser.close();}
