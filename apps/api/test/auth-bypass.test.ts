import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildServer} from '../src/server.ts';
import {loadConfig} from '../src/config.ts';
const origin='http://localhost:3000';
test('local test workspace opens without cookies and keeps one owner across reloads',async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'tutor-local-auth-'));
 const {app}=await buildServer(loadConfig({APP_MODE:'fixture',NODE_ENV:'test',DEV_AUTH_BYPASS:'true',WEB_ORIGIN:origin,DATA_DIR:dataDir}));
 try{
  const me=await app.inject('/api/me');assert.equal(me.statusCode,200);assert.equal(me.json().authentication,'local_test');
  const made=await app.inject({method:'POST',url:'/api/courses',headers:{origin},payload:{name:'My local assignment'}});assert.equal(made.statusCode,200);
  assert.ok((await app.inject('/api/me')).json().courses.some((c:any)=>c.id===made.json().id));
  const staleCookie=await app.inject({url:'/api/me',headers:{cookie:'tutor_session=old-invalid-cookie'}});assert.equal(staleCookie.statusCode,200);assert.ok(staleCookie.json().courses.some((c:any)=>c.id===made.json().id));
  const logout=await app.inject({method:'POST',url:'/api/auth/logout',headers:{origin}});assert.equal(logout.statusCode,200);assert.equal(logout.json().localTesting,true);
  assert.equal((await app.inject('/api/me')).statusCode,200);
 }finally{await app.close();await rm(dataDir,{recursive:true,force:true});}
});
test('local bypass still rejects nonlocal clients and cross-origin mutations',async()=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'tutor-local-auth-'));
 const {app}=await buildServer(loadConfig({APP_MODE:'fixture',NODE_ENV:'test',DEV_AUTH_BYPASS:'true',WEB_ORIGIN:origin,DATA_DIR:dataDir}));
 try{
  assert.equal((await app.inject({url:'/api/me',remoteAddress:'203.0.113.9'})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url:'/api/courses',headers:{origin:'https://unrelated.example'},payload:{name:'No'}})).statusCode,403);
 }finally{await app.close();await rm(dataDir,{recursive:true,force:true});}
});
test('sign-in bypass is opt-in and rejected in production, remote origins and public binds',async()=>{
 for(const env of [{NODE_ENV:'production'},{WEB_ORIGIN:'http://remote.example'},{API_HOST:'0.0.0.0'}])assert.throws(()=>loadConfig({APP_MODE:'fixture',NODE_ENV:'development',DEV_AUTH_BYPASS:'true',...env}),/only available/);
 assert.throws(()=>loadConfig({APP_MODE:'live',NODE_ENV:'development',DEV_AUTH_BYPASS:'true',SUPABASE_URL:'http://127.0.0.1:54321',DATABASE_URL:'postgresql://127.0.0.1:54322/postgres'}),/DEV_AUTH_USER_ID/);
 const dataDir=await mkdtemp(path.join(tmpdir(),'tutor-normal-auth-'));
 const {app}=await buildServer(loadConfig({APP_MODE:'fixture',DATA_DIR:dataDir}));
 try{assert.equal((await app.inject('/api/me')).statusCode,401);}finally{await app.close();await rm(dataDir,{recursive:true,force:true});}
});
