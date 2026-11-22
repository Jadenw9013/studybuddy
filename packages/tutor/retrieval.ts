import type {PoolClient} from 'pg';

export const EMBEDDING_MODEL = 'BAAI/bge-small-en-v1.5';
export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_REVISION = '5c38ec7c405ec4b44b94cc5a9bb96e735b38267a';
export const RRF_K = 60;
/** Natural questions need a ranked union of terms, not an all-words conjunction. */
export function lexicalQuery(query:string):string{
  return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[])
    .filter(term=>term.length<=64&&!['or','and','not'].includes(term)))].slice(0,48).join(' OR ');
}
export interface RetrievedPassage {
  id: string; passageId: string; sourceId: string; versionId: string;
  text: string; locator: Record<string, unknown>; score: number;
}
export interface IndexedPassage {
  id: string; text: string; locator: Record<string, unknown>;
  embedding?: number[]; embeddingRevision?: string;
}
export function vectorLiteral(values: readonly number[]): string {
  if(values.length!==EMBEDDING_DIMENSIONS || values.some(x=>!Number.isFinite(x)||Math.abs(x)>1e6))
    throw new Error('Expected a finite 384-dimensional embedding.');
  if(!values.some(x=>x!==0)) throw new Error('A zero embedding has no cosine direction.');
  return `[${values.join(',')}]`;
}

/** Ranks are one-based; a passage appearing in both lists receives both votes. */
export function fuseRankings(lexical: readonly string[], semantic: readonly string[], limit=4): {id:string;score:number}[] {
  const scores=new Map<string,number>();
  for(const list of [lexical,semantic]){
    const seen=new Set<string>();
    list.slice(0,10).forEach((id,index)=>{if(!seen.has(id)){seen.add(id);scores.set(id,(scores.get(id)??0)+1/(RRF_K+index+1));}});
  }
  return [...scores].map(([id,score])=>({id,score})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
}

/** Call inside the same transaction as source-version and lease publication. */
export async function indexPassages(client:PoolClient,input:{ownerId:string;courseId:string;sourceId:string;versionId:string;passages:IndexedPassage[]}){
  if(input.passages.length>2000)throw new Error('Passage cap exceeded.');
  await client.query('delete from public.retrieval_passages where owner_id=$1 and source_id=$2 and version_id=$3',[input.ownerId,input.sourceId,input.versionId]);
  for(const p of input.passages){
    if(!p.text||p.text.length>12000||!p.locator||typeof p.locator!=='object'||Array.isArray(p.locator))throw new Error('Invalid indexed passage.');
    const vector=p.embedding?vectorLiteral(p.embedding):null;
    if(vector&&!p.embeddingRevision)throw new Error('Embedding revision must be pinned.');
    await client.query(`insert into public.retrieval_passages(owner_id,course_id,source_id,version_id,passage_id,exact_text,locator,embedding,embedding_revision)
      values($1,$2,$3,$4,$5,$6,$7,$8::extensions.vector,$9)`,[input.ownerId,input.courseId,input.sourceId,input.versionId,p.id,p.text,p.locator,vector,p.embeddingRevision??null]);
  }
}
export async function invalidateSource(client:PoolClient,ownerId:string,sourceId:string){
  await client.query('delete from public.retrieval_passages where owner_id=$1 and source_id=$2',[ownerId,sourceId]);
}
export async function invalidateCourse(client:PoolClient,ownerId:string,courseId:string){
  await client.query('delete from public.retrieval_passages where owner_id=$1 and course_id=$2',[ownerId,courseId]);
}

/**
 * Caller supplies allowed current versions from its locked authorized lesson.
 * Even the same learner's other course and an old source revision are excluded
 * before ranking. RLS independently constrains the transaction's auth subject.
 */
export async function retrieve(client:PoolClient,ownerId:string,courseId:string,allowedVersionIds:readonly string[],query:string,queryEmbedding?:readonly number[]):Promise<RetrievedPassage[]>{
  if(!allowedVersionIds.length||!query.trim())return[];
  if(query.length>4000||allowedVersionIds.length>500)throw new Error('Retrieval request exceeds the pilot limit.');
  const params=[ownerId,courseId,[...new Set(allowedVersionIds)],lexicalQuery(query)];
  const lexical=await client.query(`select passage_id, source_id, version_id, exact_text, locator,
      ts_rank_cd(search,websearch_to_tsquery('english',$4)) as relevance
    from public.retrieval_passages
    where owner_id=$1 and course_id=$2 and version_id=any($3::uuid[])
      and search @@ websearch_to_tsquery('english',$4)
    order by relevance desc, passage_id limit 10`,params);
  const semantic=queryEmbedding?await client.query(`select passage_id, source_id, version_id, exact_text, locator
    from public.retrieval_passages
    where owner_id=$1 and course_id=$2 and version_id=any($3::uuid[]) and embedding is not null and embedding_revision=$5
    order by embedding OPERATOR(extensions.<=>) $4::extensions.vector, passage_id limit 10`,[ownerId,courseId,params[2],vectorLiteral(queryEmbedding),EMBEDDING_REVISION]):{rows:[]};
  const byId=new Map([...lexical.rows,...semantic.rows].map(row=>[String(row.passage_id),row]));
  return fuseRankings(lexical.rows.map(row=>String(row.passage_id)),semantic.rows.map(row=>String(row.passage_id))).map(({id,score})=>{
    const row=byId.get(id)!;
    return{id,passageId:id,sourceId:String(row.source_id),versionId:String(row.version_id),text:row.exact_text,locator:row.locator,score};
  });
}
