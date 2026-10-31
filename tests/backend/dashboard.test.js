const assert = require('assert');
const { loadBackend } = require('./gas-harness');
const { installFormatDate } = require('./availability-fixture');
const { createRunner } = require('./_runner');
const r = require.main === module ? createRunner('Authorized booking dashboard API') : { test: function () {} };

function makeCtx(opts = {}) {
  const files = ['SheetStore.gs','Schema.gs','Domain.gs','Time.gs','ServiceStore.gs','AvailabilityStore.gs',
    'Calendar.gs','Availability.gs','Token.gs','Booking.gs','CustomerStore.gs','BookingService.gs','Dashboard.gs'];
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


if (require.main === module) process.exit(r.done() === 0 ? 0 : 1);
module.exports = { makeCtx };
