const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadBackend } = require('./gas-harness');
const { installFormatDate } = require('./availability-fixture');
const { createRunner } = require('./_runner');
const r = require.main === module ? createRunner('Authorized booking dashboard API') : { test: function () {} };

function makeCtx(opts = {}) {
  const files = ['SheetStore.gs','Schema.gs','Domain.gs','Time.gs','ServiceStore.gs','AvailabilityStore.gs',
    'Calendar.gs','Availability.gs','Token.gs','Booking.gs','CustomerStore.gs','BookingService.gs','Dashboard.gs','Code.gs'];
  const ctx = installFormatDate(loadBackend(Object.assign({ config: { SPREADSHEET_ID: 'test' } }, opts), files));
  ctx.Schema.ensureCurrent();
  Object.entries({business_timezone:'Asia/Kolkata',booking_calendar_id:'bookings',conflict_calendar_ids:'["bookings"]',
    minimum_notice_hours:0,booking_window_days:90,slot_interval_minutes:30,authorized_dashboard_users:'["owner@example.com"]'})
    .forEach(([k,v]) => ctx.SheetStore.setSetting(k,v));
  ctx.SheetStore.append('Services',{service_id:'SRV_demo',name:'Demo',duration_minutes:30,
    buffer_before_minutes:0,buffer_after_minutes:0,capacity:3,active:true});
  ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].forEach((day,i) =>
    ctx.SheetStore.append('Availability',{availability_id:'AV_'+i,service_id:'SRV_demo',weekday:day,
      start_time:'09:00',end_time:'17:00',active:true}));
  ctx._activeEmail = 'owner@example.com';
  return ctx;
}

r.test('every google.script.run dashboard RPC is exported as a top-level GAS function', () => {
  const ctx = makeCtx();
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'Dashboard.html'), 'utf8');
  const rpcNames = ['listBookings','listServices','getBusinessTimezone','createManualBooking',
    'createAvailabilityException','rescheduleBooking','cancelBooking','approveCancellation',
    'rejectCancellation','markCompleted','markNoShow'];
  rpcNames.forEach(name => {
    assert.ok(html.includes("'" + name + "'"), 'dashboard HTML does not call ' + name);
    assert.strictEqual(typeof ctx[name], 'function', name + ' must be a global Apps Script RPC');
  });
});

r.test('dashboard read fails closed before reading booking or customer data when identity is blank', () => {
  const ctx = makeCtx();
  ctx._activeEmail = '';
  const reads = [];
  const readAll = ctx.SheetStore.readAll;
  ctx.SheetStore.readAll = name => { reads.push(name); return readAll(name); };
  assert.throws(() => ctx.DashboardApi.listBookings(), e => e.domainCode === 'UNAUTHORIZED');
  assert.strictEqual(reads.includes('Bookings'), false);
  assert.strictEqual(reads.includes('Customers'), false);
});

r.test('dashboard allowlist is normalized and manual booking uses the authorized actor', () => {
  const ctx = makeCtx();
  ctx.SheetStore.setSetting('authorized_dashboard_users', '[" OWNER@EXAMPLE.COM "]');
  ctx._activeEmail = 'Owner@Example.com';
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0,10);
  const result = ctx.DashboardApi.createManualBooking({
    service_id: 'SRV_demo', start_at: day + 'T03:30:00.000Z', quantity: 1,
    customer: { name: 'Owner test', email: 'owner-test@example.com' }, actor: 'spoof@example.com',
  });
  assert.match(result.booking.booking_id, /^BKG_/);
  assert.strictEqual(ctx.SheetStore.readAll('BookingEvents')[0].actor, 'owner@example.com');
});

r.test('dashboard booking data omits token hashes and Calendar identifiers', () => {
  const ctx = makeCtx();
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0,10);
  const result = ctx.BookingService.create({ service_id: 'SRV_demo', start_at: day + 'T03:30:00.000Z',
    quantity: 1, name: 'Private Customer', email: 'private@example.com' }, 'PUBLIC');
  const record = ctx.BookingStore.getById(result.booking.booking_id);
  const rows = ctx.DashboardApi.listBookings();
  assert.strictEqual(rows[0].booking_id, record.booking_id);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(rows[0], 'manage_token_hash'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(rows[0], 'calendar_event_id'), false);
});

r.test('unauthorized dashboard mutation leaves the booking unchanged', () => {
  const ctx = makeCtx();
  ctx._activeEmail = 'viewer@example.com';
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0,10);
  const created = ctx.BookingService.create({ service_id: 'SRV_demo', start_at: day + 'T03:30:00.000Z',
    quantity: 1, name: 'Customer', email: 'customer@example.com' }, 'PUBLIC');
  const before = ctx.BookingStore.getById(created.booking.booking_id);
  assert.throws(() => ctx.DashboardApi.cancelBooking(before.booking_id), e => e.domainCode === 'UNAUTHORIZED');
  assert.strictEqual(ctx.BookingStore.getById(before.booking_id).status, 'CONFIRMED');
  assert.strictEqual(ctx._createdEvents[0]._deleted, false);
});

