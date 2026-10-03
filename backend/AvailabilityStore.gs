/** Recurring windows and blocking exceptions are authoritative Sheet records. */
var AvailabilityStore = (function () {
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function active(row) { return row.active === true || String(row.active).toLowerCase() === 'true'; }

  function listWindows(serviceId) {
    return SheetStore.readAll('Availability').filter(function (row) {
      return row.service_id === serviceId && active(row);
    }).map(function (row) {
      var start = TimeService.clockMinutes(row.start_time);
      var end = TimeService.clockMinutes(row.end_time);
      // Overnight schedules must be entered as separate local-day windows.
      if (WEEKDAYS.indexOf(row.weekday) === -1 || start >= end) throw new Error('Invalid availability window');
      return { availability_id: row.availability_id, service_id: serviceId, weekday: row.weekday,
        start_time: row.start_time, end_time: row.end_time };
    });
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
