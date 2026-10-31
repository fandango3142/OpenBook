/**
 * Disposable-sheet smoke test for the M1 booking transaction.
 * Refuses to write unless Settings.smoke_test_mode is exactly true.
 */
var OpenBookSmokeTest = (function () {
  function generatedPrefix() {
    return 'OBSMOKE_' + String(Utilities.getUuid()).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  function isGeneratedPrefix(value) {
    return typeof value === 'string' && /^OBSMOKE_[A-Z0-9]{6,64}$/.test(value);
  }

  function testEmail(prefix) { return 'openbook-smoke+' + prefix.toLowerCase() + '@example.invalid'; }
  function testName(prefix) { return 'OpenBook smoke ' + prefix; }

  function recordStep(steps, name, passed, detail) {
    steps.push({ name: name, passed: !!passed, detail: detail || '' });
    if (!passed) throw new Error('Smoke check failed: ' + name);
  }

  function deleteRowsByIds(sheetName, idColumn, ids, failures) {
    if (!ids.length) return;
    var sheet = SpreadsheetApp.openById(Config.get('SPREADSHEET_ID')).getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return;
    var values = sheet.getDataRange().getValues();
    var column = values[0].indexOf(idColumn);
    if (column < 0) { failures.push(sheetName + ': missing ' + idColumn); return; }
    var wanted = {};
    ids.forEach(function (id) { wanted[String(id)] = true; });
    for (var row = values.length - 1; row >= 1; row--) {
      if (!wanted[String(values[row][column])]) continue;
      try { sheet.deleteRow(row + 1); }
      catch (e) { failures.push(sheetName + ':' + String(values[row][column])); }
    }
    // Verify only the exact generated IDs were removed.
    var remaining = SheetStore.readAll(sheetName).filter(function (record) { return wanted[String(record[idColumn])]; });
    remaining.forEach(function (record) { failures.push(sheetName + ':' + String(record[idColumn])); });
  }

  function cleanup(prefix, ids, failures) {
    var email = testEmail(prefix), name = testName(prefix);
    ids.customerIds = SheetStore.readAll('Customers').filter(function (row) {
      return row.email === email && row.name === name;
    }).map(function (row) { return row.customer_id; });
    var bookings = SheetStore.readAll('Bookings').filter(function (row) {
      return row.customer_email_snapshot === email && row.customer_name_snapshot === name;
    });
    var bookingIds = bookings.map(function (row) { return row.booking_id; });
    bookings.forEach(function (row) {
      if (!row.calendar_event_id) return;
      try { CalendarGateway.deleteEvent(row.calendar_event_id); }
      catch (e) { failures.push('Calendar event for ' + row.booking_id + ' (' + row.calendar_event_id + ')'); }
    });

    deleteRowsByIds('BookingEvents', 'booking_id', bookingIds, failures);
    deleteRowsByIds('Bookings', 'booking_id', bookingIds, failures);
    deleteRowsByIds('Customers', 'customer_id', ids.customerIds, failures);
    deleteRowsByIds('Availability', 'availability_id', ids.availabilityIds, failures);
    deleteRowsByIds('Services', 'service_id', [ids.serviceId], failures);
  }

  function withNoEmailDelivery(work) {
    var methods = ['sendConfirmation', 'sendCancellationRequested', 'sendCancellationApproved',
      'sendCancellationRejected', 'sendRescheduled'];
    var saved = {};
    methods.forEach(function (name) {
      saved[name] = EmailService[name];
      EmailService[name] = function () {};
    });
    try { return work(); }
    finally { methods.forEach(function (name) { EmailService[name] = saved[name]; }); }
  }

  function run() {
    var prefix = generatedPrefix();
    var steps = [], cleanupFailures = [];
    var ids = { serviceId: 'SRV_' + prefix, availabilityIds: [], customerIds: [] };
    var outcome = { passed: false, prefix: prefix, steps: steps, cleanupFailures: cleanupFailures };
    var cleanupNeeded = false;

    try {
      if (!isGeneratedPrefix(prefix)) throw new Error('Could not generate a safe test prefix');
      if (String(SheetStore.getSetting('smoke_test_mode')).toLowerCase() !== 'true') {
        throw new Error('Refusing to write: set Settings.smoke_test_mode to true on a disposable test spreadsheet');
      }
      Schema.ensureCurrent();
      var zone = SheetStore.getSetting('business_timezone');
      if (!zone) throw new Error('Settings.business_timezone must be configured');
      if (String(SheetStore.getSetting('customer_cancellation_enabled')).toLowerCase() !== 'true') {
        throw new Error('Enable customer_cancellation_enabled on the disposable test spreadsheet');
      }
      recordStep(steps, 'schema_setup', Schema.CURRENT_VERSION === 1 &&
        SheetStore.getSetting('schema_version') === Schema.CURRENT_VERSION, 'Schema version ' + Schema.CURRENT_VERSION);

      var serviceName = 'Smoke test ' + prefix;
      cleanupNeeded = true;
      SheetStore.append('Services', { service_id: ids.serviceId, name: serviceName, description: 'Disposable smoke-test service',
        duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, capacity: 3, active: true });
      ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].forEach(function (weekday, index) {
        var availabilityId = 'AVL_' + prefix + '_' + index;
        ids.availabilityIds.push(availabilityId);
        SheetStore.append('Availability', { availability_id: availabilityId, service_id: ids.serviceId,
          weekday: weekday, start_time: '00:00', end_time: '23:30', active: true });
      });

      var now = new Date();
      var startsAt = new Date(now.getTime() + 36 * 60 * 60 * 1000);
      var endsAt = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000);
      var slots = AvailabilityService.listSlots({ service_id: ids.serviceId,
        start_at: startsAt.toISOString(), end_at: endsAt.toISOString(), quantity: 1 });
      if (!slots || slots.length < 2) throw new Error('Need at least two available 30-minute slots in the test window');
      var first = slots[0].start_at;
      var firstEnd = new Date(first).getTime() + 30 * 60 * 1000;
      var replacementSlot = slots.filter(function (slot) { return new Date(slot.start_at).getTime() >= firstEnd; })[0];
      if (!replacementSlot) throw new Error('Need a non-overlapping replacement slot');
      var replacement = replacementSlot.start_at;
      recordStep(steps, 'slot_generation', true, 'Generated ' + slots.length + ' slots');

      var email = testEmail(prefix), name = testName(prefix);
      var createdOne = null, createdTwo = null, createdThree = null;
      withNoEmailDelivery(function () {
        createdOne = BookingService.create({ service_id: ids.serviceId, start_at: first, quantity: 2,
          customer: { name: name, email: email } }, 'SMOKE_TEST');
        ids.customerIds = SheetStore.readAll('Customers').filter(function (row) { return row.email === email && row.name === name; })
          .map(function (row) { return row.customer_id; });
        if (!createdOne.booking.calendar_event_id && !BookingStore.getById(createdOne.booking.booking_id).calendar_event_id) {
          // The public response omits internal Calendar IDs; inspect the exact row below.
          throw new Error('Booking did not persist its Calendar event reference');
        }
        recordStep(steps, 'booking_and_calendar_event_creation', !!BookingStore.getById(createdOne.booking.booking_id).calendar_event_id,
          'Created booking ' + createdOne.booking.booking_id);

        createdTwo = BookingService.create({ service_id: ids.serviceId, start_at: first, quantity: 1,
          customer: { name: name, email: email } }, 'SMOKE_TEST');
        var rejected = false;
        try {
          BookingService.create({ service_id: ids.serviceId, start_at: first, quantity: 1,
            customer: { name: name, email: email } }, 'SMOKE_TEST');
        } catch (e) { rejected = e && e.domainCode === 'INSUFFICIENT_CAPACITY'; }
        recordStep(steps, 'capacity_rejection', rejected, 'Capacity 3 rejected an additional seat');

        var requested = BookingService.requestCancellation(createdOne.manage_token).booking;
        var held = requested.status === 'CANCELLATION_REQUESTED';
        try {
          BookingService.create({ service_id: ids.serviceId, start_at: first, quantity: 1,
            customer: { name: name, email: email } }, 'SMOKE_TEST');
          held = false;
        } catch (e) { held = held && e && e.domainCode === 'INSUFFICIENT_CAPACITY'; }
        recordStep(steps, 'cancellation_request_retains_capacity', held,
          'The requested cancellation continued to reserve its two seats');

        var approved = BookingService.approveCancellation(createdOne.booking.booking_id, 'SMOKE_TEST');
        var released = approved.status === 'CANCELLED';
        try {
          createdThree = BookingService.create({ service_id: ids.serviceId, start_at: first, quantity: 2,
            customer: { name: name, email: email } }, 'SMOKE_TEST');
        } catch (e) { released = false; }
        recordStep(steps, 'approval_releases_capacity', released,
          'Approval released capacity while the other confirmed seat remained reserved');

        if (!createdThree) throw new Error('Capacity was not available after cancellation approval');
        var originalId = createdThree.booking.booking_id;
        var moved = BookingService.reschedule(originalId, { start_at: replacement }, 'SMOKE_TEST');
        recordStep(steps, 'reschedule_preserves_booking_id', moved.booking_id === originalId,
          'Booking ID ' + originalId + ' remained unchanged');
      });

      outcome.passed = steps.every(function (step) { return step.passed; });
    } catch (e) {
      outcome.error = String(e && e.message || e);
    } finally {
      if (cleanupNeeded) {
        try { cleanup(prefix, ids, cleanupFailures); }
        catch (cleanupError) { cleanupFailures.push('Cleanup aborted: ' + String(cleanupError && cleanupError.message || cleanupError)); }
      }
    }

    if (cleanupFailures.length) {
      outcome.passed = false;
      outcome.manual_recovery_ids = cleanupFailures.slice();
      Logger.log('OpenBook smoke cleanup failed. Generated prefix=' + prefix + '; recovery IDs=' + cleanupFailures.join(', '));
    }
    Logger.log('OpenBook booking smoke test ' + (outcome.passed ? 'PASS' : 'FAIL') + ' prefix=' + prefix +
      ' steps=' + steps.filter(function (step) { return step.passed; }).length + '/' + steps.length);
    return outcome;
  }

  return { run: run, isGeneratedPrefix: isGeneratedPrefix, testEmail: testEmail };
})();

/** Run only after setting smoke_test_mode=true in a disposable Sheet. */
function runBookingSmokeTest() { return OpenBookSmokeTest.run(); }