r.test('every dashboard read and mutation fails closed when the identity is outside the allowlist', () => {
  const ctx = makeCtx();
  ctx._activeEmail = 'viewer@example.com';
  const calls = [
    () => ctx.DashboardApi.listBookings(), () => ctx.DashboardApi.listServices(),
    () => ctx.DashboardApi.getBusinessTimezone(),
    () => ctx.DashboardApi.createManualBooking({}), () => ctx.DashboardApi.rescheduleBooking('BKG_1', {}),
    () => ctx.DashboardApi.cancelBooking('BKG_1'), () => ctx.DashboardApi.approveCancellation('BKG_1'),
    () => ctx.DashboardApi.rejectCancellation('BKG_1'), () => ctx.DashboardApi.markCompleted('BKG_1'),
    () => ctx.DashboardApi.markNoShow('BKG_1'),
    () => ctx.DashboardApi.createAvailabilityException({}),
  ];
  calls.forEach(call => assert.throws(call, e => e.domainCode === 'UNAUTHORIZED'));
  assert.strictEqual(ctx.SheetStore.readAll('AvailabilityExceptions').length, 0);
});

r.test('onOpen installs the dashboard and migration menu actions', () => {
  const ctx = makeCtx();
  const items = [];
  const menu = { addItem: (label, handler) => { items.push([label, handler]); return menu; }, addToUi: () => menu };
  ctx.SpreadsheetApp.getUi = () => ({ createMenu: name => { assert.strictEqual(name, 'OpenBook'); return menu; } });
  ctx.onOpen();
  assert.deepStrictEqual(items, [['Dashboard', 'showDashboard'], ['Run setup / migrations', 'runMigrationsFromMenu']]);
});

r.test('dashboard dialog is served as the bound HTML file', () => {
  const ctx = makeCtx();
  let shown = null;
  const html = { setWidth: width => { html.width = width; return html; }, setHeight: height => { html.height = height; return html; } };
  ctx.HtmlService = { createHtmlOutputFromFile: name => { html.name = name; return html; } };
  ctx.SpreadsheetApp.getUi = () => ({ showModalDialog: (output, title) => { shown = { output, title }; } });
  ctx.showDashboard();
  assert.strictEqual(shown.output.name, 'Dashboard');
  assert.strictEqual(shown.title, 'OpenBook Dashboard');
});

r.test('migration menu action runs idempotent setup only for an authorized operator', () => {
  const ctx = makeCtx();
  ctx.SpreadsheetApp.getUi = () => ({ alert: message => { ctx._alert = message; } });
  assert.strictEqual(ctx.runMigrationsFromMenu(), ctx.Schema.CURRENT_VERSION);
  assert.match(ctx._alert, /schema version/);
  ctx._activeEmail = 'intruder@example.com';
  assert.throws(() => ctx.runMigrationsFromMenu(), e => e.domainCode === 'UNAUTHORIZED');
});

r.test('availability exception returns overlapping active bookings without changing states or Calendar events', () => {
  const ctx = makeCtx();
  const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0,10);
  const created = ctx.BookingService.create({ service_id: 'SRV_demo', start_at: day + 'T03:30:00.000Z',
    quantity: 1, name: 'Customer', email: 'customer@example.com' }, 'PUBLIC');
  const bookingId = created.booking.booking_id;
  const before = ctx.BookingStore.getById(bookingId);
  const event = ctx._createdEvents.find(item => item.id === before.calendar_event_id);
  const result = ctx.DashboardApi.createAvailabilityException({ service_id: 'SRV_demo',
    start_at: before.start_at, end_at: before.end_at, reason: 'Operator block' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.affected_bookings.map(b => b.booking_id))), [bookingId]);
  assert.strictEqual(result.exception.active, true);
  assert.strictEqual(ctx.BookingStore.getById(bookingId).status, 'CONFIRMED');
  assert.strictEqual(event._deleted, false);
  assert.strictEqual(ctx.SheetStore.readAll('AvailabilityExceptions').length, 1);
});

r.test('unauthorized dashboard exception fails before writing', () => {
  const ctx = makeCtx();
  ctx._activeEmail = 'intruder@example.com';
  assert.throws(() => ctx.DashboardApi.createAvailabilityException({ service_id: '',
    start_at: '2030-01-01T10:00:00Z', end_at: '2030-01-01T11:00:00Z' }), e => e.domainCode === 'UNAUTHORIZED');
  assert.strictEqual(ctx.SheetStore.readAll('AvailabilityExceptions').length, 0);
});


if (require.main === module) process.exit(r.done() === 0 ? 0 : 1);
module.exports = { makeCtx };
