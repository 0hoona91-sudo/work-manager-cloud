const assert = require('node:assert/strict');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const D = require('../js/date-only.js');
const { root, read, loadModel, loadCloud, plain } = require('./helpers.cjs');
const { project, schema11 } = require('./fixtures.cjs');
const { withPage } = require('./browser.test.cjs');

module.exports = ({ test, EnvironmentUnavailable }) => {
  test('DATE-01', 'Normalize existing compact and separated inputs without Date rollover', () => {
    for (const [input, expected] of [['202691','2026-09-01'],['2026926','2026-09-26'],
      ['2026101','2026-10-01'],[20261023,'2026-10-23'],[' 2024.2.29 ','2024-02-29'],['2026/1/2','2026-01-02']]) {
      assert.equal(D.normalize(input), expected); assert.equal(D.normalize(expected), expected);
    }
  });
  test('DATE-02', 'Reject invalid dates, timestamps and missing inputs with explicit errors', () => {
    for (const input of ['',null,undefined,{},true,NaN,'2026-02-29','2024-02-30','2026-04-31',
      '2026-00-10','2026-13-01','2026-01-00','0999-01-01','10000-01-01','2026-01-01T00:00:00Z']) {
      assert.equal(D.isValid(input), false);
      assert.throws(() => D.normalize(input), {name:'DateOnlyError',code:'INVALID_DATE'});
    }
    assert.equal(D.isValid('2024-02-29'), true);
    assert.equal(loadModel().date(''), ''); // Legacy optional fields remain optional.
  });
  test('DATE-03', 'Gregorian leap centuries and month ends are explicit', () => {
    assert.deepEqual([1900,2000,2024,2026,2100].map(D.isLeapYear), [false,true,true,false,false]);
    assert.equal(D.daysInMonth(2024,2),29); assert.equal(D.daysInMonth(2026,2),28);
    assert.equal(D.endOfMonth('2024-02-01'),'2024-02-29');
    assert.equal(D.endOfMonth('2026-04-01'),'2026-04-30');
    assert.throws(()=>D.daysInMonth(2026,13),{code:'INVALID_MONTH'});
    assert.throws(()=>D.isLeapYear(999),{code:'INVALID_YEAR'});
  });
  test('DATE-04', 'Signed day offsets cross leap days, month and year boundaries reversibly', () => {
    for (const [from,offset,to] of [['2024-02-28',1,'2024-02-29'],['2024-03-01',-1,'2024-02-29'],
      ['2026-02-28',1,'2026-03-01'],['2026-01-31',1,'2026-02-01'],['2026-01-01',-1,'2025-12-31'],
      ['2026-12-31',1,'2027-01-01'],['2026-10-23',0,'2026-10-23']]) {
      assert.equal(D.addDays(from,offset),to); assert.equal(D.addDays(to,-offset),from);
      assert.equal(D.difference(from,to),offset); assert.equal(D.difference(to,from),offset===0?0:-offset);
    }
  });
  test('DATE-05', 'Invalid offsets and out-of-range results fail instead of truncating or rolling over', () => {
    for(const offset of [0.5,-0.5,NaN,Infinity,-Infinity,'1',Number.MAX_SAFE_INTEGER+1])
      assert.throws(()=>D.addDays('2026-01-01',offset),{code:'INVALID_OFFSET'});
    assert.throws(()=>D.addDays('1000-01-01',-1),{code:'DATE_RANGE'});
    assert.throws(()=>D.addDays('9999-12-31',1),{code:'DATE_RANGE'});
    assert.throws(()=>D.difference('', '2026-01-01'),{code:'INVALID_DATE'});
  });
  test('DATE-06', 'Weekends and registered holidays are recognized without external state', () => {
    const calendar=Object.freeze({holidays:Object.freeze(['2026-10-09'])});
    assert.equal(D.weekday('2026-10-11'),0);
    assert.equal(D.isWeekend('2026-10-10'),true); assert.equal(D.isWeekend('2026-10-09'),false);
    assert.equal(D.isHoliday('2026-10-09',calendar),true);
    assert.equal(D.isHoliday('2026-10-10',calendar),true);
    assert.equal(D.isHoliday('2026-10-12',calendar),false);
    assert.equal(D.isHoliday('2026-10-10',{weekendDays:[]}),false);
  });
  test('DATE-07', 'Business offsets exclude the start and skip consecutive holidays in both directions', () => {
    const calendar=Object.freeze({holidays:Object.freeze(['2026-10-26','2026-10-27'])});
    assert.equal(D.addBusinessDays('2026-10-23',1,calendar),'2026-10-28');
    assert.equal(D.addBusinessDays('2026-10-28',-1,calendar),'2026-10-23');
    assert.equal(D.addBusinessDays('2026-10-23',2,calendar),'2026-10-29');
    assert.equal(D.addBusinessDays('2026-10-24',0,calendar),'2026-10-24');
  });
  test('DATE-08', 'Previous/next shifts are inclusive, idempotent and honor consecutive holidays', () => {
    const calendar={holidays:['2026-10-26','2026-10-27']};
    assert.equal(D.shiftBusinessDay('2026-10-25','prev',calendar),'2026-10-23');
    assert.equal(D.shiftBusinessDay('2026-10-25','next',calendar),'2026-10-28');
    assert.equal(D.shiftBusinessDay('2026-10-25','keep',calendar),'2026-10-25');
    for(const direction of ['prev','next']) assert.equal(D.shiftBusinessDay('2026-10-28',direction,calendar),'2026-10-28');
    assert.throws(()=>D.shiftBusinessDay('2026-10-25','sideways'),{code:'INVALID_DIRECTION'});
  });
  test('DATE-09', 'All-holiday calendars terminate at the exact iteration budget', () => {
    for(const offset of [-1,1]) {
      let calls=0;
      assert.throws(()=>D.addBusinessDays('2026-01-01',offset,{weekendDays:[],isHoliday:()=>{calls++;return true;}},{maxIterations:5}),{code:'ITERATION_LIMIT'});
      assert.equal(calls,5);
    }
    for(const direction of ['prev','next']) {
      let calls=0;
      assert.throws(()=>D.shiftBusinessDay('2026-01-01',direction,{weekendDays:[],isHoliday:()=>{calls++;return true;}},{maxIterations:5}),{code:'ITERATION_LIMIT'});
      assert.equal(calls,6); // Initial day plus five moved dates.
    }
    assert.equal(D.shiftBusinessDay('2026-10-25','next',undefined,{maxIterations:1}),'2026-10-26');
  });
  test('DATE-10', 'Calendar and loop limits cannot disable the safety boundary', () => {
    for(const maxIterations of [0,-1,0.5,Infinity,100001])
      assert.throws(()=>D.addBusinessDays('2026-01-01',1,{}, {maxIterations}),{code:'INVALID_LIMIT'});
    for(const calendar of [null,[],{holidays:'2026-01-01'},{weekendDays:[7]},{isHoliday:true}])
      assert.throws(()=>D.isHoliday('2026-01-01',calendar),{code:'INVALID_CALENDAR'});
    assert.throws(()=>D.isHoliday('2026-01-01',{holidays:['2026-02-30']}),{code:'INVALID_DATE'});
    assert.throws(()=>D.addBusinessDays('2026-01-01',100001),{code:'ITERATION_LIMIT'});
  });
  for(const [i,timezone] of ['UTC','Asia/Seoul','Pacific/Kiritimati','America/New_York'].entries()) {
    test(`DATE-TZ-0${i+1}`, `DateOnly and project facade return identical golden dates in ${timezone}`, () => {
      const script=`const D=require('./js/date-only.js'),M=require('./js/project-model.js'),{project}=require('./tests/fixtures.cjs');
        const p=project();p.stages[0].start=p.stages[0].endDate='2026-01-10';p.stages[1].relativeStartDays=-1;p.stages[1].relativeEndDays=2;
        const s=M.applyRelativeDates(p).stages[1];
        const holiday=d=>[0,6].includes(d.getDay())||(d.getMonth()===9&&[26,27].includes(d.getDate()));
        process.stdout.write(JSON.stringify([s.start,s.endDate,D.addDays('2026-03-08',1),D.difference('2026-03-07','2026-03-09'),
          D.addDays('2024-03-01',-1),D.addBusinessDays('2026-10-23',1,{holidays:['2026-10-26','2026-10-27']}),
          M.stageEnd({start:'2026-10-23',endType:'after',afterDays:1,includeHolidays:false,holidayShift:'keep'},holiday)]));`;
      const actual=JSON.parse(execFileSync(process.execPath,['-e',script],{cwd:root,env:{...process.env,TZ:timezone},timeout:5000,encoding:'utf8'}));
      assert.deepEqual(actual,['2026-01-09','2026-01-12','2026-03-09',2,'2024-02-29','2026-10-28','2026-10-28']);
    });
  }
  test('DATE-11', 'Engine runs without browser, clock, randomness or network capabilities', () => {
    class NoClock extends Date {
      constructor(...args) { assert.equal(args.length,1); super(...args); }
      static now() { throw Error('Implicit clock forbidden'); }
    }
    const math=Object.create(Math); math.random=()=>{throw Error('Randomness forbidden');};
    const ctx=vm.createContext({Date:NoClock,Math:math});
    vm.runInContext(read('js/date-only.js'),ctx,{timeout:1000});
    assert.equal(vm.runInContext("WMDateOnly.addBusinessDays('2026-10-23',1)",ctx),'2026-10-26');
    assert.equal(vm.runInContext("WMDateOnly.addDays('2026-01-10',-1)",ctx),'2026-01-09');
  });
  test('DATE-12', 'Legacy holiday Date callbacks and absent callbacks retain their original meaning', () => {
    const M=loadModel(),step={start:'2026-10-23',endType:'after',afterDays:1,includeHolidays:false,holidayShift:'keep'};
    assert.equal(M.stageEnd(step),'2026-10-24');
    assert.equal(M.stageEnd(step,d=>{assert.ok(d instanceof Date);return [0,6].includes(d.getDay());}),'2026-10-26');
    assert.equal(M.stageEnd({...step,afterDays:-1},d=>[0,6].includes(d.getDay())),'2026-10-22');
    assert.throws(()=>M.stageEnd({...step,afterDays:0.5}),{code:'INVALID_OFFSET'});
    assert.throws(()=>M.stageEnd({...step,afterDays:NaN}),{code:'INVALID_OFFSET'});
  });
  test('DATE-13', 'Project holiday searches fail safely without modifying the source draft', () => {
    const M=loadModel(),p=project(); Object.assign(p.stages[0],{endType:'after',afterDays:1,includeHolidays:false});
    const before=plain(p);
    assert.throws(()=>M.normalizeProject(p,()=>true),{code:'ITERATION_LIMIT'});
    assert.deepEqual(plain(p),before);
    assert.throws(()=>M.stageEnd({start:'2026-01-01',endType:'same',holidayShift:'next'},()=>true),{code:'ITERATION_LIMIT'});
  });
  test('DATE-14', 'Created and edited schema11 projects retain IDs, completion history and file references', () => {
    const M=loadModel(),p=project();
    p.stages[0].resources=[{id:'date-file',driveFileId:'synthetic-date-file',name:'fixture.pdf'}];
    const created=M.reconcile({projects:[],tasks:[]},M.normalizeProject(p));
    Object.assign(created.tasks[0],{status:'done',actualComplete:'2026-01-01',completionHistory:[{
      id:'task-a:completion:1',reopenedAt:'2025-12-31T00:00:00Z',snapshot:{id:'task-a',status:'done',actualComplete:'2025-12-30'}
    }]});
    const done=plain(created.tasks[0]),draft=M.clone(created.projects[0]);
    draft.name='Edited synthetic project';draft.stages[1].relativeStartDays=3;draft.stages[1].relativeEndDays=4;
    const edited=M.reconcile(created,M.normalizeProject(draft));
    assert.deepEqual(plain(edited.tasks[0]),done);
    assert.deepEqual(plain(edited.tasks.map(t=>[t.id,t.projectId,t.projectStageId,t.start,t.end])),[
      ['task-a','fixture-project','a','2026-01-01','2026-01-01'],['task-b','fixture-project','b','2026-01-04','2026-01-05']]);
    const state=schema11();state.projects=plain(edited.projects);state.tasks=plain(edited.tasks);
    const C=loadCloud(); assert.deepEqual(plain(C.deserializeState(C.serializeState(state))),state);
  });
  test('DATE-UI-01', 'Browser script order supports real project create/edit with stable task IDs', () =>
    withPage({width:1440,height:1000},EnvironmentUnavailable,async page=>{
      await page.evaluate(()=>{state.projects=[];state.tasks=[];state.categories=['fixture-category'];state.owners=['fixture-owner'];
        saveState=async()=>{};WMProjectUI.openEditor();});
      await page.locator('[data-project-root="name"]').fill('Date engine fixture');
      await page.locator('[data-project-root="category"]').selectOption('fixture-category');
      await page.locator('#prj-projectStart').fill('2026-01-10');
      await page.locator('#prj-stageStart').fill('2026-01-10');
      await page.locator('[data-stage-field="title"]').fill('Synthetic first stage');
      await page.locator('#prjSave').click();
      await page.waitForFunction(()=>state.projects.length===1&&!document.querySelector('#prjSave'));
      const first=await page.evaluate(()=>({id:state.projects[0].id,taskId:state.tasks[0].id,stageId:state.projects[0].stages[0].id,start:state.tasks[0].start}));
      assert.equal(first.start,'2026-01-10');
      await page.evaluate(id=>WMProjectUI.openEditor(id),first.id);
      await page.locator('#prj-stageStart').fill('2026-02-01');
      await page.locator('#prjSave').click();
      await page.waitForFunction(()=>!document.querySelector('#prjSave'));
      const edited=await page.evaluate(()=>({id:state.projects[0].id,taskId:state.tasks[0].id,stageId:state.projects[0].stages[0].id,start:state.tasks[0].start}));
      assert.deepEqual(edited,{...first,start:'2026-02-01'});
    }));
};
