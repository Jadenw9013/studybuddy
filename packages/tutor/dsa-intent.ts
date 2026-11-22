import {DomainError} from '../contracts/index.ts';
import type {DsaAlgorithm} from '../board/dsa.ts';

export type DsaStepIntent={
 kind:'next'|'previous'|'restart';currentStepIndex:number;stepCount:number;expectedStepIndex:number;
 sourceId:string;sourceVersionId?:string;algorithm:DsaAlgorithm;targetValue?:number;
 proposal:{type:'board.patch';args:{stepIndex:number}};
};
const actions:{kind:DsaStepIntent['kind'];pattern:string}[]=[
 {kind:'next',pattern:'(?:next(?: step)?|(?:go|move) to (?:the )?next step|show(?: me)? (?:the )?next step|advance(?: by)? (?:one|1) step)'},
 {kind:'previous',pattern:'(?:previous(?: step)?|(?:go|move) to (?:the )?previous step|show(?: me)? (?:the )?previous step|(?:go |move )?back (?:one|1) step)'},
 {kind:'restart',pattern:'(?:restart(?:(?: the| this)? (?:traversal|search))?|start over|restart from (?:the )?beginning|go back to (?:the )?beginning)'},
];
const narration='(?:(?:say|give)(?: me)? (?:one|a) (?:(?:very )?brief|short) sentence(?: about (?:this|the current|the displayed) (?:step|comparison))?|explain (?:this|the current|the displayed) (?:step|comparison) (?:briefly|in one (?:brief|short) sentence)|show only that step and say one short sentence)';
const patterns=actions.map(({kind,pattern})=>({kind,regex:new RegExp('^(?:please )?'+pattern+'(?: (?:only|please))*(?:[.!?;]? (?:please )?'+narration+'(?: please)?)?[.!?]*$')}));
function navigation(question:unknown){
 if(typeof question!=='string'||question.length>500)return undefined;
 const clean=question.normalize('NFKC').toLowerCase().replace(/,/g,' ').replace(/\s+/g,' ').trim();
 return patterns.find(({regex})=>regex.test(clean))?.kind;
}
/** Intentionally narrow whole-message grammar. This helper never examines the
 * original lesson goal, history, source text, or model output. Any additional
 * source/algorithm/target request falls through to normal typed validation.
 * Only confirmed board metadata determines the next legal step; no traversal
 * order or future comparison is inferred from language or generated code. */
export function dsaStepIntent(question:unknown,board:unknown):DsaStepIntent|undefined{
 const kind=navigation(question),b=board as any;
 if(!kind||!b||b.kind!=='dsa')return undefined;
 const result=b.result,current=result?.stepIndex??b.stepIndex,stepCount=result?.stepCount??(Array.isArray(result?.steps)?result.steps.length:undefined),algorithm=b.algorithm??result?.algorithm;
 const invalid=()=>{throw new DomainError('invalid_state','The confirmed DSA step is unavailable. Reopen the saved visual before advancing it.',409);};
 if(typeof b.sourceId!=='string'||!b.sourceId||b.sourceId.length>128||!['bfs','dfs','inorder','preorder','postorder','search'].includes(algorithm)||!Number.isSafeInteger(current)||!Number.isSafeInteger(stepCount)||stepCount<1||stepCount>129||current<0||current>=stepCount)invalid();
 if(b.stepIndex!==undefined&&b.stepIndex!==current||b.algorithm!==undefined&&result?.algorithm!==undefined&&b.algorithm!==result.algorithm||Array.isArray(result?.steps)&&result.stepCount!==undefined&&result.steps.length!==result.stepCount)invalid();
 const targetValue=b.targetValue??result?.targetValue;
 if(algorithm==='search'&&(typeof targetValue!=='number'||!Number.isFinite(targetValue)||Math.abs(targetValue)>1e6))invalid();
 const expectedStepIndex=kind==='restart'?0:Math.max(0,Math.min(stepCount-1,current+(kind==='next'?1:-1)));
 return{kind,currentStepIndex:current,stepCount,expectedStepIndex,sourceId:b.sourceId,...(typeof b.sourceVersionId==='string'?{sourceVersionId:b.sourceVersionId}:{}),algorithm,...(typeof targetValue==='number'?{targetValue}:{}),proposal:{type:'board.patch',args:{stepIndex:expectedStepIndex}}};
}
