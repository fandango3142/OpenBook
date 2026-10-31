/** Spreadsheet-bound RPC boundary. Authentication is checked on every call. */
var DashboardApi = (function () {
  function authorize() {
    var email = '';
    try { email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase(); }
    catch (e) { email = ''; }
    if (!email || email.length > 254) throw BookingService.error('UNAUTHORIZED');

    var raw;
    try { raw = SheetStore.getSetting('authorized_dashboard_users'); }
    catch (settingError) { throw BookingService.error('UNAUTHORIZED'); }
    var allowed;
    try {
      allowed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (parseError) { throw BookingService.error('UNAUTHORIZED'); }
    if (!Array.isArray(allowed) || !allowed.some(function (candidate) {
      return typeof candidate === 'string' && candidate.trim().toLowerCase() === email;
    })) throw BookingService.error('UNAUTHORIZED');
    return email;
  }

  function listBookings() {
    authorize();
    Schema.ensureCurrent();
    return SheetStore.readAll('Bookings').sort(function (a, b) {
      return String(a.start_at || '').localeCompare(String(b.start_at || ''));
    }).map(function (row) {
      return { booking_id: row.booking_id, service_id: row.service_id,
        service_name: row.service_name_snapshot, customer_name: row.customer_name_snapshot,
        customer_email: row.customer_email_snapshot, customer_phone: row.customer_phone_snapshot,
        start_at: row.start_at, end_at: row.end_at, quantity: row.quantity, status: row.status };
    });
  }
  function listServices() {
    authorize();
    Schema.ensureCurrent();
    return ServiceStore.listActive().map(function (service) {
      return { service_id: service.service_id, name: service.name,
        duration_minutes: service.duration_minutes, capacity: service.capacity };
    });
  }
  function getBusinessTimezone() {
    authorize();
    Schema.ensureCurrent();
    return String(SheetStore.getSetting('business_timezone') || 'UTC');
  }
  function createManualBooking(command) {
    var actor = authorize();
    return BookingService.create(command, actor);
  }
  function rescheduleBooking(bookingId, replacement) {
    var actor = authorize();
    return BookingService.reschedule(bookingId, replacement, actor);
  }
  function cancelBooking(bookingId) {
    var actor = authorize();
    return BookingService.cancel(bookingId, actor);
  }
  function approveCancellation(bookingId) {
    var actor = authorize();
    return BookingService.approveCancellation(bookingId, actor);
  }
  function rejectCancellation(bookingId) {
    var actor = authorize();
    return BookingService.rejectCancellation(bookingId, actor);
  }
  function markCompleted(bookingId) {
    var actor = authorize();
    return BookingService.markCompleted(bookingId, actor);
  }
  function markNoShow(bookingId) {
    var actor = authorize();
    return BookingService.markNoShow(bookingId, actor);
  }

  function createAvailabilityException(command) {
    authorize();
    if (!command || typeof command !== 'object' || Array.isArray(command) ||
        typeof command.service_id !== 'string' || typeof command.start_at !== 'string' ||
        typeof command.end_at !== 'string' || typeof command.reason !== 'string' ||
        command.reason.length > 500) throw BookingService.error('VALIDATION_ERROR');
    var start, end;
    try {
      start = TimeService.instant(command.start_at);
      end = TimeService.instant(command.end_at);
    } catch (e) { throw BookingService.error('VALIDATION_ERROR'); }
    if (start >= end) throw BookingService.error('VALIDATION_ERROR');
    var serviceId = command.service_id.trim();
    Schema.ensureCurrent();
    return LockGateway.withLock(10000, function () {
      if (serviceId && !ServiceStore.getById(serviceId)) throw BookingService.error('VALIDATION_ERROR');
      var exception = { exception_id: Domain.newId('EXC'), service_id: serviceId,
        start_at: start.toISOString(), end_at: end.toISOString(), reason: command.reason.trim(), active: true };
      var affected = BookingStore.listActive(exception.start_at, exception.end_at, serviceId).map(function (row) {
        return { booking_id: row.booking_id, service_id: row.service_id,
          service_name: row.service_name_snapshot, customer_name: row.customer_name_snapshot,
          customer_email: row.customer_email_snapshot, start_at: row.start_at,
          end_at: row.end_at, quantity: row.quantity, status: row.status };
      });
      SheetStore.append('AvailabilityExceptions', exception);
      SpreadsheetApp.flush();
      return { exception: exception, affected_bookings: affected };
    });
  }

  return { authorize: authorize, listBookings: listBookings, createManualBooking: createManualBooking,
    rescheduleBooking: rescheduleBooking, cancelBooking: cancelBooking,
    approveCancellation: approveCancellation, rejectCancellation: rejectCancellation,
    markCompleted: markCompleted, markNoShow: markNoShow, listServices: listServices,
    getBusinessTimezone: getBusinessTimezone, createAvailabilityException: createAvailabilityException };
})();
