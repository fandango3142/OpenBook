const assert = require('assert');
const { loadBackend } = require('./gas-harness');
const { installFormatDate } = require('./availability-fixture');
const { createRunner } = require('./_runner');
const r = require.main === module ? createRunner('Locked booking transaction') : { test: function () {} };
function makeCtx(opts = {}) {
  const files = ['SheetStore.gs','Schema.gs','Domain.gs','Time.gs','ServiceStore.gs','AvailabilityStore.gs','Calendar.gs','Availability.gs','Token.gs','Booking.gs','CustomerStore.gs','BookingService.gs','Code.gs'];
  const ctx = installFormatDate(loadBackend(Object.assign({ config: { SPREADSHEET_ID: 'test' } }, opts), files));
  ctx.Schema.ensureCurrent();
  Object.entries({business_timezone:'Asia/Kolkata',booking_calendar_id:'bookings',conflict_calendar_ids:'["bookings"]',minimum_notice_hours:0,booking_window_days:90,slot_interval_minutes:30}).forEach(([k,v]) => ctx.SheetStore.setSetting(k,v));
  ctx.SheetStore.append('Services',{service_id:'SRV_demo',name:'Demo',duration_minutes:30,buffer_before_minutes:0,buffer_after_minutes:0,capacity:3,active:true});
  ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].forEach((day,i) => ctx.SheetStore.append('Availability',{availability_id:'AV_'+i,service_id:'SRV_demo',weekday:day,start_time:'09:00',end_time:'17:00',active:true}));
  return ctx;
}
function cmd(extra = {}) {
  const day = new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  return Object.assign({service_id:'SRV_demo',start_at:day+'T03:30:00Z',quantity:1,name:'Sam Student',email:'sam@example.com',phone:'123'},extra);
}
r.test('allows bookings up to capacity and rejects the next request during Calendar lag',() => {
  const ctx=makeCtx();
  assert.strictEqual(typeof ctx.BookingService, 'object');
  assert.strictEqual(ctx.BookingService.create(cmd({quantity:2}),'PUBLIC').booking.quantity,2);
  ctx.BookingService.create(cmd(),'PUBLIC');
  assert.throws(()=>ctx.BookingService.create(cmd(),'PUBLIC'),/INSUFFICIENT_CAPACITY/);
  assert.strictEqual(ctx._createdEvents.length,2);
});
r.test('omitted quantity reserves the default one seat rather than a malformed reservation',()=>{
  const ctx=makeCtx(); const command=cmd(); delete command.quantity;
  const result=ctx.BookingService.create(command,'PUBLIC');
  assert.strictEqual(result.booking.quantity,1);
  assert.strictEqual(ctx.BookingStore.getById(result.booking.booking_id).quantity,1);
});
r.test('schema lock contention returns the stable lock timeout domain code',()=>{
  const ctx=makeCtx(); ctx.LockService.getScriptLock=()=>({tryLock:()=>false});
  assert.throws(()=>ctx.BookingService.create(cmd(),'PUBLIC'),err=>err.domainCode==='LOCK_TIMEOUT');
});
r.test('reloads competing bookings after lock acquisition and flushes before release',() => {
  let enabled=false, attempts=0;
  const ctx=makeCtx({onLock:s => {if(enabled && ++attempts === 2) s.SheetStore.append('Bookings',{booking_id:'BKG_competing',service_id:'SRV_demo',start_at:cmd().start_at,end_at:new Date(new Date(cmd().start_at).getTime()+1800000).toISOString(),quantity:3,status:'CONFIRMED'});}});
  enabled=true;
  assert.throws(()=>ctx.BookingService.create(cmd(),'PUBLIC'),/INSUFFICIENT_CAPACITY/);
  assert.deepStrictEqual(ctx._operationOrder.slice(-2),['flush','unlock']);
});
r.test('deletes Calendar event when the booking append fails',() => {
  const ctx=makeCtx(); ctx._failAppendFor.push('Bookings');
  assert.throws(()=>ctx.BookingService.create(cmd(),'PUBLIC'),/append failed/);
  assert.strictEqual(ctx._createdEvents[0]._deleted,true);
  assert.strictEqual(ctx.SheetStore.readAll('Bookings').length,0);
});
r.test('email delivery failure preserves confirmed booking and occurs after unlock',() => {
  const ctx=makeCtx({emailFailure:true});
  const result=ctx.BookingService.create(cmd(),'PUBLIC');
  assert.strictEqual(ctx.BookingStore.getById(result.booking.booking_id).status,'CONFIRMED');
  assert.strictEqual(ctx._createdEvents[0]._deleted,false);
  assert.deepStrictEqual(ctx._operationOrder.slice(-3),['flush','unlock','email']);
});
r.test('persists generated identities, snapshots, hashes and lifecycle events without private free text',() => {
  const ctx=makeCtx();
  const result=ctx.BookingService.create(cmd({email:' SAM@Example.COM ',purpose:'secret purpose',notes:'secret notes'}),'PUBLIC');
  const booking=ctx.BookingStore.getById(result.booking.booking_id);
  assert.match(booking.booking_id,/^BKG_/); assert.match(booking.customer_id,/^CUS_/);
  assert.strictEqual(booking.customer_email_snapshot,'sam@example.com');
  assert.strictEqual(booking.manage_token_hash,ctx.TokenService.hash(result.manage_token));
  assert.strictEqual(ctx.BookingStore.getByTokenHash(booking.manage_token_hash).booking_id,booking.booking_id);
  assert.strictEqual(ctx.BookingStore.listActive(booking.start_at,booking.end_at,'SRV_demo').length,1);
  assert.deepStrictEqual(Array.from(ctx.SheetStore.readAll('BookingEvents'),e=>e.event_type),['BOOKING_CREATED','BOOKING_CONFIRMED']);
  assert.deepStrictEqual(Array.from(ctx.SheetStore.readAll('BookingEvents'),e=>e.actor),['PUBLIC','SYSTEM']);
  const durable=JSON.stringify(Object.values(ctx._sheets).map(s=>s.rows));
  [result.manage_token,'secret purpose','secret notes'].forEach(secret=>assert.ok(!durable.includes('"'+secret+'"')));
  assert.ok(!JSON.stringify(result.booking).includes('manage_token_hash'));
  assert.ok(!JSON.stringify(ctx._createdEvents).includes(result.manage_token));
  ctx.BookingService.create(cmd({email:'sam@example.com'}),'PUBLIC');
  assert.strictEqual(ctx.SheetStore.readAll('Customers').length,1);
});
if(require.main===module) process.exit(r.done()===0?0:1);
module.exports={makeCtx,cmd};
