// This entry point cannot fall back to a production Firebase project.
const {spawnSync}=require('node:child_process');
if(process.env.GCLOUD_PROJECT!=='demo-work-manager'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Expected loopback demo-work-manager emulator; refusing to run');
const args=process.env.PHASE6D_SCOPE==='full'?[]:['--atomicity-only'];
const child=spawnSync(process.execPath,['tests/run.cjs',...args],{stdio:'inherit'});process.exitCode=child.status??1;
