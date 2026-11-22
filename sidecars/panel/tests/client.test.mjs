import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import http from 'node:http';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {AntigravityClient, endpointFromEnv, serverFromDiscovery} from '../client.mjs';

// Synthetic RPC fixtures own every accepted socket. End them explicitly:
// HTTP keep-alive teardown must not hold the cross-platform test runner open.
const stopServer=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});

test('invalid projected JSON settles even when destroying a sent request emits no error',async t=>{
 const original=http.request;let destroyed=false;
 http.request=(_options,onResponse)=>{
  const req=new EventEmitter();req.setTimeout=()=>req;
  req.destroy=()=>{destroyed=true;req.emit('close');return req;};
  req.end=()=>queueMicrotask(()=>{
   const res=new EventEmitter();res.statusCode=200;res.setEncoding=()=>res;
   onResponse(res);res.emit('data','{broken');res.emit('end');
  });return req;
 };
 syncBuiltinESMExports();t.after(()=>{http.request=original;syncBuiltinESMExports();});
 const client=new AntigravityClient({now:()=>0});client.server={port:1234,csrf:'fixture',pid:42};
 let timer;
 try{await Promise.race([
  assert.rejects(client.call('GetCascadeTrajectory'),error=>error.message==='Antigravity 接口返回了无法解析的数据'),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Invalid stream left the RPC pending')),1000);})
 ]);}finally{clearTimeout(timer);}
 assert.equal(destroyed,true);
});
async function fixture(t){
 const state={scans:0,now:100000,status:404,body:'{}',requests:0};
 const server=createServer((req,res)=>{state.requests++;req.resume();res.writeHead(state.status,{'Content-Type':'application/json'});res.end(state.body);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>stopServer(server));
 state.port=server.address().port;state.pid=42;
 const client=new AntigravityClient({now:()=>state.now,env:{},paths:()=>({log:'fixture'}),readLog:async()=>`listening on random port at ${state.port} for HTTP\n`,
  processes:async()=>{state.scans++;return [{ProcessId:state.pid,CommandLine:'language_server --standalone --csrf_token=fixture',Ports:[state.port]}];}});
 return {client,state,server};
}

test('unavailable history and malformed RPC replies never invalidate a healthy endpoint',async t=>{
 const {client,state}=await fixture(t);
 const rejects=async(method,body)=>{
  let timer;
  try{await Promise.race([assert.rejects(client.call(method,body)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`RPC fixture stalled: status=${state.status}, requests=${state.requests}, method=${method}`)),10000);})]);}
  finally{clearTimeout(timer);}
 };
 for(const status of [400,404,409,429,500,503]){
  state.status=status;
  for(let i=0;i<3;i++)await rejects('GetCascadeTrajectory',{cascadeId:'missing'});
 }
 state.status=200;state.body='{broken';await rejects('GetCascadeTrajectory');
 state.body='{}';assert.deepEqual(await client.call('GetUserStatus'),{});
 assert.equal(state.scans,1,'Conversation/protocol failures must not spawn another process scan');
 assert.equal(state.requests,20,'Application failures are not blindly retried');
 assert.ok(client.server);
});

test('ordinary RPC JSON errors never expose a private response fragment',async t=>{
 const {client,state}=await fixture(t);state.status=200;state.body='{"private":"DO_NOT_DISCLOSE" invalid}';
 await assert.rejects(client.call('GetUserStatus'),error=>error.message==='Antigravity 接口返回了无法解析的数据');
 state.body='{}';assert.deepEqual(await client.call('GetUserStatus'),{});assert.equal(state.scans,1);
});

test('conversation-list RPC keeps delegation metadata while discarding embedded messages',async t=>{
 const {client,state}=await fixture(t);state.status=200;
 const root='11111111-1111-1111-1111-111111111111',child='22222222-2222-2222-2222-222222222222';
 state.body=JSON.stringify({trajectorySummaries:{[root]:{stepCount:4,status:'IDLE'},[child]:{
  stepCount:2,hasActiveChildren:true,trajectoryMetadata:{parentConversationId:root,rootConversationId:root,subagentSpec:{initialPrompt:'PRIVATE_PROMPT'}},
  latestNotifyUserStep:{message:'PRIVATE_REPLY'},waitingSteps:[{response:'PRIVATE_TOOL'}],
 }}});
 const result=await client.call('GetAllCascadeTrajectories',{excludeSubtrajectories:false});
 assert.equal(result.trajectorySummaries[child].trajectoryMetadata.parentConversationId,root);
 assert.equal(result.trajectorySummaries[child].hasActiveChildren,true);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|subagentSpec|waitingSteps|latestNotifyUserStep/);
});

