import 'dotenv/config';
import {loadConfig} from '../apps/api/src/config.ts';
import {Store} from '../apps/api/src/store.ts';
const config=loadConfig();
if(!config.devAuthBypass||config.mode!=='live'||process.env.NODE_ENV==='production')throw Error('This allowance is only for the configured loopback development profile.');
const allowanceId='local-workflow-testing-2026-11-20';
const seconds=30*60;
const store=new Store(config);
try{
 const result=await store.transact(process.env.DEV_AUTH_USER_ID,s=>{
  if(s.deleted)throw Error('The local profile is deleted.');
  s.developmentAllowances??={};
  const alreadyGranted=Boolean(s.developmentAllowances[allowanceId]);
  if(!alreadyGranted){s.remainingSeconds+=seconds;s.developmentAllowances[allowanceId]={seconds,createdAt:new Date().toISOString()};}
  return{kind:'local-development-allowance',alreadyGranted,grantedSeconds:alreadyGranted?0:seconds,remainingSeconds:s.remainingSeconds,providerCostControls:'unchanged',purchaseCreated:false};
 });
 console.log(JSON.stringify(result));
}finally{await store.close();}
