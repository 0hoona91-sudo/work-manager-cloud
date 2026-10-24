/* One policy source for workspace guidance and Emulator compilation. No network/storage. */
(function(host,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else host.WMFirestoreRulesPolicy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const version='phase6f-rules-v1';
  function project(value){
    if(typeof value!=='string'||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value))throw new Error('Firebase 프로젝트 ID가 필요합니다. 6~30자의 소문자·숫자·하이픈을 확인하세요.');
    return value;
  }
  function validate({uid,extraUids=[],projectId}={}){
    project(projectId);
    if(!Array.isArray(extraUids)||extraUids.length>19)throw new Error('추가 승인 UID는 최대 19개입니다.');
    const values=[uid,...extraUids];
    if(values.some(v=>typeof v!=='string'||!/^[A-Za-z0-9._:@+-]{1,128}$/.test(v)))throw new Error('승인 Firebase UID가 올바르지 않습니다. 빈 값·공백·따옴표·제어 문자는 허용하지 않습니다.');
    return {projectId,allowedUids:[...new Set(values)].sort()};
  }
  function generate(options){
    const {projectId,allowedUids}=validate(options);
    return String.raw`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Generated from WMFirestoreRulesPolicy. Display/review only; never auto-deploy.
    function owner() { return request.auth != null && request.auth.uid in ${JSON.stringify(allowedUids)}; }
    function lockId(key) {
      return 'auto-' + key.toUtf8().toBase64().replace('[+]', '-').replace('/', '_').replace('=', '');
    }
    function keyed(data) { return data.get('generatedKey', '') is string && data.get('generatedKey', '') != ''; }
    function validKey(key) { return key is string && key.size() > 0
        && (!key.matches('wm-recurrence:.*') || key.matches('wm-recurrence:v1:${projectId}:.*'));  }
    function pairedNewLock(data, taskId) {
      let key = data.generatedKey;
      let path = /databases/$(database)/documents/generatedKeys/$(lockId(key));
      return validKey(key) && !exists(path)
        && getAfter(path).data.generatedKey == key && getAfter(path).data.taskId == taskId;
    }
    function revisionCreate() { return request.resource.data.revision == 1; }
    function revisionUpdate() {
      return request.resource.data.revision is int
        && request.resource.data.revision == resource.data.get('revision', 0) + 1;
    }
    function parentPath(data) {
      let collection = data.parentType == 'task' ? 'tasks' : data.parentType == 'template' ? 'templates' : 'linkedRules';
      return /databases/$(database)/documents/$(collection)/$(data.parentId);
    }
    function parentAdvanced(data, deleting) {
      let path = parentPath(data);
      return data.parentType in ['task', 'template', 'linkedRule'] && data.parentId is string
        && ((!exists(path) && !deleting && getAfter(path).data.revision == 1)
          || (exists(path) && ((deleting && !existsAfter(path))
            || getAfter(path).data.revision == get(path).data.get('revision', 0) + 1)));
    }
    match /tasks/{taskId} {
      allow read: if owner();
      allow create: if owner() && revisionCreate()
        && (keyed(request.resource.data) ? pairedNewLock(request.resource.data, taskId)
          : request.resource.data.get('repeatGeneratedV181', false) != true);
      allow update: if owner() && revisionUpdate()
        && (keyed(resource.data) ? request.resource.data.get('generatedKey', '') == resource.data.generatedKey
          : ((!keyed(request.resource.data) && (request.resource.data.get('repeatGeneratedV181', false) != true || resource.data.get('repeatGeneratedV181', false) == true))
            || pairedNewLock(request.resource.data, taskId)));
      allow delete: if owner(); // Existing key is deliberately retained as a tombstone.
    }
    match /generatedKeys/{keyId} {
      allow read: if owner();
      allow create: if owner() && validKey(request.resource.data.generatedKey)
        && keyId == lockId(request.resource.data.generatedKey)
        && request.resource.data.taskId is string
        && getAfter(/databases/$(database)/documents/tasks/$(request.resource.data.taskId)).data.generatedKey == request.resource.data.generatedKey
        && (!exists(/databases/$(database)/documents/tasks/$(request.resource.data.taskId))
          || !keyed(get(/databases/$(database)/documents/tasks/$(request.resource.data.taskId)).data));
      allow update, delete: if false;
    }
    match /checklistItems/{id} {
      allow read: if owner();
      allow create: if owner() && parentAdvanced(request.resource.data, false);
      allow update: if owner() && request.resource.data.parentType == resource.data.parentType
        && request.resource.data.parentId == resource.data.parentId && parentAdvanced(resource.data, false);
      allow delete: if owner() && parentAdvanced(resource.data, true);
    }
    match /{collection}/{id} {
      allow read: if owner() && collection in ['templates', 'linkedRules', 'projects', 'taskLinks', 'manualBlocks', 'owners', 'categories', 'holidays', 'settings', 'meta', 'changeLogs'];
      allow create: if owner() && collection in ['templates', 'linkedRules'] && revisionCreate();
      allow update: if owner() && collection in ['templates', 'linkedRules'] && revisionUpdate();
      allow delete: if owner() && collection in ['templates', 'linkedRules'];
      allow write: if owner() && collection in ['projects', 'taskLinks', 'manualBlocks', 'owners', 'categories', 'holidays', 'settings', 'meta', 'changeLogs'];
    }
  }
}
`;
  }
  function guidance(options){const validated=validate(options);return {...validated,policyVersion:version,rules:generate(options)};}
  return {version,project,validate,generate,guidance};
});
