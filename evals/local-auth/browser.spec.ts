import {test,expect} from '@playwright/test';
import path from 'node:path';
test('local workspace opens with no sign-in and ordinary uploads and chart survive reload',async({page})=>{
 await page.context().clearCookies();await page.goto('/');
 await expect(page.getByRole('button',{name:'Bring an assignment',exact:true})).toBeVisible();
 await expect(page.getByText('Local test mode · sign-in skipped.',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Email',{exact:true})).toHaveCount(0);
 expect((await page.context().cookies()).some(c=>c.name==='tutor_session')).toBe(false);
 await page.getByRole('button',{name:'Bring an assignment',exact:true}).click();
 const courseId=page.url().split('/courses/')[1];
 try{
  await page.getByLabel('Upload course files').setInputFiles(['lecture.pdf','scores.csv','attempt.ipynb'].map(f=>path.resolve('fixtures',f)));
  await expect(page.locator('#main').getByText('Ready · version 1',{exact:true})).toHaveCount(3,{timeout:30000});
  await page.getByRole('button',{name:'Open lesson',exact:true}).click();
  await page.getByText('Create a verified visual',{exact:true}).click();await page.getByRole('button',{name:'Create histogram',exact:true}).click();
  await expect(page.getByTestId('chart-summary')).toContainText('4 intervals');
  await page.reload();await expect(page.getByTestId('chart-summary')).toContainText('4 intervals');
  await expect(page.getByText('Local test mode · sign-in skipped.',{exact:true})).toBeVisible();
  await page.getByRole('region',{name:'Optional illustrations'}).locator('summary').click();
  await expect(page.getByRole('button',{name:/Generate illustration/})).toBeEnabled();
  expect((await page.context().cookies()).some(c=>c.name==='tutor_session')).toBe(false);
  await page.screenshot({path:'evals/results/local-test-workspace.png',fullPage:true});
 }finally{if(courseId)await page.request.delete(`/api/courses/${courseId}`,{headers:{Origin:'http://localhost:3000'}});}
});
