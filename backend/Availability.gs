/** Capacity-aware availability. Call check again under the mutation script lock. */
var AvailabilityService = (function () {
  var MINUTE = 60000, DAY = 86400000;
  var ACTIVE = ['CONFIRMED', 'CANCELLATION_REQUESTED', 'RESCHEDULE_REQUESTED'];

  function failure(code) { return { ok: false, code: code }; }

  function positiveInteger(value) {
    return (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' &&
      Number.isSafeInteger(Number(value)) && Number(value) > 0;
  }

  function settingNumber(name, fallback, minimum, integer) {
    var raw = SheetStore.getSetting(name);
    if (raw !== '' && ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '')) {
      throw new Error('Invalid ' + name);
    }
    var value = raw === '' ? fallback : Number(raw);
    if (!isFinite(value) || value < minimum || (integer && !Number.isSafeInteger(value))) throw new Error('Invalid ' + name);
    return value;
  }

  function settings() {
    var zone = SheetStore.getSetting('business_timezone');
    if (!zone) throw new Error('Invalid business_timezone');
    return { zone: zone, notice: settingNumber('minimum_notice_hours', 12, 0, false) * 3600000,
      horizon: settingNumber('booking_window_days', 90, 0, true) * DAY,
      interval: settingNumber('slot_interval_minutes', 15, 1, true) };
  }

  function requestValues(request, list) {
    try {
      if (!request || typeof request.service_id !== 'string' || !request.service_id) return null;
      var quantity = request.quantity === undefined ? 1 : request.quantity;
      if (!positiveInteger(quantity)) return null;
      var start = TimeService.instant(request.start_at).getTime();
      var end = list ? TimeService.instant(request.end_at).getTime() : null;
      var now = TimeService.instant(request.now === undefined ? new Date() : request.now).getTime();
      if (list && start >= end) return null;
      if (request.disambiguation !== undefined && ['reject', 'earlier', 'later'].indexOf(request.disambiguation) === -1) return null;
      return { start: start, end: end, now: now, quantity: Number(quantity) };
    } catch (e) { return null; }
  }

  function localWindow(date, window, zone) {
    try {
      var start = TimeService.localDateTimeToInstant(date, window.start_time, zone, 'earlier').getTime();
      var end = TimeService.localDateTimeToInstant(date, window.end_time, zone, 'later').getTime();
      var startMinute = TimeService.clockMinutes(window.start_time), endMinute = TimeService.clockMinutes(window.end_time);
      if (end - start === (endMinute - startMinute) * MINUTE) return [{ start: start, end: end }];
      // On a transition day the outer instants may enclose a repeated segment
      // outside the local schedule (e.g. 01:30 opening, then clocks fall to 01:00).
      // Split only these rare windows; ordinary dates use the direct fast path.
      var intervals = [], open = null;
      for (var at = start; at < end; at += MINUTE) {
        var local = TimeService.formatInZone(new Date(at), zone);
        var minute = TimeService.clockMinutes(local.time);
        if (local.date === date && startMinute <= minute && minute < endMinute) {
          if (open === null) open = at;
        } else if (open !== null) {
          intervals.push({ start: open, end: at });
          open = null;
        }
      }
      if (open !== null) intervals.push({ start: open, end: end });
      return intervals;
    } catch (e) {
      // A boundary inside a spring-forward gap cannot define a safe window.
      if (/nonexistent/.test(e.message)) return [];
      throw e;
    }
  }

  function overlaps(start, end, period) {
    return start < new Date(period.end_at).getTime() && new Date(period.start_at).getTime() < end;
  }

  function load(service, config, start, end) {
    var bookings = SheetStore.readAll('Bookings');
    var linked = bookings.filter(function (row) { return ACTIVE.indexOf(row.status) !== -1; })
      .map(function (row) { return row.calendar_event_id; }).filter(function (id) { return !!id; });
    return { service: service, config: config, windows: AvailabilityStore.listWindows(service.service_id), bookings: bookings,
      blocks: AvailabilityStore.listExceptions(service.service_id, new Date(start), new Date(end))
        .concat(CalendarGateway.listConflicts(new Date(start), new Date(end), linked)), windowCache: {} };
  }

  function windowsFor(data, start) {
    var local = TimeService.formatInZone(new Date(start), data.config.zone);
    if (!data.windowCache[local.date]) {
      data.windowCache[local.date] = data.windows.filter(function (window) { return window.weekday === local.weekday; })
        .reduce(function (result, window) { return result.concat(localWindow(local.date, window, data.config.zone)); }, []);
    }
    return data.windowCache[local.date];
  }

  function remainingCapacity(data, start, end, excludeId) {
    var service = data.service;
    var changes = [];
    data.bookings.forEach(function (row) {
      if (row.service_id !== service.service_id || (excludeId && row.booking_id === excludeId) || ACTIVE.indexOf(row.status) === -1) return;
      // Bad active rows fail closed instead of silently releasing reserved seats.
      var s = TimeService.instant(row.start_at).getTime() - service.buffer_before_minutes * MINUTE;
      var e = TimeService.instant(row.end_at).getTime() + service.buffer_after_minutes * MINUTE;
      if (TimeService.instant(row.start_at) >= TimeService.instant(row.end_at) || !positiveInteger(row.quantity)) throw new Error('Invalid active booking');
      var occupied = { status: row.status, start_at: new Date(s), end_at: new Date(e) };
      if (!Domain.consumesCapacity(occupied, new Date(start), new Date(end))) return;
      changes.push({ at: Math.max(start, s), delta: Number(row.quantity) });
      changes.push({ at: Math.min(end, e), delta: -Number(row.quantity) });
    });
    // Ends sort before starts: touching reservations never overlap.
    changes.sort(function (a, b) { return a.at - b.at || a.delta - b.delta; });
    var used = 0, peak = 0;
    changes.forEach(function (change) { used += change.delta; peak = Math.max(peak, used); });
    return Math.max(0, service.capacity - peak);
  }

  function evaluate(data, values, start, excludeId) {
    var service = data.service, config = data.config;
    var end = start + service.duration_minutes * MINUTE;
    if (start < values.now + config.notice) return failure('MINIMUM_NOTICE');
    if (start > values.now + config.horizon) return failure('BOOKING_WINDOW');
    var occupiedStart = start - service.buffer_before_minutes * MINUTE;
    var occupiedEnd = end + service.buffer_after_minutes * MINUTE;
    if (!windowsFor(data, start).some(function (window) { return window.start <= occupiedStart && occupiedEnd <= window.end; })) return failure('SLOT_UNAVAILABLE');
    if (data.blocks.some(function (period) { return overlaps(occupiedStart, occupiedEnd, period); })) return failure('SLOT_UNAVAILABLE');
    var remaining = remainingCapacity(data, occupiedStart, occupiedEnd, excludeId);
    if (remaining < values.quantity) return failure('INSUFFICIENT_CAPACITY');
    return { ok: true, end_at: new Date(end).toISOString(), remaining_capacity: remaining - values.quantity };
  }

  function check(request) {
    var values = requestValues(request, false);
    if (!values) return failure('VALIDATION_ERROR');
    var service = ServiceStore.getById(request.service_id);
    if (!service || !service.active) return failure('SERVICE_INACTIVE');
    var config = settings();
    if (values.start < values.now + config.notice) return failure('MINIMUM_NOTICE');
    if (values.start > values.now + config.horizon) return failure('BOOKING_WINDOW');
    var data = load(service, config, values.start - service.buffer_before_minutes * MINUTE,
      values.start + (service.duration_minutes + service.buffer_after_minutes) * MINUTE);
    return evaluate(data, values, values.start, request.exclude_booking_id);
  }

  function listSlots(request) {
    var values = requestValues(request, true);
    if (!values) throw new Error('VALIDATION_ERROR');
    var service = ServiceStore.getById(request.service_id);
    if (!service || !service.active) return [];
    var config = settings();
    var start = Math.max(values.start, values.now + config.notice);
    var end = Math.min(values.end, values.now + config.horizon + 1);
    if (start >= end) return [];
    var data = load(service, config, start - service.buffer_before_minutes * MINUTE,
      end + (service.duration_minutes + service.buffer_after_minutes) * MINUTE);
    var first = TimeService.civilDate(TimeService.formatInZone(new Date(start), config.zone).date).getTime();
    var last = TimeService.civilDate(TimeService.formatInZone(new Date(end - 1), config.zone).date).getTime();
    var slots = [], seen = {};
    for (var day = first; day <= last; day += DAY) {
      var date = new Date(day).toISOString().slice(0, 10);
      var weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(day).getUTCDay()];
      data.windows.filter(function (window) { return window.weekday === weekday; }).forEach(function (window) {
        for (var minute = TimeService.clockMinutes(window.start_time); minute < TimeService.clockMinutes(window.end_time); minute += config.interval) {
          var localTime = ('0' + Math.floor(minute / 60)).slice(-2) + ':' + ('0' + minute % 60).slice(-2);
          var candidate;
          try { candidate = TimeService.localDateTimeToInstant(date, localTime, config.zone, request.disambiguation || 'reject').getTime(); }
          catch (e) { if (/nonexistent|ambiguous/.test(e.message)) continue; throw e; }
          if (candidate < start || candidate >= end || candidate + service.duration_minutes * MINUTE > values.end || seen[candidate]) continue;
          seen[candidate] = true;
          var result = evaluate(data, values, candidate, request.exclude_booking_id);
          if (result.ok) slots.push({ start_at: new Date(candidate).toISOString(), end_at: result.end_at,
            remaining_capacity: result.remaining_capacity + values.quantity });
        }
      });
    }
    return slots.sort(function (a, b) { return a.start_at < b.start_at ? -1 : a.start_at > b.start_at ? 1 : 0; });
  }

  return { listSlots: listSlots, check: check };
})();
