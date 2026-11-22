import{mkdir,writeFile}from'node:fs/promises';import{actionSchema}from'../packages/contracts/index.ts';
await mkdir('packages/contracts/schemas',{recursive:true});await writeFile('packages/contracts/schemas/action.v1.json',JSON.stringify(actionSchema,null,2)+'\n');
