/**
 * BookingStore — CRUD operations on the Google Sheets booking database.
 * All writes use LockService for concurrent access safety.
 */

var BookingStore = (function () {
  var HEADERS = [
    'token', 'tokenExpiresAt', 'eventId', 'status', 'meetingTypeId',
    'meetingTypeName', 'eventLabel', 'startTime', 'endTime', 'firstName', 'lastName',
    'email', 'format', 'location', 'purpose', 'notes', 'createdAt',
    'cancelledAt', 'rescheduledTo',
  ];

  function getSheet() {
    var spreadsheetId = Config.get('SPREADSHEET_ID');
    if (!spreadsheetId) {
      throw new Error('SPREADSHEET_ID not configured in Script Properties');
    }
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName('Bookings');
    if (!sheet) {
      sheet = ss.insertSheet('Bookings');
      sheet.appendRow(HEADERS);
    }
    return sheet;
  }

  function isVersioned(headers) {
    return headers.indexOf('booking_id') !== -1 && headers.indexOf('manage_token_hash') !== -1;
  }

  function value(row, headers, field) {
    var column = headers.indexOf(field);
    return column < 0 ? '' : (row[column] || '');
  }

  function isHashedRow(row, headers) {
    return isVersioned(headers) && !!value(row, headers, 'manage_token_hash');
  }

  function decode(row, headers, token) {
    if (!isHashedRow(row, headers)) {
      var legacy = {};
      headers.forEach(function (header, index) { legacy[header] = row[index]; });
      return legacy;
    }
    var status = String(value(row, headers, 'status')).toLowerCase();
    var createdAt = value(row, headers, 'created_at');
    return {
      token: token || '',
      tokenExpiresAt: '',
      eventId: value(row, headers, 'calendar_event_id'),
      status: status,
      meetingTypeId: value(row, headers, 'service_id'),
      meetingTypeName: value(row, headers, 'service_name_snapshot'),
      eventLabel: '',
      startTime: value(row, headers, 'start_at'),
      endTime: value(row, headers, 'end_at'),
      firstName: value(row, headers, 'customer_name_snapshot').split(' ')[0],
      lastName: value(row, headers, 'customer_name_snapshot').split(' ').slice(1).join(' '),
      email: value(row, headers, 'customer_email_snapshot'),
      format: '', location: '', purpose: '', notes: '',
      createdAt: createdAt,
      cancelledAt: value(row, headers, 'cancelled_at'),
      rescheduledTo: '',
      _tokenHash: value(row, headers, 'manage_token_hash'),
    };
  }

  function rowMatchesToken(row, headers, token) {
    if (!token) return false;
    if (value(row, headers, 'token') === token) return true;
    return isHashedRow(row, headers) && value(row, headers, 'manage_token_hash') === TokenService.hashToken(token);
  }

  function create(bookingData) {
    var sheet = getSheet();
    var headers = sheet.getDataRange().getValues()[0];
    var row;
    if (isVersioned(headers)) {
      var start = new Date(bookingData.startTime);
      var end = new Date(bookingData.endTime);
      var fields = {
        booking_id: 'BKG_' + Utilities.getUuid(),
        service_id: bookingData.meetingTypeId,
        service_name_snapshot: bookingData.meetingTypeName,
        duration_minutes_snapshot: (end - start) / 60000,
        customer_id: 'CUS_' + Utilities.getUuid(),
        customer_name_snapshot: [bookingData.firstName, bookingData.lastName].filter(Boolean).join(' '),
        customer_email_snapshot: bookingData.email,
        customer_phone_snapshot: '',
        start_at: bookingData.startTime,
        end_at: bookingData.endTime,
        quantity: 1,
        status: String(bookingData.status || '').toUpperCase(),
        calendar_event_id: bookingData.eventId,
        manage_token_hash: TokenService.hashToken(bookingData.token),
        created_at: bookingData.createdAt || new Date().toISOString(),
        updated_at: bookingData.createdAt || new Date().toISOString(),
        cancelled_at: bookingData.cancelledAt || '',
        completed_at: '',
      };
      row = headers.map(function (header) { return fields[header] === undefined ? '' : fields[header]; });
    } else {
      row = HEADERS.map(function (header) { return bookingData[header] || ''; });
    }
    sheet.appendRow(row);
    return bookingData;
  }

  function getByToken(token) {
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return null; // Only headers

    var headerRow = data[0];
    for (var i = 1; i < data.length; i++) {
      if (rowMatchesToken(data[i], headerRow, token)) return decode(data[i], headerRow, token);
    }
    return null;
  }

  function updateStatus(token, newStatus, extraFields) {
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return false;

    var headerRow = data[0];
    var statusCol = headerRow.indexOf('status');
    if (statusCol === -1) return false;

    for (var i = 1; i < data.length; i++) {
      if (rowMatchesToken(data[i], headerRow, token)) {
        var rowNum = i + 1; // 1-indexed
        var versioned = isHashedRow(data[i], headerRow);
        sheet.getRange(rowNum, statusCol + 1).setValue(versioned ? String(newStatus).toUpperCase() : newStatus);

        if (extraFields) {
          for (var field in extraFields) {
            var durableField = versioned && field === 'cancelledAt' ? 'cancelled_at' : field;
            var col = headerRow.indexOf(durableField);
            if (col !== -1) {
              sheet.getRange(rowNum, col + 1).setValue(extraFields[field]);
            }
          }
        }
        return true;
      }
    }
    return false;
  }

  function getAll() {
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    var headerRow = data[0];
    var bookings = [];
    for (var i = 1; i < data.length; i++) {
      bookings.push(decode(data[i], headerRow, ''));
    }
    return bookings;
  }

  /**
   * Find a confirmed booking whose time range overlaps [startISO, endISO].
   *
   * This is the authoritative, immediately-consistent double-booking guard:
   * unlike the calendar (read back through the eventually-consistent
   * Calendar.Events.list service), a row written here under the script lock is
   * visible to the very next request. Call this inside LockService, before
   * creating the calendar event.
   *
   * @param {string} startISO   requested start (ISO 8601)
   * @param {string} endISO     requested end (ISO 8601)
   * @param {string} excludeToken  token to ignore (e.g. the booking being
   *                                rescheduled); pass null/'' to check all.
   * @param {function(object):boolean=} isGhostFn  optional predicate, given the
   *   overlapping confirmed booking row, that returns true when the row is a
   *   stale "ghost" — its calendar event was deleted/moved out-of-band AND it is
   *   old enough that this can't be calendar read-after-write lag. A ghost is not
   *   a real conflict, so the freed slot becomes bookable again. The predicate
   *   MUST fail closed (treat fresh rows and unverifiable rows as real conflicts)
   *   so it can never open a double-booking. Omit it and every confirmed row is
   *   trusted (legacy behaviour).
   * @return {object|null} the clashing booking, or null if the slot is free.
   */
  function findOverlappingConfirmed(startISO, endISO, excludeToken, isGhostFn) {
    var reqStart = new Date(startISO).getTime();
    var reqEnd = new Date(endISO).getTime();
    if (isNaN(reqStart) || isNaN(reqEnd)) return null;

    var all = getAll();
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      if (b.status !== 'confirmed') continue;
      if (excludeToken && (b.token === excludeToken ||
          (b._tokenHash && b._tokenHash === TokenService.hashToken(excludeToken)))) continue;

      // startTime/endTime may come back as ISO strings or as Date values
      // (Sheets can auto-coerce datetime-looking cells); new Date() handles both.
      var bStart = new Date(b.startTime).getTime();
      var bEnd = new Date(b.endTime).getTime();
      if (isNaN(bStart) || isNaN(bEnd)) continue;

      // Half-open overlap: touching intervals (a.end === b.start) do not clash.
      if (reqStart < bEnd && bStart < reqEnd) {
        // Skip only rows the predicate positively identifies as stale ghosts.
        if (isGhostFn && isGhostFn(b)) continue;
        return b;
      }
    }
    return null;
  }

  function deleteOldBookings(olderThanDays) {
    var sheet = getSheet();
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return 0;

    var headerRow = data[0];
    var startTimeCol = headerRow.indexOf('startTime');
    var startAtCol = headerRow.indexOf('start_at');
    if (startTimeCol === -1 && startAtCol === -1) return 0;

    var cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    var deletedCount = 0;

    // Walk rows bottom-up so deleting doesn't shift indices
    for (var i = data.length - 1; i >= 1; i--) {
      var column = isHashedRow(data[i], headerRow) ? startAtCol : startTimeCol;
      var startTime = new Date(data[i][column]);
      if (startTime < cutoff) {
        sheet.deleteRow(i + 1); // 1-indexed
        deletedCount++;
      }
    }
    return deletedCount;
  }

  return {
    create: create,
    getByToken: getByToken,
    updateStatus: updateStatus,
    getAll: getAll,
    findOverlappingConfirmed: findOverlappingConfirmed,
    deleteOldBookings: deleteOldBookings,
    HEADERS: HEADERS,
  };
})();
