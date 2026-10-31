/** Stable public M1 actions. Internal exception messages never cross this boundary. */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function ensureApplicationReady() { return Schema.ensureCurrent(); }
function publicError(err) {
  var codes = ['VALIDATION_ERROR','SERVICE_INACTIVE','SLOT_UNAVAILABLE','INSUFFICIENT_CAPACITY',
    'MINIMUM_NOTICE','BOOKING_WINDOW','INVALID_TOKEN','INVALID_STATE','UNAUTHORIZED','RATE_LIMITED','LOCK_TIMEOUT'];
  var code = err && err.domainCode;
  if (codes.indexOf(code) === -1) { code = 'INTERNAL_ERROR'; Logger.log('PUBLIC_REQUEST_FAILED'); }
  return jsonResponse({ success: false, error: code });
}
function routePublic(data) {
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw BookingService.error('VALIDATION_ERROR');
    if (!rateLimitOk(data.action, data)) throw BookingService.error('RATE_LIMITED');
    switch (data.action) {
      case 'listServices': return handleListServices(data);
      case 'getAvailability': return handleGetAvailability(data);
      case 'createBooking': return handleCreateBooking(data);
      case 'getManagedBooking': return handleGetManagedBooking(data);
      case 'requestCancellation': return handleRequestCancellation(data);
      case 'requestReschedule': return handleRequestReschedule(data);
      default: return jsonResponse({ success: false, error: 'VALIDATION_ERROR' });
    }
  } catch (err) { return publicError(err); }
}
function doPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); }
  catch (err) { return jsonResponse({ success: false, error: 'VALIDATION_ERROR' }); }
  return routePublic(data);
}
function doGet(e) {
  var data = (e && e.parameter) || {};
  if (data.action === 'listServices' || data.action === 'getAvailability') return routePublic(data);
  return jsonResponse({ success: false, error: 'VALIDATION_ERROR' });
}
function handleListServices(data) {
  try {
    ensureApplicationReady();
    return jsonResponse({ success: true, services: ServiceStore.listActive().map(function (s) {
      return { service_id: s.service_id, name: s.name, description: s.description,
        duration_minutes: s.duration_minutes, capacity: s.capacity };
    }) });
  } catch (err) { return publicError(err); }
}
function handleGetAvailability(data) {
  try {
    ensureApplicationReady();
    // Ignore client-controlled now/exclude_booking_id.
    var request = { service_id: data.service_id, start_at: data.start_at, end_at: data.end_at, quantity: data.quantity };
    var slots;
    try { slots = AvailabilityService.listSlots(request); }
    catch (err) { if (err.message === 'VALIDATION_ERROR') throw BookingService.error('VALIDATION_ERROR'); throw err; }
    return jsonResponse({ success: true, slots: slots });
  } catch (err) { return publicError(err); }
}
function handleCreateBooking(data) {
  try {
    if (data.hp) throw BookingService.error('VALIDATION_ERROR');
    var result = BookingService.create(data, 'PUBLIC');
    return jsonResponse({ success: true, booking: result.booking, manage_token: result.manage_token });
  } catch (err) { return publicError(err); }
}
function handleGetManagedBooking(data) {
  try {
    if (typeof data.token !== 'string') throw BookingService.error('INVALID_TOKEN');
    var managed = BookingService.getManaged(data.token);
    return jsonResponse({ success: true, booking: managed.booking, actions: managed.actions });
  } catch (err) { return publicError(err); }
}
function handleRequestCancellation(data) {
  try {
    if (typeof data.token !== 'string') throw BookingService.error('INVALID_TOKEN');
    var result = BookingService.requestCancellation(data.token);
    return jsonResponse({ success: true, booking: result.booking });
  } catch (err) { return publicError(err); }
}
function handleRequestReschedule(data) {
  try {
    if (typeof data.token !== 'string' || typeof data.requested_start_at !== 'string') {
      throw BookingService.error('VALIDATION_ERROR');
    }
    var result = BookingService.requestReschedule(data.token, data.requested_start_at);
    return jsonResponse({ success: true, booking: result.booking });
  } catch (err) { return publicError(err); }
}

/** Installs the operational menu whenever the bound spreadsheet is opened. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('OpenBook')
    .addItem('Dashboard', 'showDashboard')
    .addItem('Run setup / migrations', 'runMigrationsFromMenu')
    .addToUi();
}

/** Authentication is checked server-side; every data RPC checks again as well. */
function showDashboard() {
  DashboardApi.authorize();
  var output = HtmlService.createHtmlOutputFromFile('Dashboard')
    .setWidth(1080).setHeight(760);
  SpreadsheetApp.getUi().showModalDialog(output, 'OpenBook Dashboard');
}

/** Explicitly reruns the idempotent schema migration for authorized operators. */
function runMigrationsFromMenu() {
  DashboardApi.authorize();
  var version = Schema.ensureCurrent();
  SpreadsheetApp.getUi().alert('OpenBook setup is current (schema version ' + version + ').');
  return version;
}
function rateBump(cache, key, limit, windowSec) {
  var n = parseInt(cache.get(key) || '0', 10);
  if (n >= limit) return false;
  cache.put(key, String(n + 1), windowSec);
  return true;
}
function rateLimitOk(action, data) {
  var cache = CacheService.getScriptCache();
  var cid = String(data.clientId || 'anon').slice(0,64);
  if (['createBooking', 'requestCancellation', 'requestReschedule'].indexOf(action) !== -1) {
    if (!rateBump(cache, 'rlw_' + cid, parseInt(Config.get('RATE_LIMIT_WRITE_PER_CLIENT'),10) || 15, 60)) return false;
    if (action === 'createBooking') {
      var customer = data.customer && typeof data.customer === 'object' ? data.customer : data;
      var email = typeof customer.email === 'string' ? customer.email.trim().toLowerCase().slice(0,254) : '';
      if (email && !rateBump(cache, 'rlwe_' + TokenService.hash(email), parseInt(Config.get('RATE_LIMIT_WRITE_PER_EMAIL'),10) || 10, 3600)) return false;
    }
    return rateBump(cache, 'rlw_global', parseInt(Config.get('RATE_LIMIT_WRITE_GLOBAL'),10) || 300, 60);
  }
  return rateBump(cache, 'rlr_' + cid, parseInt(Config.get('RATE_LIMIT_READ_PER_CLIENT'),10) || 120, 60);
}
