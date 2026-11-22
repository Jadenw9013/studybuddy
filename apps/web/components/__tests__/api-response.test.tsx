import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchApiResponse,readApiJson,parseApiStreamEvent,serviceUnavailableMessage} from '../api-response';

test('proxy HTML, plain text and malformed JSON show service unavailability instead of raw parse errors',async()=>{
 for(const response of [
  new Response('The page could not be found',{status:404}),
  new Response('<html>upstream unavailable</html>',{status:502,headers:{'content-type':'text/html'}}),
  new Response('<html>wrong route</html>',{status:200,headers:{'content-type':'text/html'}}),
  new Response('{invalid',{status:503,headers:{'content-type':'application/json'}}),
  new Response('null',{status:200,headers:{'content-type':'application/json'}}),
 ])await assert.rejects(readApiJson(response),error=>error instanceof Error&&error.message===serviceUnavailableMessage);
});

test('valid API data and explicit backend error messages remain intact',async()=>{
 const config={mode:'live',authentication:'required',liveAvailable:false};
 assert.deepEqual(await readApiJson(Response.json(config)),config);
 assert.deepEqual(await readApiJson(Response.json([{id:'synthetic-note'}])),[{id:'synthetic-note'}]);
 await assert.rejects(readApiJson(Response.json({code:'unauthorized',message:'Sign in again to continue.'},{status:401})),{message:'Sign in again to continue.'});
 await assert.rejects(readApiJson(Response.json({code:'invalid_params'},{status:400}),'Check this note.'),{message:'Check this note.'});
});

test('network failures use a human message while intentional cancellation stays an AbortError',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async()=>{throw new TypeError('Failed to fetch private-proxy-address');};
 await assert.rejects(fetchApiResponse('/api/config'),{message:serviceUnavailableMessage});
 const aborted=new DOMException('Cancelled by navigation','AbortError');
 globalThis.fetch=async()=>{throw aborted;};
 await assert.rejects(fetchApiResponse('/api/config'),error=>error===aborted);
 await assert.rejects(readApiJson({ok:true,json:async()=>{throw aborted;}}),error=>error===aborted);
});

test('stream parsing rejects proxy text but preserves valid progress and explicit error events',()=>{
 assert.throws(()=>parseApiStreamEvent('The page could not be found'),{message:serviceUnavailableMessage});
 assert.throws(()=>parseApiStreamEvent('null'),{message:serviceUnavailableMessage});
 assert.deepEqual(parseApiStreamEvent('{"type":"progress","stage":"Checking sources"}'),{type:'progress',stage:'Checking sources'});
 assert.deepEqual(parseApiStreamEvent('{"type":"error","message":"Select an available source."}'),{type:'error',message:'Select an available source.'});
});
