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
  function notify(booking, type, send) {
    try { send(); }
    catch (deliveryError) {
      Logger.log('EMAIL_DELIVERY_FAILED booking_id=' + booking.booking_id + ' type=' + type);
    }
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
    notify(committed.booking, 'CONFIRMATION', function () {
      EmailService.sendConfirmation(committed.booking, committed.token);
    });
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
        if (booking.status === 'CANCELLATION_REQUESTED') {
          return { booking: booking, changed: false };
        }
        throw error('INVALID_STATE');
      }
      if (!settingEnabled('customer_cancellation_enabled') ||
          !Domain.canTransition(booking.status, 'CANCELLATION_REQUESTED', booking, new Date())) throw error('INVALID_STATE');
      var requested = persistRequest(booking, 'CANCELLATION_REQUESTED');
      return { booking: requested, changed: true };
    });
    if (result.changed) notify(result.booking, 'CANCELLATION_REQUESTED', function () {
      EmailService.sendCancellationRequested(result.booking);
    });
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
  function requireExistingBooking(bookingId) {
    if (typeof bookingId !== 'string' || !bookingId.trim()) throw error('VALIDATION_ERROR');
    var booking = BookingStore.getById(bookingId);
    if (!booking) throw error('INVALID_STATE');
    return booking;
  }
  function persistLifecycle(booking, status, actor, extra, type, metadata) {
    var patch = Object.assign({ status: status, updated_at: new Date().toISOString() }, extra || {});
    var updated = Object.assign({}, booking, patch);
    var wrote = false;
    try {
      // updateById writes one Sheet cell at a time and can fail partway through.
      // Treat the attempt as potentially mutating so compensation restores every field.
      wrote = true;
      if (!SheetStore.updateById('Bookings', 'booking_id', booking.booking_id, patch)) throw error('INTERNAL_ERROR');
      BookingStore.appendEvent({ event_id: Domain.newId('EVT'), booking_id: booking.booking_id,
        event_type: type, actor: actor || 'SYSTEM', timestamp: new Date().toISOString(),
        metadata_json: JSON.stringify(metadata || {}) });
      SpreadsheetApp.flush();
      return updated;
    } catch (err) {
      if (wrote) {
        try {
          var restore = { status: booking.status, updated_at: booking.updated_at };
          ['start_at', 'end_at', 'cancelled_at', 'completed_at'].forEach(function (key) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) restore[key] = booking[key] || '';
          });
          SheetStore.updateById('Bookings', 'booking_id', booking.booking_id, restore);
        } catch (rollbackError) { Logger.log('BOOKING_STATE_ROLLBACK_FAILED'); }
      }
      throw err;
    }
  }
  function reschedule(bookingId, replacement, actor) {
    try { Schema.ensureCurrent(); }
    catch (schemaError) {
      if (schemaError.message === 'Schema migration lock unavailable') throw error('LOCK_TIMEOUT');
      throw schemaError;
    }
    var movedBooking = LockGateway.withLock(10000, function () {
      var booking = requireExistingBooking(bookingId);
      if (booking.status !== 'CONFIRMED' && booking.status !== 'RESCHEDULE_REQUESTED') throw error('INVALID_STATE');
      if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement) ||
          (replacement.service_id !== undefined && replacement.service_id !== booking.service_id)) throw error('VALIDATION_ERROR');
      var start;
      try { start = TimeService.instant(replacement.start_at).toISOString(); }
      catch (e) { throw error('VALIDATION_ERROR'); }
      var check = AvailabilityService.check({ service_id: booking.service_id, start_at: start,
        quantity: booking.quantity, exclude_booking_id: booking.booking_id });
      if (!check.ok) throw error(check.code);
      var oldCalendarInterval = CalendarGateway.getEventInterval(booking.calendar_event_id);
      var moved = false;
      try {
        CalendarGateway.updateEvent(booking.calendar_event_id, start, check.end_at);
        moved = true;
        var updated = persistLifecycle(booking, 'CONFIRMED', actor,
          { start_at: start, end_at: check.end_at }, 'BOOKING_RESCHEDULED',
          { previous_start_at: booking.start_at, previous_end_at: booking.end_at });
        return { booking: updated, previousInterval: { start_at: booking.start_at, end_at: booking.end_at } };
      } catch (err) {
        if (moved) {
          try { CalendarGateway.updateEvent(booking.calendar_event_id, oldCalendarInterval.start_at, oldCalendarInterval.end_at); }
          catch (rollbackError) { Logger.log('BOOKING_RESCHEDULE_CALENDAR_ROLLBACK_FAILED'); }
        }
        throw err && err.domainCode ? err : error('INTERNAL_ERROR');
      }
    });
    notify(movedBooking.booking, 'RESCHEDULED', function () {
      EmailService.sendRescheduled(movedBooking.booking, movedBooking.previousInterval);
    });
    return movedBooking.booking;
  }
  function cancel(bookingId, actor) {
    return transition(bookingId, 'CANCELLED', actor, 'BOOKING_CANCELLED', { cancelled_at: new Date().toISOString() }, true, null, true);
  }
  function transition(bookingId, to, actor, eventType, extra, removeCalendar, requiredFrom, idempotent) {
    try { Schema.ensureCurrent(); }
    catch (schemaError) {
      if (schemaError.message === 'Schema migration lock unavailable') throw error('LOCK_TIMEOUT');
      throw schemaError;
    }
    return LockGateway.withLock(10000, function () {
      var booking = requireExistingBooking(bookingId);
      if (booking.status === to && idempotent) {
        if (removeCalendar && booking.calendar_event_id) {
          try { CalendarGateway.deleteEvent(booking.calendar_event_id); }
          catch (retryDeleteError) { throw error('INTERNAL_ERROR'); }
        }
        return booking;
      }
      if (requiredFrom && booking.status !== requiredFrom) throw error('INVALID_STATE');
      var now = new Date();
      if (!Domain.canTransition(booking.status, to, booking, now)) throw error('INVALID_STATE');
      var updated = persistLifecycle(booking, to, actor, extra, eventType);
      if (removeCalendar && booking.calendar_event_id) {
        try { CalendarGateway.deleteEvent(booking.calendar_event_id); }
        catch (deleteError) {
          try {
            SheetStore.updateById('Bookings', 'booking_id', booking.booking_id,
              { status: booking.status, updated_at: booking.updated_at, cancelled_at: booking.cancelled_at || '' });
            BookingStore.appendEvent(event(booking.booking_id, 'BOOKING_CANCELLATION_ROLLED_BACK', actor));
            SpreadsheetApp.flush();
          } catch (rollbackError) { Logger.log('BOOKING_CANCELLATION_ROLLBACK_FAILED'); }
          throw error('INTERNAL_ERROR');
        }
      }
      return updated;
    });
  }
  function approveCancellation(bookingId, actor) {
    var booking = transition(bookingId, 'CANCELLED', actor, 'BOOKING_CANCELLED',
      { cancelled_at: new Date().toISOString() }, true, 'CANCELLATION_REQUESTED', true);
    notify(booking, 'CANCELLATION_APPROVED', function () { EmailService.sendCancellationApproved(booking); });
    return booking;
  }
  function rejectCancellation(bookingId, actor) {
    var booking = transition(bookingId, 'CONFIRMED', actor, 'CANCELLATION_REJECTED', { cancelled_at: '' }, false);
    notify(booking, 'CANCELLATION_REJECTED', function () { EmailService.sendCancellationRejected(booking); });
    return booking;
  }
  function markCompleted(bookingId, actor) {
    return transition(bookingId, 'COMPLETED', actor, 'COMPLETED',
      { completed_at: new Date().toISOString() }, false, null, true);
  }
  function markNoShow(bookingId, actor) {
    return transition(bookingId, 'NO_SHOW', actor, 'NO_SHOW', {}, false, null, true);
  }
  return { create: create, getManaged: getManaged, requestCancellation: requestCancellation,
    requestReschedule: requestReschedule, reschedule: reschedule, cancel: cancel,
    approveCancellation: approveCancellation, rejectCancellation: rejectCancellation,
    markCompleted: markCompleted, markNoShow: markNoShow,
    error: error, publicBooking: publicBooking };
})();
