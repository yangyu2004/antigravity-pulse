// Synthetic browser regression for the "⚡ 重新调起" button.
// Verifies: (1) the prompt is inserted exactly once even when the editor ignores execCommand's
// return value; (2) clicking while the model is generating normally needs a second confirm click
// and does not press the host stop button on the first click; (3) a stalled snapshot reinvokes at once.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=join(dirname(fileURLToPath(import.meta.url)),'..');
const extract=s=>s.slice(s.indexOf('module.exports = ')+17).trim().replace(/;$/,'');
const [i18n,theme,usage,widget]=await Promise.all(['i18n','theme','usage-ui','inline-widget'].map(n=>readFile(join(repo,'compat',n+'.cjs'),'utf8')));
const id='11111111-1111-1111-1111-111111111111';
const PROMPT='继续推进当前任务，若刚才卡住请换种方式执行';
const html=`<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#17181a;color:#ddd;font:13px sans-serif;padding:40px}.composer{width:980px;margin:220px auto 0;background:#27282a;padding:12px;border-radius:18px}.editor{height:48px}.actions{display:flex;align-items:center;gap:5px;height:32px}.left{display:flex;flex:none;min-width:0}.right{display:flex;gap:5px;margin-left:auto}button{background:transparent;border:0;color:inherit;height:28px;white-space:nowrap}
</style></head><body><section class="composer" data-testid="agent-input-box"><div class="editor" role="textbox" contenteditable="true"></div><div class="actions"><div class="left"><button id="native-add">＋</button><button data-testid="model-selector-trigger">Gemini</button></div><div class="right"><button id="native-stop" data-testid="stop-button">■</button><button id="native-send" data-testid="send-button">➤</button></div></div></section>
<script>
history.replaceState({},'', '/c/${id}');window.__agPulseI18nFactory=(${extract(i18n)});window.__agPulseThemeFactory=(${extract(theme)});window.__agPulseUsageFactory=(${extract(usage)});
window.fixtureFactory=(${extract(widget)});
window.sent=[];window.stops=0;window.reinvokeCalls=0;window.taskProgress=null;
document.getElementById('native-send').onclick=()=>{const e=document.querySelector('.editor');sent.push(e.textContent);e.textContent='';};
document.getElementById('native-stop').onclick=()=>{stops++;};
// 模拟 Lexical 类编辑器：execCommand 实际插入了文字，但返回 false，且文字落地有延迟
document.execCommand=(cmd,ui,value)=>{if(cmd==='insertText'){const e=document.activeElement;setTimeout(()=>{e.textContent+=value;},10);}return false;};
document.querySelector('.editor').addEventListener('beforeinput',e=>{if(e.inputType==='insertText'){e.target.textContent+=e.data;}});
const prefs={language:'zh-CN',languageGuideDismissed:true,usageGuideDismissed:true,revision:1};
window.agPulseHost={getMetrics:async()=>({connection:'live',groups:[],speed:null,taskProgress:window.taskProgress}),getPreferences:async()=>prefs,setPreferences:async i=>Object.assign(prefs,i),report:()=>{},taskAction:async a=>{if(a.action==='reinvoke')reinvokeCalls++;return {ok:true};}};
</script></body></html>`;
const steps=[{id:1,title:'第一步',status:'completed',percent:100},{id:2,title:'第二步',status:'running',percent:50}];
const snap=stalled=>({status:stalled?'stalled':'running',isStalled:stalled,stalledDuration:stalled?200:0,stalledReason:stalled?'模型思考已连续 200 秒无新响应':null,headline:'x',progressPercent:50,elapsedSeconds:10,showInlineCard:true,steps,dataSource:'test',latestTask:null});

const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
let browser;const errors=[],results=[];
async function open(stalled){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(s=>{window.taskProgress=s;window.fixtureFactory();},snap(stalled));
  await page.locator('#ag-pulse-status-bar').waitFor();
  await page.waitForFunction(()=>!document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('task-chip').hidden,null,{timeout:5000});
  await page.evaluate(()=>document.getElementById('ag-pulse-status-bar').shadowRoot.getElementById('task-chip').click());
  const btn=page.locator('#ag-pulse-status-bar').locator('#tp-reinvoke-btn');
  await btn.waitFor({state:'visible'});
  return {page,btn};
}
try{
  browser=await chromium.launch({headless:true});
  {
    const {page,btn}=await open(false);
    await btn.click();await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>stops),0,'First click while generating normally must not stop the model');
    assert.equal(await page.evaluate(()=>sent.length),0,'First click while generating normally must not send');
    assert.match(await btn.textContent(),/再点一次/);
    await btn.click();await page.waitForFunction(()=>sent.length===1,null,{timeout:4000});
    assert.equal(await page.evaluate(()=>sent[0]),PROMPT,'Prompt must be inserted exactly once');
    await page.close();results.push({case:'not-stalled-needs-confirm',passed:true});
  }
  {
    const {page,btn}=await open(false);
    await btn.click();await page.waitForTimeout(4300);
    assert.match(await btn.textContent(),/重新调起/,'Unconfirmed arm must expire');
    await btn.click();await page.waitForTimeout(300);
    assert.equal(await page.evaluate(()=>sent.length),0,'A click after the arm expired must ask again');
    await page.close();results.push({case:'confirm-window-expires',passed:true});
  }
  {
    const {page,btn}=await open(true);
    await btn.click();await page.waitForFunction(()=>sent.length===1,null,{timeout:4000});
    assert.equal(await page.evaluate(()=>sent[0]),PROMPT,'Stalled reinvoke must insert the prompt exactly once');
    await page.close();results.push({case:'stalled-reinvokes-immediately',passed:true});
  }
  assert.deepEqual(errors,[],'Reinvoke flow must not produce uncaught page errors');
  console.log(JSON.stringify({results,errors},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
