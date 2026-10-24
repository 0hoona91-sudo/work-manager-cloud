const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {read}=require('./helpers.cjs'),{withPage}=require('./browser.test.cjs');
const asset='assets/shared-hello-kitty-bg-68137d.webp',url='./'+asset+'?v=phase9';
module.exports=({test,EnvironmentUnavailable})=>{
 test('STYLE-ASSET-01','Repeated Hello Kitty WebP is one byte-identical local asset',()=>{
  const blob=fs.readFileSync(asset);assert.equal(blob.length,334682);assert.equal(blob.toString('ascii',0,4),'RIFF');assert.equal(blob.toString('ascii',8,12),'WEBP');
  assert.equal(crypto.createHash('sha256').update(blob).digest('hex'),'5b5d3ba3099af0c16168345ef541a15917575037c4bffeb85577828d7fc43686');
  const html=read('index.html');assert.equal(html.split(url).length-1,6);assert.equal(html.includes('data:image/webp;base64,UklGRlIbBQBXRUJQV'),false);
 });
 test('STYLE-ASSET-02','Real Chromium loads the shared theme image once without 404 at four widths',()=>withPage({width:1440,height:900},EnvironmentUnavailable,async page=>{
  let requests=0,missing=0;page.on('request',request=>{if(request.url().includes('shared-hello-kitty-bg-68137d.webp'))requests++});page.on('response',response=>{if(response.url().includes('shared-hello-kitty-bg-68137d.webp')&&response.status()===404)missing++});
  await page.evaluate(()=>{state.settings.uiTheme='hellokitty';applyThemeV7();});await page.waitForLoadState('networkidle');
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>renderHome());}
  assert.equal(requests,1);assert.equal(missing,0);
 }));
};
