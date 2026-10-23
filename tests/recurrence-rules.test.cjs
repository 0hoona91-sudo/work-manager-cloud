const assert=require('node:assert/strict');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const R=require('../js/recurrence-rules.js');
const D=require('../js/date-only.js');
const {root,read,parse,walk,plain,loadRecurrence,loadCloud}=require('./helpers.cjs');
const {recurring,schema11}=require('./fixtures.cjs');
const {withPage}=require('./browser.test.cjs');
const plan=(template,anchor,today,extra={})=>R.plan({rule:R.interpret({},template),anchor,today,...extra}).occurrences;
module.exports=({test,EnvironmentUnavailable})=>{
  test('RULE-01','Canonical frequencies and legacy half resolve without rewriting source fields',()=>{
    for(const kind of ['weekly','monthly','quarterly','semiannual','yearly'])assert.equal(R.freqFrom(kind),kind);
    const template=Object.freeze({cycle:'half'});assert.equal(R.interpret({},template).kind,'semiannual');
    assert.equal(R.freqFrom({frequency:'half-year'}),'semiannual');assert.equal(template.cycle,'half');
    assert.equal(R.interpret({repeat:{cycle:'weekly'}},{}).kind,'weekly');
    assert.equal(R.interpret({}, {cycle:'none'}).kind,'');
  });
  test('RULE-02','cycleMonths and selectedMonths retain their filter meaning and equal aliases agree',()=>{
    for(const fields of [{cycleMonths:[1,4,7,10]},{selectedMonths:[1,4,7,10]},{cycleMonths:[10,1,4,7],selectedMonths:[1,4,7,10]}]){
      const input=Object.freeze({cycle:'monthly',...fields}),before=plain(input);
      assert.deepEqual(plan(input,'2026-10-01','2026-10-23').map(o=>o.scheduled),['2027-01-01']);
      assert.deepEqual(input,before);
    }
    assert.deepEqual(R.configuredMonths({cycleMonths:[],selectedMonths:'1, 4, 7, 10'}),[1,4,7,10]);
  });
  test('RULE-03','Conflicting aliases and malformed rule values fail without partially accepting data',()=>{
    for(const template of [{cycle:'monthly',selectedMonths:[1],cycleMonths:[2]},
      {cycle:'half',frequency:'monthly'},{cycle:'weekly',weekday:1,weekdays:[2]},
      {cycle:'monthly',cycleMonths:[1,13]},{cycle:'weekly',weekdays:[1,7]},
      {cycle:'unsupported'},{cycle:'monthly',selectedMonths:{month:1}}])assert.throws(()=>R.interpret({},template));
    assert.equal(R.scheduleKind({},{}),'');
  });
  test('RULE-04','Template precedence is explicit and warns; missing fields fall back to nested task rules',()=>{
    const rule=R.interpret({repeat:{cycle:'yearly',months:[2]}},{cycle:'monthly',cycleMonths:[1]});
    assert.equal(rule.kind,'monthly');assert.deepEqual(rule.months,[1]);
    assert.deepEqual(rule.warnings.map(w=>w.code),['TEMPLATE_FREQUENCY_PRECEDENCE','TEMPLATE_MONTHS_PRECEDENCE']);
    assert.deepEqual(R.interpret({repeat:{cycle:'weekly',weekdays:[1,3]}},{cycle:'weekly'}).weekdays,[1,3]);
    const shift=R.interpret({}, {cycle:'monthly',holidayShift:'prev',holidayShiftV181:'next'});
    assert.equal(shift.holidayShift,'next');assert.equal(shift.warnings[0].code,'HOLIDAY_FIELD_PRECEDENCE');
  });
  test('RULE-05','Weekly generation honors every selected weekday and does not realign the stored root',()=>{
    const state=recurring('weekly','2026-10-20',{weekdays:[1,3]});state.tasks[0].repeatUntilV181='2026-10-28';
    const before=plain(state.tasks[0]);loadRecurrence(state).ensureOccurrences();
    assert.deepEqual(state.tasks.map(t=>t.start),['2026-10-20','2026-10-21','2026-10-26','2026-10-28']);
    assert.deepEqual(state.tasks[0],before);
    assert.equal(R.configuredWeekDay({weekday:'금요일'}),5);
  });
  test('RULE-06','Missing weekly day defaults to anchor weekday; empty month arrays keep unrestricted months',()=>{
    assert.deepEqual(plan({cycle:'weekly'},'2026-10-20','2026-10-20',{until:'2026-11-03'}).map(o=>o.scheduled),['2026-10-27','2026-11-03']);
    assert.deepEqual(plan({cycle:'monthly',cycleMonths:[]},'2026-10-01','2026-10-23').map(o=>o.scheduled),['2026-11-01','2026-12-01','2027-01-01']);
  });
  test('RULE-07','Half and semiannual produce the same leap-aware, month-end dates',()=>{
    for(const cycle of ['half','semiannual'])assert.deepEqual(plan({cycle},'2023-08-31','2024-10-01').map(o=>o.scheduled),['2024-02-29','2024-08-31']);
    assert.deepEqual(plan({cycle:'half',cycleMonths:[6,12]},'2026-01-31','2026-10-01').map(o=>o.scheduled),['2026-06-30','2026-12-31']);
  });
  test('RULE-08','Monthly clamping preserves the original day after February and selected-month alignment',()=>{
    assert.deepEqual(plan({cycle:'monthly'},'2024-01-31','2024-01-31').map(o=>o.scheduled),['2024-02-29','2024-03-31','2024-04-30']);
    assert.deepEqual(plan({cycle:'monthly',cycleMonths:[2,3,4]},'2026-01-31','2026-01-31').map(o=>o.scheduled),['2026-02-28','2026-03-31','2026-04-30']);
    assert.equal(R.addMonths('2026-03-31',-1),'2026-02-28');
  });
  test('RULE-09','Quarterly and yearly preserve month-end cadence and leap-day anniversary',()=>{
    assert.deepEqual(plan({cycle:'quarterly'},'2026-01-31','2026-10-23').map(o=>o.scheduled),['2026-04-30','2026-07-31','2026-10-31']);
    assert.deepEqual(plan({cycle:'yearly'},'2024-02-29','2028-01-01').map(o=>o.scheduled),['2025-02-28','2026-02-28','2027-02-28','2028-02-29']);
  });
  test('RULE-10','End boundary is inclusive, explicit no-end wins over stale legacy end, rolling stays three months',()=>{
    assert.deepEqual(plan({cycle:'monthly'},'2026-10-01','2026-10-23',{until:'2026-11-01'}).map(o=>o.scheduled),['2026-11-01']);
    assert.deepEqual(plan({cycle:'monthly'},'2026-10-01','2026-10-23',{until:'2026-10-31'}),[]);
    assert.equal(R.until({repeatUntilV181:'',repeat:{until:'2026-11-01'}}),'');
    assert.throws(()=>R.until({repeat:{until:'2026-11-01',endDate:'2026-12-01'}}),{code:'END_CONFLICT'});
    const p=R.plan({rule:R.interpret({}, {cycle:'monthly'}),anchor:'2026-10-01',today:'2026-10-23'});
    assert.equal(p.horizon,'2027-01-23');assert.equal(p.occurrences.at(-1).start,'2027-01-01');
  });
  test('RULE-11','Holiday shift retains raw occurrence identity and does not generate visible dates beyond end',()=>{
    const next=plan({cycle:'monthly',holidayShiftV181:'next'},'2026-09-24','2026-10-01',{holidays:['2026-10-26']});
    assert.deepEqual(next[0],{scheduled:'2026-10-24',start:'2026-10-27',end:'2026-10-27'});
    assert.deepEqual(plan({cycle:'monthly',holidayShiftV181:'prev'},'2026-09-24','2026-10-01')[0],{scheduled:'2026-10-24',start:'2026-10-23',end:'2026-10-23'});
    assert.deepEqual(plan({cycle:'monthly',holidayShiftV181:'next'},'2026-09-24','2026-10-01',{until:'2026-10-24'}),[]);
  });
  test('RULE-12','Existing completed, reopened and manually moved occurrences remain byte-for-byte unchanged',()=>{
    const state=recurring(),api=loadRecurrence(state);api.ensureOccurrences();
    Object.assign(state.tasks[1],{status:'done',actualComplete:'2026-11-03',completionHistory:[{id:'history-fixture',snapshot:{notes:'old'}}],attachments:[{id:'file-fixture',driveFileId:'synthetic-file'}]});
    Object.assign(state.tasks[2],{start:'2026-12-19',end:'2026-12-21',scheduleOverride:true,completionHistory:[{id:'reopened-fixture',snapshot:{status:'done'}}]});
    const before=plain(state.tasks);assert.equal(api.ensureOccurrences(),0);assert.deepEqual(plain(state.tasks),before);
    state.templates[0].cycleMonths=[1,4,7,10];api.ensureOccurrences();assert.deepEqual(plain(state.tasks),before);
  });
  test('RULE-13','Existing root/history and inherited holiday marker are preserved; new shifted clones use raw dates',()=>{
    const state=recurring('monthly','2026-09-24',{holidayShiftV181:'next'});
    Object.assign(state.tasks[0],{holidayAppliedV181:true,manualOverride:true,completionHistory:[{id:'synthetic-completion',snapshot:{status:'done'}}]});
    const rootBefore=plain(state.tasks[0]);const api=loadRecurrence(state);api.ensureOccurrences();
    assert.deepEqual(state.tasks[0],rootBefore);
    const child=state.tasks.find(t=>t.repeatScheduledDateV181==='2026-10-24');assert.equal(child.start,'2026-10-26');assert.equal(child.completionHistory,undefined);
    const before=plain(state.tasks);assert.equal(api.ensureOccurrences(),0);assert.deepEqual(plain(state.tasks),before);
  });
  test('RULE-14','Bad rules, dates and ends produce diagnostics and no source writes',()=>{
    for(const mutate of [s=>{s.templates[0].cycleMonths=[0,13];},s=>{s.templates[0].cycle='unknown';},s=>{s.tasks[0].start='2026-02-30';},s=>{s.tasks[0].repeatUntilV181='invalid';}]){
      const state=recurring();mutate(state);const before=plain(state),api=loadRecurrence(state);
      assert.equal(api.ensureOccurrences(),0);assert.deepEqual(plain(state),before);assert.equal(api.getDiagnostics().length,1);
    }
  });
  test('RULE-15','Explicit end-choice handler does not delete or rewrite any existing generated occurrence',()=>{
    const state=recurring(),api=loadRecurrence(state);api.ensureOccurrences();
    state.tasks[2].completionHistory=[{id:'synthetic-reopened'}];state.tasks[3].start='2027-02-01';
    const before=plain(state.tasks.slice(1)),source=read('js/project-ui.js'),found=[];
    walk(parse(source),n=>{if(n.type==='FunctionDeclaration'&&n.id?.name==='applyEndChoice')found.push(n);});assert.equal(found.length,1);
    const ctx=vm.createContext({state,pendingEnd:{taskId:state.tasks[0].id,until:'2026-11-01'},seriesRoot:t=>state.tasks.find(x=>x.id===(t.repeatOriginV181||t.id))});
    vm.runInContext(source.slice(found[0].start,found[0].end)+';applyEndChoice();',ctx);
    assert.equal(state.tasks[0].repeatUntilV181,'2026-11-01');assert.deepEqual(plain(state.tasks.slice(1)),before);
  });
  test('RULE-16','Schema11 roundtrip preserves recurrence source fields, scheduled dates and file references',()=>{
    const input=schema11(),state=recurring('half','2026-01-31',{cycleMonths:[1,7]});
    Object.assign(state.templates[0],{checklist:[],attachments:[],linkedSteps:[],method:'',methodBlocks:[],photos:[]});
    state.tasks[0].link=null;Object.assign(state.tasks[0].checklist[0],{owner:'',dueDate:''});
    state.tasks[0].attachments=[{id:'synthetic-file',driveFileId:'synthetic-drive',name:'fixture.pdf'}];loadRecurrence(state).ensureOccurrences();
    input.tasks=plain(state.tasks);input.templates=plain(state.templates);const C=loadCloud();
    assert.deepEqual(plain(C.deserializeState(C.serializeState(input))),input);
  });
  test('RULE-17','Pure planner uses no browser, implicit clock, randomness or input mutation',()=>{
    const ctx=vm.createContext({module:{exports:{}},require:name=>{assert.equal(name,'./date-only.js');return D;},Date:class{constructor(){throw Error('Clock forbidden');}},Math:Object.assign(Object.create(Math),{random(){throw Error('Random forbidden');}})});
    vm.runInContext(read('js/recurrence-rules.js'),ctx);const engine=ctx.module.exports;
    const input={rule:engine.interpret({}, {cycle:'monthly'}),anchor:'2026-10-01',today:'2026-10-23'},before=plain(input);
    const first=plain(engine.plan(input));assert.deepEqual(plain(engine.plan(input)),first);assert.deepEqual(plain(input),before);
    assert.throws(()=>engine.plan({...input,anchor:'2026-02-30'}));
    assert.throws(()=>engine.plan({...input,duration:-1}),{code:'INVALID_DURATION'});
  });
  for(const [i,TZ] of ['UTC','Asia/Seoul','Pacific/Kiritimati'].entries())test(`RULE-TZ-0${i+1}`,`Recurrence raw and shifted dates match in ${TZ}`,()=>{
    const script=`const {loadRecurrence}=require('./tests/helpers.cjs'),{recurring}=require('./tests/fixtures.cjs');const s=recurring('monthly','2026-09-24',{holidayShiftV181:'next',cycleMonths:[10,11,12]});loadRecurrence(s).ensureOccurrences();process.stdout.write(JSON.stringify(s.tasks.map(t=>[t.start,t.repeatScheduledDateV181||null])));`;
    assert.deepEqual(JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:root,env:{...process.env,TZ},encoding:'utf8',timeout:5000})),[['2026-09-24',null],['2026-10-26','2026-10-24'],['2026-11-24','2026-11-24'],['2026-12-24','2026-12-24']]);
  });
  test('RULE-UI-01','Browser module loads and repeated rendering preserves completed history and existing dates',()=>withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
    const result=await page.evaluate(()=>{
      state.tasks=[{id:'synthetic-browser-root',name:'Recurrence fixture',start:'2026-10-01',end:'2026-10-01',status:'planned',actualComplete:null,dbManualRootTemplateId:'synthetic-browser-template',checklist:[]}];
      state.templates=[{id:'synthetic-browser-template',cycle:'monthly',cycleMonths:[1,4,7,10]}];state.holidays=[];saveState=async()=>{};
      const R=WMTaskRecurrenceV181;R.ensureOccurrences();
      const child=state.tasks[1];child.status='done';child.actualComplete='2027-01-02';child.completionHistory=[{id:'synthetic-browser-history',snapshot:{notes:'Original'}}];
      const before=JSON.stringify(child),rootBefore=JSON.stringify(state.tasks[0]);renderTaskTable();renderTaskTable();
      return {starts:state.tasks.map(t=>t.start),same:JSON.stringify(child)===before,rootSame:JSON.stringify(state.tasks[0])===rootBefore};
    });
    assert.deepEqual(result,{starts:['2026-10-01','2027-01-01'],same:true,rootSame:true});
  }));
};
