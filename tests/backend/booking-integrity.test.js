const assert=require('assert');
const {makeCtx,cmd}=require('./booking-service.test');
const {createRunner}=require('./_runner');
const r=createRunner('Booking store integrity');
r.test('header reordering preserves reads, writes and append-only events',()=>{
  const ctx=makeCtx();
  ['Bookings','Customers','BookingEvents'].forEach(name=>ctx._sheets[name].rows[0].reverse());
  const result=ctx.BookingService.create(cmd(),'PUBLIC');
  const booking=ctx.BookingStore.getById(result.booking.booking_id);
  assert.strictEqual(booking.customer_name_snapshot,'Sam Student'); assert.strictEqual(booking.status,'CONFIRMED');
  const before=JSON.stringify(ctx.SheetStore.readAll('BookingEvents'));
  ctx.BookingStore.appendEvent({event_id:'EVT_extra',booking_id:booking.booking_id,event_type:'OBSERVED',actor:'SYSTEM',timestamp:'2026-10-31T00:00:00Z',metadata_json:'{}'});
  assert.strictEqual(JSON.stringify(ctx.SheetStore.readAll('BookingEvents').slice(0,2)),before);
});
r.test('active queries retain pending requests but exclude cancelled and touching bookings',()=>{
  const ctx=makeCtx(); const start=cmd().start_at; const end=new Date(new Date(start).getTime()+1800000).toISOString();
  ['CONFIRMED','CANCELLATION_REQUESTED','RESCHEDULE_REQUESTED','CANCELLED'].forEach((status,i)=>ctx.BookingStore.create({booking_id:'BKG_'+i,service_id:'SRV_demo',start_at:start,end_at:end,status,quantity:1}));
  assert.strictEqual(ctx.BookingStore.listActive(start,end,'SRV_demo').length,3);
  assert.strictEqual(ctx.BookingStore.listActive(end,new Date(new Date(end).getTime()+1800000).toISOString(),'SRV_demo').length,0);
  assert.strictEqual(ctx.BookingStore.listActive(start,end,'other').length,0);
  assert.strictEqual(ctx.BookingStore.getByTokenHash(''),null);
});
process.exit(r.done()===0?0:1);