test('cold-start discovery failures coalesce and back off while the backend starts',async()=>{
 let now=0,scans=0,ready=false;
 const client=new AntigravityClient({now:()=>now,env:{},paths:()=>({log:'fixture'}),readLog:async()=> 'listening on random port at 1234 for HTTP\n',
  processes:async()=>{scans++;return ready?[{ProcessId:42,CommandLine:'language_server --standalone --csrf_token=fixture',Ports:[1234]}]:[];}});
 await Promise.allSettled(Array.from({length:20},()=>client.discover()));assert.equal(scans,1);
 for(let i=0;i<20;i++)await assert.rejects(client.discover());assert.equal(scans,1);
 now=3000;await assert.rejects(client.discover());assert.equal(scans,2);
 now=4000;ready=true;await assert.rejects(client.discover());assert.equal(scans,2);
 now=9000;assert.equal((await client.discover()).pid,42);assert.equal(scans,3);
});

test('authorization failures have a cooldown, then rediscover without disabling the plugin',async t=>{
 const {client,state}=await fixture(t);state.status=401;
 for(let i=0;i<10;i++)await assert.rejects(client.call('GetUserStatus'));
 assert.equal(state.scans,1);assert.equal(state.requests,1);
 state.now+=3000;state.status=200;
 assert.deepEqual(await client.call('GetUserStatus'),{});assert.equal(state.scans,2);
});

test('a refused old port rediscovers a restarted backend once, without toggling the plugin',async t=>{
 const {client,state,server}=await fixture(t);state.status=200;
 await client.call('GetUserStatus');assert.equal(state.scans,1);
 await stopServer(server);
 const replacement=createServer((req,res)=>{req.resume();res.end('{}');});
 await new Promise(r=>replacement.listen(0,'127.0.0.1',r));t.after(()=>stopServer(replacement));
 state.port=replacement.address().port;state.pid=43;state.now+=3000;
 assert.deepEqual(await client.call('GetUserStatus'),{});
 assert.equal(client.server.pid,43);assert.equal(state.scans,2);
});

test('endpointFromEnv accepts loopback HTTP addresses only and rejects unsafe values', () => {
 assert.deepEqual(endpointFromEnv({ ANTIGRAVITY_LS_ADDRESS: 'localhost:62465', ANTIGRAVITY_CSRF_TOKEN: 'tok-1' }), { port: 62465, csrf: 'tok-1' });
 assert.deepEqual(endpointFromEnv({ ANTIGRAVITY_LS_ADDRESS: 'http://127.0.0.1:8080', ANTIGRAVITY_CSRF_TOKEN: 'tok-2' }), { port: 8080, csrf: 'tok-2' });
 assert.deepEqual(endpointFromEnv({ ANTIGRAVITY_LS_ADDRESS: '[::1]:9000', ANTIGRAVITY_CSRF_TOKEN: 'tok-3' }), { host: '::1', port: 9000, csrf: 'tok-3' });
 assert.equal(endpointFromEnv({ ANTIGRAVITY_LS_ADDRESS: 'https://127.0.0.1:62464', ANTIGRAVITY_CSRF_TOKEN: 'tok' }), null);
 assert.equal(endpointFromEnv({ ANTIGRAVITY_LS_ADDRESS: '192.168.1.5:62465', ANTIGRAVITY_CSRF_TOKEN: 'tok' }), null);
 assert.equal(endpointFromEnv({ ANTIGRAVITY_LS_ADDRESS: 'evil.example:62465', ANTIGRAVITY_CSRF_TOKEN: 'tok' }), null);
 assert.equal(endpointFromEnv({ ANTIGRAVITY_LS_ADDRESS: 'localhost:0', ANTIGRAVITY_CSRF_TOKEN: 'tok' }), null);
 assert.equal(endpointFromEnv({ ANTIGRAVITY_LS_ADDRESS: 'localhost:70000', ANTIGRAVITY_CSRF_TOKEN: 'tok' }), null);
 assert.equal(endpointFromEnv({ ANTIGRAVITY_LS_ADDRESS: 'localhost:62465', ANTIGRAVITY_CSRF_TOKEN: 'bad\r\ntok' }), null);
 assert.equal(endpointFromEnv({ ANTIGRAVITY_LS_ADDRESS: 'localhost:62465' }), null);
});

