const assert=require('assert');
const {makeCtx,cmd}=require('./booking-service.test');
const {parseResponse}=require('./gas-harness');
const {createRunner}=require('./_runner');
const r=createRunner('M1 per-client and per-email rate limits');
function ctx(config={}){return makeCtx({config:Object.assign({SPREADSHEET_ID:'test',RATE_LIMIT_WRITE_PER_CLIENT:'3',RATE_LIMIT_READ_PER_CLIENT:'10',RATE_LIMIT_WRITE_GLOBAL:'100'},config)});}
function post(c,d){return parseResponse(c.doPost({postData:{contents:JSON.stringify(d)}}));}
function write(i,clientId='A',email='sam@example.com'){return Object.assign(cmd({start_at:new Date(new Date(cmd().start_at).getTime()+i*1800000).toISOString(),email}),{action:'createBooking',clientId});}
r.test('read budget exceeds writes and remains independent',()=>{
  const c=ctx(); for(let i=0;i<3;i++) assert.strictEqual(post(c,write(i)).success,true);
  assert.strictEqual(post(c,write(3)).error,'RATE_LIMITED');
  for(let i=0;i<10;i++) assert.strictEqual(post(c,{action:'listServices',clientId:'A'}).success,true);
  assert.strictEqual(post(c,{action:'listServices',clientId:'A'}).error,'RATE_LIMITED');
  assert.strictEqual(post(c,write(4,'B')).success,true);
});
r.test('normalizes email caps across rotated client IDs without cache PII',()=>{
  const c=ctx({RATE_LIMIT_WRITE_PER_EMAIL:'2'});
  assert.strictEqual(post(c,write(0,'A','Sam@Example.com')).success,true);
  assert.strictEqual(post(c,write(1,'B',' sam@example.com ')).success,true);
  assert.strictEqual(post(c,write(2,'C')).error,'RATE_LIMITED');
  assert.strictEqual(post(c,write(3,'D','other@example.com')).success,true);
  assert.ok(!JSON.stringify(c._cacheStore).includes('sam@example.com'));
});
r.test('global write backstop bounds rotating clients',()=>{
  const c=ctx({RATE_LIMIT_WRITE_GLOBAL:'2'});
  assert.strictEqual(post(c,write(0,'A')).success,true);assert.strictEqual(post(c,write(1,'B')).success,true);
  assert.strictEqual(post(c,write(2,'C')).error,'RATE_LIMITED');
});
process.exit(r.done()===0?0:1);
