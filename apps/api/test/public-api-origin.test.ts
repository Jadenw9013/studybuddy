import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadConfig} from '../src/config.ts';
import {buildServer} from '../src/server.ts';

const production={
 APP_MODE:'live',NODE_ENV:'production',WEB_ORIGIN:'https://study.example.test',
 DATABASE_URL:'postgresql://127.0.0.1:54322/synthetic_not_connected',
 SUPABASE_URL:'https://synthetic.example.test',SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable-key',
 SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-role-key',WS_TICKET_SECRET:'t'.repeat(32),INTERNAL_WORKER_SECRET:'w'.repeat(32),
};

test('public API origin selects a separate HTTPS relay without changing the authorized web origin',()=>{
 const config=loadConfig({...production,API_PUBLIC_ORIGIN:'https://relay.example.test:8443/'});
 assert.equal(config.apiOrigin,'https://relay.example.test:8443');
 assert.equal(config.origin,'https://study.example.test');
 assert.equal(config.devAuthBypass,false);
 assert.equal(loadConfig(production).apiOrigin,production.WEB_ORIGIN,'same-origin proxy deployment remains the default');
});

test('public API origin rejects credentials, paths, empty queries/fragments, invalid schemes and production HTTP',()=>{
 for(const value of ['https://user:secret@relay.example.test','https://relay.example.test/live','https://relay.example.test/..','https://relay.example.test?','https://relay.example.test#','https://relay.example.test?q=x','https://relay.example.test#fragment','wss://relay.example.test','ftp://relay.example.test','//relay.example.test','https://relay.example.test\\',' https://relay.example.test','https://relay.example.test\n']){
  assert.throws(()=>loadConfig({...production,API_PUBLIC_ORIGIN:value}),/API_PUBLIC_ORIGIN/);
 }
 assert.throws(()=>loadConfig({...production,API_PUBLIC_ORIGIN:'http://relay.example.test'}),/HTTPS in production/);
 assert.throws(()=>loadConfig({...production,API_PUBLIC_ORIGIN:'https://relay.example.test',DEV_AUTH_BYPASS:'true'}),/only available for local development/);
 assert.equal(loadConfig({APP_MODE:'fixture',API_PUBLIC_ORIGIN:'http://127.0.0.1:4101'}).apiOrigin,'http://127.0.0.1:4101','HTTP remains available for local development');
});

for(const target of [undefined,'https://relay.example.test:8443'] as const)test(`HTTP config and companion routing preserve cookie/CSRF authority with public origin=${target??'local fallback'}`,async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'tutor-public-origin-'));
 const webOrigin='http://localhost:3000';
 const config=loadConfig({APP_MODE:'fixture',WEB_ORIGIN:webOrigin,DATA_DIR:directory,API_PUBLIC_ORIGIN:target});
 const {app,store}=await buildServer(config);
 try{
  const publicConfig=await app.inject('/api/config');
  assert.equal(publicConfig.statusCode,200);
  assert.equal(publicConfig.json().apiOrigin,target??'http://localhost:3001');
  const login=await app.inject({method:'POST',url:'/api/auth/verify',headers:{origin:webOrigin},payload:{email:'public-origin@example.test',code:'246810',adult:true,consent:true}});
  assert.equal(login.statusCode,200);
  const setCookie=String(login.headers['set-cookie']);
  assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/SameSite=Strict/i);
  assert.doesNotMatch(setCookie,/;\s*Secure(?:;|$)/i,'cookie security is based on the HTTP web origin, not the HTTPS relay');
  const cookie=`tutor_session=${login.cookies[0].value}`;
  const call=(url:string,payload?:Record<string,unknown>)=>app.inject({method:'POST',url,headers:{origin:webOrigin,cookie},payload});
  const course=(await call('/api/courses',{name:'Synthetic public-origin course'})).json();
  const lesson=(await call('/api/lessons',{courseId:course.id})).json();
  const pair=await call(`/api/lessons/${lesson.id}/pair`,undefined);
  assert.equal(pair.statusCode,200);
  const companion=new URL(pair.json().url);
  assert.equal(companion.origin,target?'wss://relay.example.test:8443':'ws://localhost:3001');
  assert.equal(companion.pathname,'/companion');assert.equal(companion.searchParams.get('secret'),pair.json().secret);
  const denied=await app.inject({method:'POST',url:'/api/courses',headers:{origin:target??'http://localhost:3001',cookie},payload:{name:'Denied API-origin mutation'}});
  assert.equal(denied.statusCode,403);assert.equal(denied.json().code,'origin_denied');
  const deniedTicket=await app.inject({method:'POST',url:`/api/lessons/${lesson.id}/live-ticket`,headers:{origin:target??'http://localhost:3001',cookie}});
  assert.equal(deniedTicket.statusCode,403);
  assert.equal((await app.inject({method:'POST',url:`/api/lessons/${lesson.id}/pair`,headers:{origin:webOrigin}})).statusCode,401,'public relay configuration does not authorize pairing');
 }finally{
  await app.close();
  for(const owner of await store.owners())await store.transact(owner,()=>undefined);
  await rm(directory,{recursive:true,force:true});
 }
});
