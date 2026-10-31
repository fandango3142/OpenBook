/** Recurring windows and blocking exceptions are authoritative Sheet records. */
var AvailabilityStore = (function () {
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function active(row) {
    // Sheets checkboxes use booleans; text cells accept true/false in any case.
    // Whitespace, blanks and other values are configuration errors, not false.
    if (typeof row.active === 'boolean') return row.active;
    if (typeof row.active === 'string' && /^(true|false)$/i.test(row.active)) {
      return row.active.toLowerCase() === 'true';
    }
    throw new Error('Invalid active value');
  }

  function listWindows(serviceId) {
    var spreadsheetTimeZone = SheetStore.getSpreadsheetTimeZone();
    return SheetStore.readAll('Availability').filter(function (row) {
      return active(row) && row.service_id === serviceId;
    }).map(function (row) {
      // Sheets returns time-formatted cells as Date objects. Extract their
      // displayed wall clock using the Sheet timezone, then interpret that
      // clock in the business timezone when evaluating availability.
      var startTime = clockText(row.start_time, spreadsheetTimeZone);
      var endTime = clockText(row.end_time, spreadsheetTimeZone);
      var start = TimeService.clockMinutes(startTime);
      var end = TimeService.clockMinutes(endTime);
      // Overnight schedules must be entered as separate local-day windows.
      if (WEEKDAYS.indexOf(row.weekday) === -1 || start >= end) throw new Error('Invalid availability window');
      return { availability_id: row.availability_id, service_id: serviceId, weekday: row.weekday,
        start_time: startTime, end_time: endTime };
    });
  }

  function clockText(value, spreadsheetTimeZone) {
    if (Object.prototype.toString.call(value) !== '[object Date]') return value;
    if (isNaN(value.getTime()) || !spreadsheetTimeZone) throw new Error('Invalid availability time');
    return Utilities.formatDate(value, spreadsheetTimeZone, 'HH:mm');
  }

  function listExceptions(serviceId, start, end) {
    var from = TimeService.instant(start).getTime(), to = TimeService.instant(end).getTime();
    if (from >= to) throw new Error('Invalid exception query interval');
    return SheetStore.readAll('AvailabilityExceptions').filter(function (row) {
      return active(row) && (!row.service_id || row.service_id === serviceId);
    }).map(function (row) {
      var s = TimeService.instant(row.start_at), e = TimeService.instant(row.end_at);
      if (s >= e) throw new Error('Invalid exception interval');
      return { exception_id: row.exception_id, service_id: row.service_id,
        start_at: s.toISOString(), end_at: e.toISOString(), reason: row.reason || '' };
    }).filter(function (row) {
      return new Date(row.start_at).getTime() < to && from < new Date(row.end_at).getTime();
    });
  }
  return { listWindows: listWindows, listExceptions: listExceptions };
})();
