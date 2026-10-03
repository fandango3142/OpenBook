const { loadBackend } = require('./gas-harness');

// Only the Google formatting boundary is faked; conversion code is production.
function installFormatDate(ctx) {
  const cache = {};
  ctx.Utilities.formatDate = function (instant, zone, pattern) {
    const formatter = cache[zone] || (cache[zone] = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
    const p = {};
    formatter.formatToParts(new Date(instant)).forEach(part => { p[part.type] = part.value; });
    const formats = {
      'yyyy-MM-dd': `${p.year}-${p.month}-${p.day}`,
      'HH:mm': `${p.hour}:${p.minute}`,
      "yyyy-MM-dd'T'HH:mm:ss": `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`,
    };
    if (!(pattern in formats)) throw new Error('Unsupported format: ' + pattern);
    return formats[pattern];
  };
  return ctx;
}
function timeContext() { return installFormatDate(loadBackend({}, ['Time.gs'])); }
function make(opts = {}) {
  const ctx = installFormatDate(loadBackend({
    config: { SPREADSHEET_ID: 'test-sheet' }, calendarEvents: opts.calendarEvents || {},
  }, ['SheetStore.gs', 'Schema.gs', 'Domain.gs', 'Time.gs', 'ServiceStore.gs',
    'AvailabilityStore.gs', 'Calendar.gs', 'Availability.gs']));
  ctx.Schema.ensureCurrent();
  const settings = Object.assign({ business_timezone: 'Asia/Kolkata', booking_calendar_id: 'bookings',
    conflict_calendar_ids: '["external"]', minimum_notice_hours: 0,
    booking_window_days: 90, slot_interval_minutes: 30 }, opts.settings);
  Object.keys(settings).forEach(k => ctx.SheetStore.setSetting(k, settings[k]));
  ctx.SheetStore.append('Services', Object.assign({ service_id: 'SRV_demo', name: 'Demo',
    description: '', duration_minutes: 30, buffer_before_minutes: 0,
    buffer_after_minutes: 0, capacity: 3, active: true }, opts.service));
  (opts.windows || [['Monday', '09:00', '12:00'], ['Monday', '14:00', '17:00']]).forEach((w, i) => {
    ctx.SheetStore.append('Availability', { availability_id: 'AV_' + i, service_id: 'SRV_demo',
      weekday: w[0], start_time: w[1], end_time: w[2], active: true });
  });
  return ctx;
}
const now = new Date('2026-10-02T00:00:00Z');
const query = { service_id: 'SRV_demo', start_at: '2026-10-05T00:00:00Z',
  end_at: '2026-10-06T00:00:00Z', now };
function check(ctx, start, extra) {
  return ctx.AvailabilityService.check(Object.assign({ service_id: 'SRV_demo', start_at: start,
    quantity: 1, now }, extra));
}
function booking(ctx, extra) {
  ctx.SheetStore.append('Bookings', Object.assign({ booking_id: 'BKG_1', service_id: 'SRV_demo',
    start_at: '2026-10-05T03:30:00Z', end_at: '2026-10-05T04:00:00Z',
    quantity: 1, status: 'CONFIRMED', calendar_event_id: '' }, extra));
}
function event(id, start, end, extra) {
  return Object.assign({ id, status: 'confirmed', start: { dateTime: start }, end: { dateTime: end } }, extra);
}
module.exports = { make, timeContext, installFormatDate, now, query, check, booking, event };
