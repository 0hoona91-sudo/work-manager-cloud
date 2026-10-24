const assert=require('node:assert/strict'),{loadCloud,plain}=require('./helpers.cjs'),{schema11}=require('./fixtures.cjs');
module.exports=({test})=>test('TASKS-RETIRED-01','Imported Tasks data and enabled legacy settings survive cloud and JSON roundtrips',()=>{
 const s=schema11();s.settings.googleTasksV15={enabled:true,listId:'legacy-list'};const t=s.tasks[0];t.googleTaskId='legacy-remote';t.googleTasksV15={etag:'legacy-etag'};t.completionHistory=[{id:'history',actualComplete:'2026-10-24'}];t.checklist[0].googleTaskId='legacy-check';const before=plain(s),C=loadCloud();const out=plain(C.deserializeState(C.serializeState(JSON.parse(JSON.stringify(s)))));assert.deepEqual(out,before);assert.deepEqual(s,before);
});
