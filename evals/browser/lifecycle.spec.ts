import {test,expect,type Page} from '@playwright/test';
import {loginFixture,includedLesson,createHistogram,askFixture,openWorkspace,lessonId,snapshot} from './fixture-helpers';
async function readyLesson(page:Page){await loginFixture(page,'lifecycle');await includedLesson(page);await createHistogram(page);await askFixture(page,'Explain my histogram directly');}
test('fixture two tabs lose new source reads after delete while independent attempt survives',async({page,context})=>{
 await readyLesson(page);const practice=await openWorkspace(page,'Practice');await practice.getByRole('button',{name:'Start independent practice',exact:true}).click();await practice.getByLabel('Your answer and reasoning').fill('0.2 relative frequency and 0.04 per score unit; area gives probability.');await practice.getByRole('button',{name:'Record my attempt',exact:true}).click();await expect(practice.getByText(/Independent response recorded/)).toBeVisible();
 const saved=await snapshot(page),csv=saved.sources.find((source:any)=>source.name==='scores.csv'),content='/api/sources/'+csv.id+'/versions/'+csv.versionId+'/content';
 const other=await context.newPage();await other.goto(page.url());await expect(other.getByTestId('chart-summary')).toBeVisible();expect((await other.request.get(content,{headers:{Range:'bytes=0-12'}})).status()).toBe(206);
 await page.getByRole('button',{name:'Sources (3)',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete scores.csv',exact:true}).click();await expect(page.getByRole('dialog',{name:'Course sources'}).getByText('scores.csv',{exact:true})).toHaveCount(0);
 expect((await other.request.get(content,{headers:{Range:'bytes=0-12'}})).status()).toBe(404);await other.reload();await expect.poll(async()=>(await snapshot(other)).lesson.board??null).toBe(null);
 await other.getByRole('button',{name:'Recap',exact:true}).click();await expect(other.getByRole('heading',{name:/Independent first response/})).toBeVisible();await other.close();
});
test('fixture keyboard opens exact citation and Escape restores focus to its button',async({page})=>{
 await readyLesson(page);const cite=page.getByRole('button',{name:/physical page 2/}).first();await cite.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog').filter({has:page.getByRole('button',{name:'Return to problem',exact:true})})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Return to problem',exact:true})).not.toBeVisible();await expect(cite).toBeFocused();
});
