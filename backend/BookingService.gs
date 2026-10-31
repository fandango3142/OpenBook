/** The lock covers fresh validation, Calendar output and every durable write. */
var LockGateway = (function () {
  function withLock(timeout, work) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(timeout)) throw BookingService.error('LOCK_TIMEOUT');
    try { return work(); }
    finally { try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } }
  }
  return { withLock: withLock };
})();

var BookingService = (function () {
  function error(code) { var err = new Error(code); err.domainCode = code; return err; }
  function contact(command) {
    var customer = command && command.customer && typeof command.customer === 'object' ? command.customer : command;
    if (!command || typeof customer !== 'object' || typeof customer.name !== 'string' ||
        !customer.name.trim() || customer.name.length > 160 || typeof customer.email !== 'string' ||
        customer.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim()) ||
        (customer.phone !== undefined && (typeof customer.phone !== 'string' || customer.phone.length > 40))) {
      throw error('VALIDATION_ERROR');
    }
    return { name: customer.name.trim(), email: customer.email.trim().toLowerCase(), phone: (customer.phone || '').trim() };
  }
  function publicBooking(record) {
    return { booking_id: record.booking_id, service_id: record.service_id,
      service_name: record.service_name_snapshot, start_at: record.start_at, end_at: record.end_at,
      quantity: record.quantity, status: record.status };
  }
  function event(bookingId, type, actor) {
    return { event_id: Domain.newId('EVT'), booking_id: bookingId, event_type: type,
      actor: actor, timestamp: new Date().toISOString(), metadata_json: '{}' };
  }
  function create(command, actor) {
    var customerData = contact(command);
    try { Schema.ensureCurrent(); }
    catch (schemaError) {
      if (schemaError.message === 'Schema migration lock unavailable') throw error('LOCK_TIMEOUT');
      throw schemaError;
    }
    var committed = LockGateway.withLock(10000, function () {
      var quantity = command.quantity === undefined ? 1 : command.quantity;
      var request = { service_id: command.service_id, start_at: command.start_at, quantity: quantity };
      var check = AvailabilityService.check(request);
      if (!check.ok) throw error(check.code);
      var service = ServiceStore.getById(command.service_id);
      var issued = TokenService.issue();
      var bookingId = Domain.newId('BKG');
      var calendarEvent = CalendarGateway.createBookingEvent({ booking_id: bookingId,
        service_name: service.name, start_at: new Date(command.start_at).toISOString(), end_at: check.end_at });
      var booking;
      try {
        var customer = CustomerStore.findOrCreate(customerData);
        var now = new Date().toISOString();
        booking = BookingStore.create({ booking_id: bookingId, service_id: service.service_id,
          service_name_snapshot: service.name, duration_minutes_snapshot: service.duration_minutes,
          customer_id: customer.customer_id, customer_name_snapshot: customerData.name,
          customer_email_snapshot: customerData.email, customer_phone_snapshot: customerData.phone,
          start_at: new Date(command.start_at).toISOString(), end_at: check.end_at, quantity: Number(quantity),
          status: 'CONFIRMED', calendar_event_id: calendarEvent.id, manage_token_hash: issued.hash,
          created_at: now, updated_at: now, cancelled_at: '', completed_at: '' });
        BookingStore.appendEvent(event(bookingId, 'BOOKING_CREATED', actor || 'PUBLIC'));
        BookingStore.appendEvent(event(bookingId, 'BOOKING_CONFIRMED', 'SYSTEM'));
        SpreadsheetApp.flush();
      } catch (err) {
        // A partially written booking remains authoritative and reserves seats.
        try { CalendarGateway.deleteEvent(calendarEvent.id); }
        catch (rollbackError) { Logger.log('BOOKING_CALENDAR_ROLLBACK_FAILED'); }
        throw err;
      }
      return { booking: booking, token: issued.token };
    });
    try {
      // Adapt the transient payload to the existing mail renderer. Never persist it.
      var b = committed.booking;
      EmailService.sendBookingConfirmation({ token: committed.token, email: b.customer_email_snapshot,
        firstName: b.customer_name_snapshot, lastName: '', meetingTypeId: b.service_id,
        meetingTypeName: b.service_name_snapshot, startTime: b.start_at, endTime: b.end_at,
        eventId: b.calendar_event_id, location: '', format: '', purpose: '', notes: '' });
    } catch (deliveryError) { Logger.log('BOOKING_CONFIRMATION_DELIVERY_FAILED'); }
    return { booking: publicBooking(committed.booking), manage_token: committed.token };
  }
  return { create: create, error: error, publicBooking: publicBooking };
})();
