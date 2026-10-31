const assert=require('assert');
const {makeCtx,cmd}=require('./booking-service.test');
const {parseResponse}=require('./gas-harness');
const {createRunner}=require('./_runner');
const r=createRunner('M1 public handlers');
function post(ctx,data){return parseResponse(ctx.doPost({postData:{contents:JSON.stringify(data)}}));}
r.test('lists services and availability through stable actions',()=>{
  const ctx=makeCtx();
  const services=post(ctx,{action:'listServices'});
  assert.strictEqual(services.success,true); assert.strictEqual(services.services[0].service_id,'SRV_demo');
  const slots=post(ctx,Object.assign(cmd(),{action:'getAvailability',end_at:new Date(new Date(cmd().start_at).getTime()+3600000).toISOString()}));
  assert.strictEqual(slots.success,true); assert.strictEqual(slots.slots.length,2);
});
r.test('creates a booking and returns only public fields and the one-time token',()=>{
  const ctx=makeCtx(); const result=post(ctx,Object.assign(cmd(),{action:'createBooking',end_at:'2099-01-01',duration_minutes:999}));
  assert.strictEqual(result.success,true); assert.ok(result.manage_token);
  assert.strictEqual(new Date(result.booking.end_at)-new Date(result.booking.start_at),1800000);
  ['customer_id','calendar_event_id','manage_token_hash','customer_email_snapshot'].forEach(k=>assert.ok(!(k in result.booking)));
});
r.test('accepts the approved nested customer booking payload',()=>{
  const ctx=makeCtx(); const input=cmd();
  const result=post(ctx,{action:'createBooking',service_id:input.service_id,start_at:input.start_at,quantity:input.quantity,
    customer:{name:input.name,email:input.email,phone:input.phone},hp:''});
  assert.strictEqual(result.success,true);
  assert.strictEqual(ctx.BookingStore.getById(result.booking.booking_id).customer_email_snapshot,input.email);
});
r.test('GET requests cannot create bookings',()=>{
  const ctx=makeCtx(); const input=cmd();
  const result=parseResponse(ctx.doGet({parameter:Object.assign({action:'createBooking'},input)}));
  assert.strictEqual(result.error,'VALIDATION_ERROR');
  assert.strictEqual(ctx.BookingStore.listActive(input.start_at,new Date(new Date(input.start_at).getTime()+1800000).toISOString(),'SRV_demo').length,0);
});
r.test('maps domain capacity errors and leaves Sheets authoritative after Calendar deletion',()=>{
  const ctx=makeCtx(); const data=Object.assign(cmd({quantity:3}),{action:'createBooking'});
  assert.strictEqual(post(ctx,data).success,true); ctx._createdEvents[0]._deleted=true;
  assert.strictEqual(post(ctx,data).error,'INSUFFICIENT_CAPACITY');
});
r.test('honeypot and invalid contact values cause no booking side effects',()=>{
  for(const extra of [{hp:'bot'},{email:'invalid'},{name:' '},{name:'a'.repeat(161)},{phone:42}]){
    const ctx=makeCtx(); assert.strictEqual(post(ctx,Object.assign(cmd(extra),{action:'createBooking'})).error,'VALIDATION_ERROR');
    assert.strictEqual(ctx._createdEvents.length,0); assert.strictEqual(ctx.SheetStore.readAll('Customers').length,0);
  }
});
r.test('unexpected exceptions never expose messages or stack traces',()=>{
  const ctx=makeCtx(); ctx._failAppendFor.push('Bookings');
  assert.deepStrictEqual(post(ctx,Object.assign(cmd(),{action:'createBooking'})),{success:false,error:'INTERNAL_ERROR'});
});
r.test('rejects malformed JSON, null bodies and retired actions',()=>{
  const ctx=makeCtx();
  for(const data of [null,[],{action:'rescheduleBooking'},{action:'reconcile'}]) assert.strictEqual(post(ctx,data).error,'VALIDATION_ERROR');
  assert.strictEqual(parseResponse(ctx.doPost({postData:{contents:'{'}})).error,'VALIDATION_ERROR');
});
r.test('maps lock denial and service inactivity to stable errors',()=>{
  const ctx=makeCtx(); ctx.SheetStore.updateById('Services','service_id','SRV_demo',{active:false});
  assert.strictEqual(post(ctx,Object.assign(cmd(),{action:'createBooking'})).error,'SERVICE_INACTIVE');
  ctx.Schema.ensureCurrent=()=>{}; ctx.LockService.getScriptLock=()=>({tryLock:()=>false});
  assert.strictEqual(post(ctx,Object.assign(cmd(),{action:'createBooking'})).error,'LOCK_TIMEOUT');
});
r.test('does not trust caller clock or booking exclusion to bypass capacity',()=>{
  const ctx=makeCtx(); const first=post(ctx,Object.assign(cmd({quantity:3}),{action:'createBooking'}));
  const result=post(ctx,Object.assign(cmd(),{action:'createBooking',exclude_booking_id:first.booking.booking_id,now:'1900-01-01T00:00:00Z'}));
  assert.strictEqual(result.error,'INSUFFICIENT_CAPACITY');
});
process.exit(r.done()===0?0:1);
