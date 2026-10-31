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
    });
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

  return { authorize: authorize, listBookings: listBookings, createManualBooking: createManualBooking,
    rescheduleBooking: rescheduleBooking, cancelBooking: cancelBooking,
    approveCancellation: approveCancellation, rejectCancellation: rejectCancellation,
    markCompleted: markCompleted, markNoShow: markNoShow };
})();
