/* Pure Gregorian DateOnly arithmetic. No implicit clock, timezone or workspace. */
(function (host, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (host) host.WMDateOnly = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const DEFAULT_MAX_ITERATIONS = 36600;
  const MAX_ITERATIONS = 100000;
  function fail(code, message) {
    const error = new Error(message);
    error.name = 'DateOnlyError'; error.code = code;
    throw error;
  }
  function yearValue(year) {
    if (!Number.isInteger(year) || year < 1000 || year > 9999)
      fail('INVALID_YEAR', '연도는 1000~9999 범위의 정수여야 합니다.');
    return year;
  }
  function isLeapYear(year) {
    yearValue(year);
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  function daysInMonth(year, month) {
    yearValue(year);
    if (!Number.isInteger(month) || month < 1 || month > 12)
      fail('INVALID_MONTH', '월은 1~12 범위의 정수여야 합니다.');
    return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }
  function format(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function normalize(input) {
    if (typeof input !== 'string' && typeof input !== 'number')
      fail('INVALID_DATE', '올바른 날짜를 입력해 주세요.');
    const text = String(input).trim();
    const separated = text.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})$/);
    let candidates = [];
    if (separated) candidates = [[Number(separated[1]), Number(separated[2]), Number(separated[3])]];
    else if (/^\d{6,8}$/.test(text)) {
      const year = Number(text.slice(0, 4)), tail = text.slice(4);
      if (tail.length === 2) candidates = [[year, Number(tail[0]), Number(tail[1])]];
      else if (tail.length === 4) candidates = [[year, Number(tail.slice(0, 2)), Number(tail.slice(2))]];
      else {
        const one = [year, Number(tail.slice(0, 1)), Number(tail.slice(1))];
        const two = [year, Number(tail.slice(0, 2)), Number(tail.slice(2))];
        candidates = two[1] >= 10 && two[1] <= 12 ? [two, one] : [one, two];
      }
    }
    for (const [year, month, day] of candidates) {
      if (year >= 1000 && year <= 9999 && month >= 1 && month <= 12 &&
          day >= 1 && day <= daysInMonth(year, month)) return format(year, month, day);
    }
    fail('INVALID_DATE', '올바른 날짜를 입력해 주세요. 날짜는 YYYY-MM-DD 또는 YYYYMMDD 형식이어야 합니다.');
  }
  function isValid(input) {
    try { normalize(input); return true; } catch (error) {
      if (error.code === 'INVALID_DATE') return false;
      throw error;
    }
  }
  function epochDay(input) {
    const [year, month, day] = normalize(input).split('-').map(Number);
    return Date.UTC(year, month - 1, day) / DAY;
  }
  const MIN_DAY = Date.UTC(1000, 0, 1) / DAY, MAX_DAY = Date.UTC(9999, 11, 31) / DAY;
  function fromDay(day) {
    if (!Number.isInteger(day) || day < MIN_DAY || day > MAX_DAY)
      fail('DATE_RANGE', '날짜 계산 결과가 지원 범위(1000~9999년)를 벗어났습니다.');
    const value = new Date(day * DAY);
    return format(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  function offsetValue(offset) {
    if (!Number.isSafeInteger(offset)) fail('INVALID_OFFSET', '날짜 간격은 유한한 정수여야 합니다.');
    return offset;
  }
  function addDays(input, offset) { return fromDay(epochDay(input) + offsetValue(offset)); }
  function difference(from, to) { return epochDay(to) - epochDay(from); }
  function endOfMonth(input) {
    const [year, month] = normalize(input).split('-').map(Number);
    return format(year, month, daysInMonth(year, month));
  }
  function weekday(input) { return ((epochDay(input) + 4) % 7 + 7) % 7; }
  function isWeekend(input) { return [0, 6].includes(weekday(input)); }
  // Calendar inputs are copied/validated per operation, never cached or mutated.
  // isHoliday receives a canonical string; callers must supply a pure predicate.
  function calendarCheck(calendar = {}) {
    if (!calendar || typeof calendar !== 'object' || Array.isArray(calendar))
      fail('INVALID_CALENDAR', '휴일 달력 형식을 확인해 주세요.');
    const { holidays = [], weekendDays = [0, 6], isHoliday } = calendar;
    if (!Array.isArray(holidays) || !Array.isArray(weekendDays) ||
        weekendDays.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
        (isHoliday !== undefined && typeof isHoliday !== 'function'))
      fail('INVALID_CALENDAR', '휴일 달력 형식을 확인해 주세요.');
    const registered = new Set(holidays.map(normalize)), weekends = new Set(weekendDays);
    return value => weekends.has(weekday(value)) || registered.has(value) || Boolean(isHoliday?.(value));
  }
  function isHoliday(input, calendar) { return calendarCheck(calendar)(normalize(input)); }
  function limitValue(options = {}) {
    const value = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    if (!Number.isInteger(value) || value < 1 || value > MAX_ITERATIONS)
      fail('INVALID_LIMIT', `탐색 한도는 1~${MAX_ITERATIONS} 범위의 정수여야 합니다.`);
    return value;
  }
  function exhausted() { fail('ITERATION_LIMIT', '영업일 계산의 최대 탐색 횟수를 초과했습니다. 휴일 설정과 날짜 간격을 확인해 주세요.'); }
  function addBusinessDays(input, offset, calendar, options) {
    let value = normalize(input), remaining = Math.abs(offsetValue(offset));
    const limit = limitValue(options), closed = calendarCheck(calendar), direction = Math.sign(offset);
    if (remaining > limit) exhausted();
    for (let moves = 0; remaining > 0; moves++) {
      if (moves >= limit) exhausted();
      value = addDays(value, direction);
      if (!closed(value)) remaining--;
    }
    return value;
  }
  // Inclusive: an already open day stays put. Business offsets exclude the start.
  function shiftBusinessDay(input, direction, calendar, options) {
    let value = normalize(input);
    if (!['keep', 'prev', 'next'].includes(direction)) fail('INVALID_DIRECTION', '휴일 이동 방향을 확인해 주세요.');
    const limit = limitValue(options), closed = calendarCheck(calendar);
    if (direction === 'keep') return value;
    for (let moves = 0; closed(value); moves++) {
      if (moves >= limit) exhausted();
      value = addDays(value, direction === 'prev' ? -1 : 1);
    }
    return value;
  }
  return Object.freeze({ normalize, isValid, isLeapYear, daysInMonth, endOfMonth,
    addDays, difference, weekday, isWeekend, isHoliday, addBusinessDays, shiftBusinessDay,
    DEFAULT_MAX_ITERATIONS, MAX_ITERATIONS });
});
