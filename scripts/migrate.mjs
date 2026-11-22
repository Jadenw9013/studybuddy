import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import "dotenv/config";
import {tsImport} from 'tsx/esm/api';
if (!process.env.DATABASE_URL)
  throw Error("Set DATABASE_URL to your private local/staging database.");
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await p.query(
    "create table if not exists public.tutor_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  for (const name of (await readdir("supabase/migrations")).sort()) {
    if (!name.endsWith(".sql")) continue;
    const c = await p.connect();
    try {
      await c.query("begin");
      const done = await c.query(
        "select 1 from public.tutor_migrations where name=$1",
        [name],
      );
      if (!done.rowCount) {
        const tracked = await c.query("select to_regclass('supabase_migrations.schema_migrations') as table_name");
        const prior = tracked.rows[0].table_name
          ? await c.query("select 1 from supabase_migrations.schema_migrations where version=$1", [name.split('_')[0]])
          : {rowCount:0};
        if (!prior.rowCount) await c.query(await readFile("supabase/migrations/" + name, "utf8"));
        await c.query("insert into public.tutor_migrations(name) values($1)", [
          name,
        ]);
        console.log((prior.rowCount ? "Already applied by Supabase: " : "Applied ") + name);
      }
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    } finally {
      c.release();
    }
  }
  const {projectState}=await tsImport('../apps/api/src/projector.ts',import.meta.url);
  const owners=await p.query('select owner_id from public.learner_state');
  for(const {owner_id}of owners.rows){const c=await p.connect();try{await c.query('begin');await c.query('set local role tutor_api');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[owner_id]);const state=await c.query('select state from public.learner_state where owner_id=$1 for update',[owner_id]);await projectState(c,owner_id,state.rows[0].state);await c.query('commit');}catch(e){await c.query('rollback');throw e;}finally{c.release();}}
  await p.query('alter table public.retrieval_passages validate constraint retrieval_passages_version_fk');
  console.log('Domain backfill and citation foreign key validation complete.');
} finally {
  await p.end();
}
