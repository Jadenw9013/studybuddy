import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const localPython=fileURLToPath(new URL(process.platform==='win32'?'../.venv/Scripts/python.exe':'../.venv/bin/python',import.meta.url));
const python=process.env.JUPYTER_PYTHON||(existsSync(localPython)?localPython:'python');
const core=spawnSync(python,['-c','import pathlib,jupyterlab; print(pathlib.Path(jupyterlab.__file__).parent / "staging")'],{encoding:'utf8'});
if(core.status!==0)throw new Error('Install JupyterLab 4 in your active Python environment, or set JUPYTER_PYTHON to that environment.');
const result=spawnSync(process.execPath,['node_modules/@jupyterlab/builder/lib/build-labextension.js','--core-path',core.stdout.trim(),'.'],{stdio:'inherit',cwd:fileURLToPath(new URL('../',import.meta.url))});
process.exitCode=result.status??1;
