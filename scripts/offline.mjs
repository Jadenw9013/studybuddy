import{spawnSync}from'node:child_process';
const r=spawnSync(process.execPath,['scripts/test.mjs'],{stdio:'inherit',windowsHide:true});if(r.status!==0)process.exit(r.status??1);console.log('Offline fixture checks passed. Real database, provider, capture, Jupyter host and human evidence are reported separately.');