test('2.34.0+ sidecar env credential pairs only with the live standalone process owning its port', async t => {
 let receivedCsrf = null;
 const srv = createServer((req, res) => {
  receivedCsrf = req.headers['x-codeium-csrf-token'];
  req.resume();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
 });
 await new Promise(r => srv.listen(0, '127.0.0.1', r));
 t.after(() => stopServer(srv));
 const port = srv.address().port;

 // 2.34.0+ hides --csrf_token from CLI argv; works even if language_server.log is missing
 const env = { ANTIGRAVITY_LS_ADDRESS: `localhost:${port}`, ANTIGRAVITY_CSRF_TOKEN: 'env-token-234' };
 const client = new AntigravityClient({
  now: () => 1000,
  env,
  paths: () => ({ logCandidates: ['missing.log'] }),
  readLog: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  processes: async () => [{ ProcessId: 77, CommandLine: '/app/language_server --standalone --override_ide_version 2.34.0 --enable_sidecars', Ports: [port, port - 1] }],
 });
 assert.deepEqual(await client.call('GetUserStatus'), { ok: true });
 assert.equal(receivedCsrf, 'env-token-234');
 assert.deepEqual(client.server, { port, csrf: 'env-token-234', pid: 77 });

 // Stale sidecar env port (LS restarted on a different port) must never mix generations
 assert.throws(
  () => serverFromDiscovery(
   `listening on random port at ${port + 1} for HTTP\n`,
   [{ ProcessId: 88, CommandLine: '/app/language_server --standalone --enable_sidecars', Ports: [port + 1] }],
   env,
  ),
  /已重启/,
 );

 // Multiple standalone instances must still fail closed even when env matches one
 assert.throws(
  () => serverFromDiscovery(
   `listening on random port at ${port} for HTTP\n`,
   [
    { ProcessId: 77, CommandLine: '/app/language_server --standalone', Ports: [port] },
    { ProcessId: 78, CommandLine: '/app/language_server --standalone', Ports: [port + 2] },
   ],
   env,
  ),
  /多个 Antigravity 实例/,
 );

 // Legacy <= 2.33.0 argv --csrf_token takes precedence over stale env token (both serverFromDiscovery and client.discover)
 assert.deepEqual(
  serverFromDiscovery(
   `listening on random port at ${port + 5} for HTTP\n`,
   [{ ProcessId: 90, CommandLine: '/app/language_server --standalone --csrf_token=fresh-cli', Ports: [port + 5] }],
   env,
  ),
  { port: port + 5, csrf: 'fresh-cli', pid: 90 },
 );
 const cliClient = new AntigravityClient({
  now: () => 2000,
  env,
  paths: () => ({ logCandidates: ['live.log'] }),
  readLog: async () => `listening on random port at ${port + 5} for HTTP\n`,
  processes: async () => [{ ProcessId: 90, CommandLine: '/app/language_server --standalone --csrf_token=fresh-cli', Ports: [port, port + 5] }],
 });
 assert.deepEqual(await cliClient.discover(), { port: port + 5, csrf: 'fresh-cli', pid: 90 });

 // Multiple standalone instances reject in discover() fast path too even when env matches one
 const multiClient = new AntigravityClient({
  now: () => 3000,
  env,
  paths: () => ({ logCandidates: ['live.log'] }),
  readLog: async () => `listening on random port at ${port} for HTTP\n`,
  processes: async () => [
   { ProcessId: 77, CommandLine: '/app/language_server --standalone', Ports: [port] },
   { ProcessId: 78, CommandLine: '/app/language_server --standalone', Ports: [port + 2] },
  ],
 });
 await assert.rejects(multiClient.discover(), /多个 Antigravity 实例/);

 // IPv6 [::1] env endpoint passes hostname '::1' end-to-end to http.request
 const originalReq = http.request;
 let seenOptions = null;
 http.request = (options, onResponse) => {
  seenOptions = options;
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.destroy = () => { req.emit('close'); return req; };
  req.end = () => queueMicrotask(() => {
   const res = new EventEmitter();
   res.statusCode = 200;
   res.setEncoding = () => res;
   onResponse(res);
   res.emit('data', '{"ipv6":true}');
   res.emit('end');
   req.emit('close');
  });
  return req;
 };
 syncBuiltinESMExports();
 t.after(() => { http.request = originalReq; syncBuiltinESMExports(); });
 const v6Client = new AntigravityClient({
  now: () => 4000,
  env: { ANTIGRAVITY_LS_ADDRESS: '[::1]:64001', ANTIGRAVITY_CSRF_TOKEN: 'v6-tok' },
  paths: () => ({ logCandidates: ['missing.log'] }),
  readLog: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  processes: async () => [{ ProcessId: 99, CommandLine: '/app/language_server --standalone', Ports: [64001] }],
 });
 assert.deepEqual(await v6Client.call('GetUserStatus'), { ipv6: true });
 assert.equal(seenOptions.hostname, '::1');
 assert.equal(seenOptions.port, 64001);
 assert.equal(seenOptions.headers['x-codeium-csrf-token'], 'v6-tok');
});
