import {defineConfig} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const directory=path.resolve('evals/live/results');mkdirSync(directory,{recursive:true});
const wav=Buffer.alloc(44+16000*2*90);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const audio=path.join(directory,'synthetic-dsa-voice-silence.wav');writeFileSync(audio,wav);
/** Paid opt-in against an already-running local live app, never ordinary CI. */
export default defineConfig({
  testDir:'.',testMatch:'dsa-voice.spec.ts',workers:1,retries:0,timeout:150_000,
  reporter:[['list']],outputDir:'../../.data/dsa-voice-test',
  use:{baseURL:'http://localhost:3000',browserName:'chromium',permissions:['microphone'],trace:'off',screenshot:'off',
    launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${audio}`]}},
});
