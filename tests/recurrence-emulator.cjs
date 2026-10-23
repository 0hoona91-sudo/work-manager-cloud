// Test-only Firebase SDK bootstrap. NEVER imported by the production site.
const PROJECT='demo-work-manager';
async function withEmulator(EnvironmentUnavailable,run){
  const host=process.env.FIRESTORE_EMULATOR_HOST;
  if(!host)throw new EnvironmentUnavailable('Firestore Emulator unavailable: initial v1.22.0 JAR download from storage.googleapis.com failed; no repeated installation/download attempted. Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 after starting the test emulator.');
  if(!/^127\.0\.0\.1:\d+$/.test(host)||!PROJECT.startsWith('demo-'))throw Error('Only loopback demo- emulator projects are permitted');
  const origin=`http://${host}`,reset=`${origin}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  let response;try{response=await fetch(reset,{method:'DELETE',signal:AbortSignal.timeout(3000)});}catch(e){throw new EnvironmentUnavailable(`Loopback Firestore Emulator is not reachable: ${e.cause?.code||e.message}`);}
  if(!response.ok)throw Error(`Emulator reset failed: ${response.status}`);
  const {initializeApp,deleteApp}=require('firebase/app'),sdk=require('firebase/firestore');
  const clients=[];let sequence=0;
  function fork(uid='synthetic-owner'){
    const app=initializeApp({projectId:PROJECT,apiKey:'synthetic-emulator-only',appId:'synthetic'},`recurrence-${process.pid}-${++sequence}`);
    const db=sdk.initializeFirestore(app,{localCache:sdk.memoryLocalCache()});
    const [hostname,port]=host.split(':');sdk.connectFirestoreEmulator(db,hostname,Number(port),{mockUserToken:{sub:uid,user_id:uid}});
    clients.push({app,db});return {db,sdk};
  }
  const t={...fork(),sdk:{...sdk},fork:()=>({ ...fork(), sdk:t.sdk }),otherUser:async()=>fork('synthetic-intruder')};
  t.list=async collection=>(await sdk.getDocsFromServer(sdk.collection(t.db,collection))).docs.map(d=>d.data());
  t.remove=(collection,id)=>sdk.deleteDoc(sdk.doc(t.db,collection,id));
  t.offline=()=>Promise.all(clients.map(c=>sdk.disableNetwork(c.db)));
  t.online=()=>Promise.all(clients.map(c=>sdk.enableNetwork(c.db)));
  try{return await run(t);}finally{await Promise.all(clients.map(async c=>{await sdk.terminate(c.db);await deleteApp(c.app);}));}
}
module.exports={withEmulator};
