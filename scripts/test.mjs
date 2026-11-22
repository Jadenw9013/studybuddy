import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const python=process.env.PYTHON_PATH||(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
const suites=[
 [process.execPath,['node_modules/tsx/dist/cli.mjs','--test','packages/**/*.test.ts','apps/api/test/*.test.ts','evals/live/*.test.ts','apps/web/components/__tests__/*.test.tsx']],
 [process.execPath,['--test','evals/live/summarize.test.mjs']],
 [process.execPath,['--test','extensions/jupyterlab/test/core.test.mjs']],
 [python,['apps/worker/test_parser.py']],
 [python,['apps/worker/test_embeddings.py']],
];
if(!existsSync(python))throw Error('Run pnpm run setup to prepare the locked Python environment.');
for(const[command,args]of suites){const result=spawnSync(command,args,{stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status??1);}
