/** Offline shared-header account checks. Auth navigation and all APIs are intercepted. */
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const base=process.env.FORMAL_LAB_BASE_URL||'http://127.0.0.1:4187',origin=new URL(base).origin;
const out=process.env.FORMAL_WORKFLOW_OUTPUT_DIR||path.join(tmpdir(),'msr-formal-account-navigation');
await fs.mkdir(out,{recursive:true});
const name='Alexandria ExtremelyLongFamilyName With An Additional Long Display Name';
let signedIn=true;
const requests=[],authNavigations=[],checks=[],errors=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  assert.equal(url.origin,origin,'Only the local fixture origin may receive API requests');
  assert.equal(request.method(),'GET','Account navigation must not write data or call inference');
  requests.push({method:request.method(),path:url.pathname});
  if(['/api/login','/api/logout'].includes(url.pathname)){
    authNavigations.push({path:url.pathname,returnTo:url.searchParams.get('returnTo')});
    return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Intercepted account navigation</title><h1>Offline navigation intercepted</h1>'});
  }
  const data=url.pathname==='/api/auth/user'?{user:signedIn?{id:'offline-account',email:'offline@example.invalid',firstName:name,lastName:null,profileImageUrl:null}:null}:url.pathname==='/api/formal-lab/papers'?{papers:[]}:url.pathname==='/api/formal-lab/subjects'?{subjects:[]}:null;
  return route.fulfill({status:data?200:404,contentType:'application/json',body:JSON.stringify(data||{error:'Unrecognized offline fixture route'})});
});
async function focused(locator){return locator.evaluate(element=>element===document.activeElement);}
async function closed(button){await page.getByRole('menu',{name:'Account',exact:true}).waitFor({state:'detached'});assert.equal(await button.getAttribute('aria-expanded'),'false');}
try{
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    await page.goto(base+'/?campaign=account-check');
    const button=page.getByRole('button',{name:`Account menu for ${name}`,exact:true});
    await button.waitFor({state:'visible'});
    const menu=page.getByRole('menu',{name:'Account',exact:true}),logout=page.getByRole('menuitem',{name:'Sign out',exact:true});
    assert.equal(await page.locator('.fl-account').textContent(),name);
    assert.equal(await page.locator('.fl-account').getAttribute('title'),name);
    assert.equal(await button.getAttribute('aria-haspopup'),'menu');
    assert.equal(await button.getAttribute('aria-expanded'),'false');
    assert.equal(await menu.count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`Closed header fits ${width}px`);
    await button.click();await menu.waitFor({state:'visible'});
    assert.equal(await button.getAttribute('aria-expanded'),'true');
    assert.equal(await menu.getAttribute('id'),await button.getAttribute('aria-controls'));
    assert.equal(await logout.getAttribute('href'),'/api/logout');
    assert.equal(await focused(logout),true,'Opening the account menu focuses its action');
    const bounds=await menu.boundingBox();assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1,`Open account menu fits ${width}px`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`Open header fits ${width}px`);
    await page.screenshot({path:path.join(out,`account-menu-${width}.png`),fullPage:false});
    await page.keyboard.press('Escape');await closed(button);assert.equal(await focused(button),true,'Escape restores the account button focus');
    await page.keyboard.press('ArrowDown');await menu.waitFor({state:'visible'});assert.equal(await focused(logout),true,'ArrowDown opens and focuses Sign out');
    await page.keyboard.press('Tab');await closed(button);assert.equal(await focused(page.locator('.fl-header-upload')),true,'Tab leaves the menu for Upload paper');
    await button.click();await menu.waitFor({state:'visible'});await page.mouse.click(5,895);await closed(button);
    await button.click();await menu.waitFor({state:'visible'});await page.getByRole('searchbox',{name:'Search published papers'}).focus();await closed(button);
    checks.push({width,longNameVisible:true,mouseOpen:true,signOutRoute:true,arrowDown:true,escapeRestoresFocus:true,tabCloses:true,outsideCloses:true,blurCloses:true,overflow:false});
  }
  const trigger=page.getByRole('button',{name:`Account menu for ${name}`,exact:true});await trigger.click();
  await Promise.all([page.waitForURL(url=>url.pathname==='/api/logout'),page.getByRole('menuitem',{name:'Sign out',exact:true}).click()]);
  await page.getByRole('heading',{name:'Offline navigation intercepted',exact:true}).waitFor();
  assert.deepEqual(authNavigations,[{path:'/api/logout',returnTo:null}]);
  signedIn=false;
  const returnTo='/?view=subjects&sort=title&campaign=account-check';await page.goto(base+returnTo);
  const signIn=page.getByRole('button',{name:'Sign in',exact:true});await signIn.waitFor({state:'visible'});
  assert.equal(await page.getByRole('button',{name:/Account menu for/}).count(),0);
  await Promise.all([page.waitForURL(url=>url.pathname==='/api/login'),signIn.click()]);
  await page.getByRole('heading',{name:'Offline navigation intercepted',exact:true}).waitFor();
  assert.deepEqual(authNavigations,[{path:'/api/logout',returnTo:null},{path:'/api/login',returnTo}]);
  assert.deepEqual(errors,[]);
  const result={status:'passed',checks,signOutNavigationIntercepted:true,signInNavigationIntercepted:true,loginReturnToPreserved:true,allApisMocked:true,productionRequests:0,requests,authNavigations,pageErrors:errors};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:'passed',widths:checks.map(check=>check.width),outputDir:out,pageErrors:errors}));
}catch(error){await page.screenshot({path:path.join(out,'account-navigation-failure.png'),fullPage:false}).catch(()=>{});throw error;}finally{await browser.close();}
