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
  function settingEnabled(key) {
    var value = SheetStore.getSetting(key);
    if (value === '' || value === null || value === undefined) return false;
    return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
  }
  function managedRecord(token) {
    if (typeof token !== 'string' || !token || token.length > 512) throw error('INVALID_TOKEN');
    var record = BookingStore.getByTokenHash(TokenService.hash(token));
    if (!record) throw error('INVALID_TOKEN');
    return record;
  }
  function managedActions(record) {
    var confirmed = record.status === 'CONFIRMED';
    return {
      can_request_cancellation: confirmed && settingEnabled('customer_cancellation_enabled'),
      can_request_reschedule: confirmed && settingEnabled('customer_rescheduling_enabled'),
    };
  }
  function publicManaged(record) {
    return { booking: publicBooking(record), actions: managedActions(record) };
  }
  function persistRequest(booking, status, metadata) {
    var updated = { status: status, updated_at: new Date().toISOString() };
    try {
      if (!SheetStore.updateById('Bookings', 'booking_id', booking.booking_id, updated)) throw error('INTERNAL_ERROR');
      BookingStore.appendEvent({ event_id: Domain.newId('EVT'), booking_id: booking.booking_id,
        event_type: status, actor: 'CUSTOMER', timestamp: new Date().toISOString(),
        metadata_json: JSON.stringify(metadata || {}) });
      return Object.assign({}, booking, updated);
    } catch (writeError) {
      try {
        SheetStore.updateById('Bookings', 'booking_id', booking.booking_id,
          { status: booking.status, updated_at: booking.updated_at });
      } catch (rollbackError) { Logger.log('BOOKING_REQUEST_ROLLBACK_FAILED'); }
      throw writeError;
    }
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
  function getManaged(token) {
    Schema.ensureCurrent();
    return publicManaged(managedRecord(token));
  }
  function requestCancellation(token) {
    Schema.ensureCurrent();
    var hash = typeof token === 'string' && token.length <= 512 ? TokenService.hash(token) : '';
    var result = LockGateway.withLock(10000, function () {
      var booking = hash ? BookingStore.getByTokenHash(hash) : null;
      if (!booking) throw error('INVALID_TOKEN');
      if (booking.status !== 'CONFIRMED') {
        if (['CANCELLATION_REQUESTED', 'RESCHEDULE_REQUESTED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'].indexOf(booking.status) !== -1) {
          return { booking: booking, changed: false };
        }
        throw error('INVALID_STATE');
      }
      if (!settingEnabled('customer_cancellation_enabled') ||
          !Domain.canTransition(booking.status, 'CANCELLATION_REQUESTED', booking, new Date())) throw error('INVALID_STATE');
      var requested = persistRequest(booking, 'CANCELLATION_REQUESTED');
      return { booking: requested, changed: true };
    });
    if (result.changed && EmailService.sendCancellationRequested) {
      try { EmailService.sendCancellationRequested(result.booking); }
      catch (sendError) { Logger.log('CANCELLATION_REQUEST_EMAIL_FAILED'); }
    }
    return { booking: publicBooking(result.booking) };
  }
  function requestReschedule(token, requestedStart) {
    Schema.ensureCurrent();
    var hash = typeof token === 'string' && token.length <= 512 ? TokenService.hash(token) : '';
    var start;
    try { start = TimeService.instant(requestedStart).toISOString(); }
    catch (e) { throw error('VALIDATION_ERROR'); }
    return LockGateway.withLock(10000, function () {
      var booking = hash ? BookingStore.getByTokenHash(hash) : null;
      if (!booking) throw error('INVALID_TOKEN');
      if (booking.status === 'RESCHEDULE_REQUESTED') return { booking: publicBooking(booking) };
      if (!settingEnabled('customer_rescheduling_enabled') || booking.status !== 'CONFIRMED' ||
          !Domain.canTransition(booking.status, 'RESCHEDULE_REQUESTED', booking, new Date())) throw error('INVALID_STATE');
      var requested = persistRequest(booking, 'RESCHEDULE_REQUESTED', { requested_start_at: start });
      return { booking: publicBooking(requested) };
    });
  }
  return { create: create, getManaged: getManaged, requestCancellation: requestCancellation,
    requestReschedule: requestReschedule, error: error, publicBooking: publicBooking };
})();
