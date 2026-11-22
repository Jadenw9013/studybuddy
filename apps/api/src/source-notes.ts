import type {FastifyInstance} from 'fastify';
import {createHash} from 'node:crypto';
import {canonical} from '../../../packages/contracts/index.ts';
import {course,fail,lesson,source,uid,readyLessonSources,type Store,type State,type Lesson,type NoteCitation,type SavedNote} from './store.ts';

const identifier={type:'string',minLength:1,maxLength:128};
const uuid={type:'string',pattern:'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'};
const revision={type:'integer',minimum:0};
const noteFields={title:{type:'string',minLength:1,maxLength:120},content:{type:'string',minLength:1,maxLength:20000}};
const citationSchema={type:'object',additionalProperties:false,required:['sourceId','versionId','passageId'],properties:{sourceId:identifier,versionId:identifier,passageId:identifier}};
function citations(state:State,l:Lesson,input:any[]):NoteCitation[]{
 return input.map(value=>{
  const head=source(state,value.sourceId);if(head.courseId!==l.courseId)fail('unauthorized','Choose a citation from this notebook.',403);
  const version=[head,...(head.previous??[])].find(v=>v.versionId===value.versionId),passage=version?.passages.find(p=>p.id===value.passageId);
  if(!passage)fail('insufficient_evidence','That cited source location is unavailable.',404);
  return{sourceId:head.id,versionId:version!.versionId,passageId:passage.id,locator:structuredClone(passage.locator)};
 });
}
function touched(state:State,l:Lesson){const now=new Date().toISOString();l.updatedAt=now;course(state,l.courseId).updatedAt=now;return now;}
export function sourceSelection(state:State,l:Lesson){return{selectedSourceIds:l.selectedSourceIds??null,selectedSources:readyLessonSources(state,l).map(src=>src.id),revision:l.sourceSelectionRevision??0,epoch:l.epoch};}
export function registerSourceNotes(app:FastifyInstance,deps:{store:Store;auth:(req:any)=>Promise<{owner:string}>;onScopeChanged?:(owner:string,lessonId:string)=>void}){
 const {store,auth}=deps;
 app.get<{Params:{id:string}}>('/api/lessons/:id/sources',async req=>{const actor=await auth(req);return store.transact(actor.owner,state=>sourceSelection(state,lesson(state,req.params.id)));});
 app.patch<{Params:{id:string};Body:{sourceIds:string[]|null;expectedRevision:number}}>('/api/lessons/:id/sources',{schema:{body:{type:'object',additionalProperties:false,required:['sourceIds','expectedRevision'],properties:{sourceIds:{anyOf:[{type:'null'},{type:'array',maxItems:25,uniqueItems:true,items:identifier}]},expectedRevision:revision}}}},async req=>{
  const actor=await auth(req);const result=await store.transact(actor.owner,state=>{
   const l=lesson(state,req.params.id);if((l.sourceSelectionRevision??0)!==req.body.expectedRevision)fail('stale_revision','Your source selection changed. Refresh before updating it.');
   if(req.body.sourceIds!==null){
    for(const id of req.body.sourceIds){const head=source(state,id);if(head.courseId!==l.courseId)fail('unauthorized','Choose a source from this notebook.',403);if(![head,...(head.previous??[])].some(v=>v.status.startsWith('ready')))fail('source_not_ready','Wait until this source is ready before selecting it.');}
   }
   const selected=req.body.sourceIds===null?undefined:[...req.body.sourceIds].sort();
   if(canonical(selected??null)===canonical(l.selectedSourceIds===undefined?null:[...l.selectedSourceIds].sort()))return{...sourceSelection(state,l),changed:false};
   l.selectedSourceIds=selected;l.sourceSelectionRevision=(l.sourceSelectionRevision??0)+1;l.sourceSelectionMessageOffset=l.messages.length;l.epoch++;touched(state,l);
   return{...sourceSelection(state,l),changed:true};
  });if(result.changed)deps.onScopeChanged?.(actor.owner,req.params.id);return result;
 });
 app.get<{Params:{id:string}}>('/api/lessons/:id/notes',async req=>{const actor=await auth(req);return store.transact(actor.owner,state=>({notes:(lesson(state,req.params.id).notes??[]).filter(note=>!note.deleted).map(({creationFingerprint,...note})=>note)}));});
 app.post<{Params:{id:string};Body:{title?:string;content?:string;fromMessageId?:string;citations?:{sourceId:string;versionId:string;passageId:string}[];clientNoteId?:string}}>('/api/lessons/:id/notes',{schema:{body:{type:'object',additionalProperties:false,properties:{...noteFields,fromMessageId:identifier,clientNoteId:uuid,citations:{type:'array',maxItems:25,items:citationSchema}}}}},async req=>{
  const actor=await auth(req);return store.transact(actor.owner,state=>{
   const l=lesson(state,req.params.id),body=req.body;
   let content=body.content,title=body.title,refs=body.citations??[];
   if(body.fromMessageId){
    if(body.content!==undefined||body.citations!==undefined)fail('invalid_params','Save the confirmed response directly, then edit your saved note.',400);
    const message=l.messages.find(m=>m.id===body.fromMessageId&&m.role==='tutor'&&(!m.status||m.status==='complete'));
    if(!message||typeof message.text!=='string'||!message.text.trim())fail('not_found','That completed tutor response is unavailable.',404);
    const confirmedText:string=message.text;content=confirmedText;title??=confirmedText.split('\n').find(line=>line.trim())?.replace(/^#+\s*/,'').slice(0,120)||'Saved tutor response';refs=message.citations??[];
   }
   if(typeof content!=='string'||!content.trim()||content.length>20000||typeof title!=='string'||!title.trim()||title.length>120)fail('invalid_params','Use a note title and content of at most 20,000 characters.',400);
   if(refs.length>25)fail('invalid_params','Save at most 25 exact citations in one note.',400);
   const resolved=citations(state,l,refs),fingerprint=createHash('sha256').update(canonical({title:title.trim(),content,citations:resolved,fromMessageId:body.fromMessageId??null})).digest('hex');
   const id=body.clientNoteId??uid();const existing=state.lessons.flatMap(item=>(item.notes??[]).map(note=>({lessonId:item.id,note}))).find(item=>item.note.id===id);
   if(existing){if(existing.lessonId!==l.id||existing.note.deleted||existing.note.creationFingerprint!==fingerprint)fail('payload_conflict','This note ID already identifies a different saved note.');const {creationFingerprint,...note}=existing.note;return note;}
   if((l.notes??[]).filter(note=>!note.deleted).length>=200)fail('quota_exhausted','This notebook has 200 saved notes.',429);
   const now=touched(state,l),note:SavedNote={id,title:title.trim(),content,revision:1,citations:resolved,createdAt:now,updatedAt:now,creationFingerprint:fingerprint,...(body.fromMessageId?{fromMessageId:body.fromMessageId}:{})};
   (l.notes??=[]).push(note);const {creationFingerprint,...visible}=note;return visible;
  });
 });
 app.patch<{Params:{id:string;noteId:string};Body:{expectedRevision:number;title?:string;content?:string}}>('/api/lessons/:id/notes/:noteId',{schema:{body:{type:'object',additionalProperties:false,required:['expectedRevision'],properties:{...noteFields,expectedRevision:revision}}}},async req=>{
  const actor=await auth(req);return store.transact(actor.owner,state=>{
   const l=lesson(state,req.params.id),note=l.notes?.find(note=>note.id===req.params.noteId&&!note.deleted);if(!note)fail('not_found','This saved note is unavailable.',404);
   if(note.revision!==req.body.expectedRevision)fail('stale_revision','This note changed. Refresh before saving it.');
   if(req.body.title===undefined&&req.body.content===undefined||req.body.title!==undefined&&!req.body.title.trim()||req.body.content!==undefined&&!req.body.content.trim())fail('invalid_params','Enter a note title or content to save.',400);
   if(req.body.title!==undefined)note.title=req.body.title.trim();if(req.body.content!==undefined)note.content=req.body.content;
   note.revision++;note.updatedAt=touched(state,l);const{creationFingerprint,...visible}=note;return visible;
  });
 });
 app.delete<{Params:{id:string;noteId:string};Body:{expectedRevision:number}}>('/api/lessons/:id/notes/:noteId',{schema:{body:{type:'object',additionalProperties:false,required:['expectedRevision'],properties:{expectedRevision:revision}}}},async req=>{
  const actor=await auth(req);return store.transact(actor.owner,state=>{
   const l=lesson(state,req.params.id),note=l.notes?.find(note=>note.id===req.params.noteId&&!note.deleted);if(!note)fail('not_found','This saved note is unavailable.',404);
   if(note.revision!==req.body.expectedRevision)fail('stale_revision','This note changed. Refresh before removing it.');
   note.deleted=true;note.title='';note.content='';note.citations=[];note.fromMessageId=undefined;note.revision++;note.updatedAt=touched(state,l);return{id:note.id,deleted:true,revision:note.revision};
  });
 });
}
