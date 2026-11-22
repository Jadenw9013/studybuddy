import {readFile} from 'node:fs/promises';
import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres',max:1,connectionTimeoutMillis:5000});
try{
 await pool.query(await readFile(new URL('./rls.sql',import.meta.url),'utf8'));
 console.log('PASS real Postgres owner RLS, course/version-scoped FTS/vector queries, and browser table-privilege denials. Synthetic rows rolled back.');
 await pool.query(await readFile(new URL('./domain.sql',import.meta.url),'utf8'));
 console.log('PASS real Postgres normalized domain constraints: owner/course/citation joins, immutable attempts and actions, grant revocation, private role privileges, and source/account purge. Synthetic rows rolled back.');
 await pool.query(await readFile(new URL('./illustrations.sql',import.meta.url),'utf8'));
 console.log('PASS real Postgres illustration RLS, scope, lifecycle and private-storage metadata constraints. Synthetic rows rolled back.');
 await pool.query(await readFile(new URL('./vectors.sql',import.meta.url),'utf8'));
 console.log('PASS real Postgres source-less vector persistence and unsupported visual-kind denial. Synthetic rows rolled back.');
 await pool.query(await readFile(new URL('./dsa.sql',import.meta.url),'utf8'));
 console.log('PASS real Postgres DSA board metadata persistence, required source provenance, source-version FK, and owner RLS. Synthetic rows rolled back.');
 await pool.query(await readFile(new URL('./notebook-sources-notes.sql',import.meta.url),'utf8'));
 console.log('PASS real Postgres notebook all/empty source scopes, course-scoped source/note identities, note redaction/revisions, owner RLS and account purge. Synthetic rows rolled back.');
 await pool.query(await readFile(new URL('./studio.sql',import.meta.url),'utf8'));
 console.log('PASS real Postgres Studio lifecycle/source-version constraints, request identity immutability, owner RLS, lesson purge and account metadata purge. Synthetic rows rolled back.');
}finally{await pool.end();}
