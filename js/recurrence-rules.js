/* Pure schema11 recurrence interpretation and date planning. Clock/calendar are inputs. */
(function(host,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./date-only.js'):host.WMDateOnly);
  if(typeof module==='object'&&module.exports)module.exports=api;else host.WMRecurrenceRules=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';
  if(!D)throw new Error('공통 날짜 엔진을 불러오지 못했습니다.');
  function fail(code,message){const error=new Error(message);error.name='RecurrenceRuleError';error.code=code;throw error;}
  const frequencyKeys=['repeatFrequency','frequency','freq','cycle','cycleType','repeatType','period','interval','repeatUnit','type','unit'];
  const monthKeys=['cycleMonths','executionMonths','scheduledMonths','selectedMonths','monthlyMonths','monthList','repeatMonths','months','runMonths'];
  const weekdayKeys=['weekday','weekDay','weekDays','weekdays','dayOfWeek','repeatWeekday','scheduledWeekday','daysOfWeek','repeatDays'];
  const aliases={weekly:['weekly','week','주별','매주'],monthly:['monthly','month','월별','매월'],
    quarterly:['quarterly','quarter','분기별','분기','매분기'],semiannual:['semiannual','semi-annual','semi annual','half','halfyear','half-year','half year','반기별','반기','매반기'],
    yearly:['yearly','annual','year','연간','매년','연별'],none:['none','once','일회성','없음']};
  function freqFrom(value){
    if(value&&typeof value==='object')return frequency(value)||'';
    const text=String(value??'').trim().toLowerCase();
    return Object.keys(aliases).find(key=>aliases[key].includes(text))||'';
  }
  function sources(value){return [value,value?.repeat,value?.recurrence,value?.schedule].filter(v=>v&&typeof v==='object'&&!Array.isArray(v));}
  function agree(values,code){
    if(!values.length)return null;
    if(values.some(v=>JSON.stringify(v)!==JSON.stringify(values[0])))fail(code,'반복 설정 필드가 서로 충돌합니다. 설정을 확인해 주세요.');
    return values[0];
  }
  function frequency(source){
    const values=[];
    for(const item of sources(source))for(const key of frequencyKeys){
      const raw=item[key];if(raw===undefined||raw===null||raw==='')continue;
      const value=freqFrom(raw);
      if(value)values.push(value);
      else if(!['period','interval','type','unit'].includes(key))fail('INVALID_FREQUENCY','지원하지 않는 반복 주기입니다.');
    }
    for(const key of ['repeat','recurrence','schedule'])if(typeof source?.[key]==='string'&&source[key]){
      const value=freqFrom(source[key]);if(!value)fail('INVALID_FREQUENCY','지원하지 않는 반복 주기입니다.');values.push(value);
    }
    return agree(values,'FREQUENCY_CONFLICT');
  }
  function weekday(raw){
    const text=String(raw??'').trim().toLowerCase();
    if(/^[0-6]$/.test(text))return Number(text);
    const names=[['일','일요일','sun','sunday'],['월','월요일','mon','monday'],['화','화요일','tue','tuesday'],
      ['수','수요일','wed','wednesday'],['목','목요일','thu','thursday'],['금','금요일','fri','friday'],['토','토요일','sat','saturday']];
    const day=names.findIndex(list=>list.includes(text));
    if(day<0)fail('INVALID_WEEKDAY','반복 요일은 일요일 0~토요일 6 범위여야 합니다.');return day;
  }
  function listField(source,keys,parse,code){
    const lists=[];
    for(const item of sources(source))for(const key of keys){
      const raw=item[key];if(raw===undefined||raw===null||raw==='')continue;
      if(!Array.isArray(raw)&&typeof raw!=='string'&&typeof raw!=='number')fail(code,'반복 날짜 선택 형식을 확인해 주세요.');
      const items=Array.isArray(raw)?raw:String(raw).trim().split(/[,，\s]+/);
      if(!items.length)continue; // schema11's empty lists mean no additional restriction.
      lists.push([...new Set(items.map(parse))].sort((a,b)=>a-b));
    }
    return agree(lists,code);
  }
  const configuredMonths=source=>listField(source,monthKeys,value=>{
    const n=Number(value);if(value===null||value===''||typeof value==='boolean'||!Number.isInteger(n)||n<1||n>12)
      fail('INVALID_MONTHS','반복 월은 1~12 범위의 정수여야 합니다.');return n;
  },'MONTHS_CONFLICT');
  const configuredWeekDays=source=>listField(source,weekdayKeys,weekday,'WEEKDAYS_CONFLICT');
  const configuredWeekDay=source=>configuredWeekDays(source)?.[0]??null;
  function interpret(task={},template={}){
    const warnings=[];
    const choose=(a,b,label)=>{
      if(a!==null&&b!==null&&JSON.stringify(a)!==JSON.stringify(b))warnings.push({code:`TEMPLATE_${label}_PRECEDENCE`,message:'라이브러리 반복 설정을 우선 적용합니다. 업무의 별도 설정과 차이가 있습니다.'});
      return a??b;
    };
    const kind=choose(frequency(template),frequency(task),'FREQUENCY');
    if(!kind||kind==='none')return {kind:'',months:null,weekdays:null,warnings};
    const months=choose(configuredMonths(template),configuredMonths(task),'MONTHS');
    const weekdays=kind==='weekly'?choose(configuredWeekDays(template),configuredWeekDays(task),'WEEKDAYS'):null;
    const policies=source=>{
      const values=['holidayShiftV181','holidayShift'].flatMap(key=>sources(source).map(s=>s[key]).filter(v=>v!==undefined&&v!==null&&v!==''));
      if(values.some(v=>!['keep','prev','next'].includes(v)))fail('INVALID_HOLIDAY_POLICY','휴일 이동 방향을 확인해 주세요.');
      if(values.some(v=>v!==values[0]))warnings.push({code:'HOLIDAY_FIELD_PRECEDENCE',message:'명시된 V181 휴일 설정과 바깥쪽 설정을 우선 적용합니다. 다른 휴일 설정을 확인해 주세요.'});
      return values[0]??null;
    };
    const holidayShift=choose(policies(template),policies(task),'HOLIDAY')||'keep';
    if(!['keep','prev','next'].includes(holidayShift))fail('INVALID_HOLIDAY_POLICY','휴일 이동 방향을 확인해 주세요.');
    return {kind,months,weekdays,holidayShift,warnings};
  }
  function addMonths(input,n,day){
    const value=D.normalize(input),[y,m,d]=value.split('-').map(Number),target=day??d;
    if(!Number.isSafeInteger(n)||!Number.isInteger(target)||target<1||target>31)fail('INVALID_MONTH_OFFSET','월 간격과 기준일을 확인해 주세요.');
    const index=y*12+m-1+n,year=Math.floor(index/12),month=((index%12)+12)%12+1;
    return D.normalize(`${year}-${month}-${Math.min(target,D.daysInMonth(year,month))}`);
  }
  function until(task){
    // Explicit V181 empty value means the user chose no end date.
    if(Object.hasOwn(task,'repeatUntilV181'))return task.repeatUntilV181===''||task.repeatUntilV181===null?'':D.normalize(task.repeatUntilV181);
    const values=[task.repeat?.until,task.repeat?.endDate,task.repeatEndDate,task.recurrenceEndDate]
      .filter(v=>v!==undefined&&v!==null&&v!=='').map(D.normalize);
    return agree(values,'END_CONFLICT')||'';
  }
  function plan({rule,anchor,today,until:limit='',duration=0,holidays=[]}){
    anchor=D.normalize(anchor);today=D.normalize(today);if(limit)limit=D.normalize(limit);
    if(!Number.isSafeInteger(duration)||duration<0)fail('INVALID_DURATION','반복 업무의 기간을 확인해 주세요.');
    if(!rule.kind)return {horizon:limit||addMonths(today,3),occurrences:[]};
    if(!Object.hasOwn(aliases,rule.kind)||rule.kind==='none')fail('INVALID_FREQUENCY','지원하지 않는 반복 주기입니다.');
    let horizon=[addMonths(today,3),addMonths(anchor,3)].sort().at(-1);
    if(limit&&limit<horizon)horizon=limit;
    const occurrences=[],day=Number(anchor.slice(8)),calendar={holidays};
    const emit=raw=>{
      if(raw<=anchor||raw>horizon||rule.months&&!rule.months.includes(Number(raw.slice(5,7))))return;
      let start=raw,end=D.addDays(raw,duration);
      const shifted=D.shiftBusinessDay(end,rule.holidayShift||'keep',calendar,{maxIterations:365});
      if(start===end)start=shifted;end=shifted;
      // The raw occurrence and its visible dates must stay inside the explicit end.
      if(limit&&(start>limit||end>limit))return;
      if(end<start)fail('INVALID_SHIFTED_RANGE','휴일 이동 결과가 반복 업무 시작일보다 이릅니다.');
      occurrences.push({scheduled:raw,start,end});
    };
    if(rule.kind==='weekly'){
      const days=rule.weekdays||[D.weekday(anchor)];
      for(let n=1;n<=36600;n++){
        const raw=D.addDays(anchor,n);if(raw>horizon)return {horizon,occurrences};
        if(days.includes(D.weekday(raw)))emit(raw);
      }
    }else{
      const interval={monthly:1,quarterly:3,semiannual:6,yearly:12}[rule.kind];
      let aligned=anchor;
      if(rule.months)for(let n=0;n<12&&!rule.months.includes(Number(aligned.slice(5,7)));n++)aligned=addMonths(aligned,1,day);
      for(let n=0;n<=1200;n++){
        const raw=addMonths(aligned,interval*n,day);if(raw>horizon)return {horizon,occurrences};emit(raw);
      }
    }
    fail('ITERATION_LIMIT','반복 일정 계산의 탐색 한도를 초과했습니다.');
  }
  return Object.freeze({freqFrom,interpret,scheduleKind:(task,template)=>interpret(task,template).kind,
    configuredMonths,configuredWeekDay,configuredWeekDays,addMonths,until,plan});
});
