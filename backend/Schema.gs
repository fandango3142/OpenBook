/** Ordered, repeatable migrations for the milestone's domain sheets. */
var Schema = (function () {
  var CURRENT_VERSION = 1;
  var HEADERS = {
    Services: ['service_id', 'name', 'description', 'duration_minutes', 'buffer_before_minutes', 'buffer_after_minutes', 'capacity', 'active'],
    Availability: ['availability_id', 'service_id', 'weekday', 'start_time', 'end_time', 'active'],
    AvailabilityExceptions: ['exception_id', 'service_id', 'start_at', 'end_at', 'reason', 'active'],
    Customers: ['customer_id', 'name', 'email', 'phone', 'created_at', 'updated_at'],
    Bookings: ['booking_id', 'service_id', 'service_name_snapshot', 'duration_minutes_snapshot', 'customer_id', 'customer_name_snapshot', 'customer_email_snapshot', 'customer_phone_snapshot', 'start_at', 'end_at', 'quantity', 'status', 'calendar_event_id', 'manage_token_hash', 'created_at', 'updated_at', 'cancelled_at', 'completed_at'],
    BookingEvents: ['event_id', 'booking_id', 'event_type', 'actor', 'timestamp', 'metadata_json'],
    Settings: ['key', 'value'],
  };
  var MIGRATIONS = {
    1: function () {
      Object.keys(HEADERS).forEach(function (name) { SheetStore.ensureSheet(name, HEADERS[name]); });
    },
  };

  function ensureCurrent() {
    var stored = Number(SheetStore.getSetting('schema_version') || 0);
    if (!isFinite(stored) || stored < 0 || Math.floor(stored) !== stored) {
      throw new Error('Invalid stored schema version');
    }
    if (stored > CURRENT_VERSION) throw new Error('Stored schema is newer than this code');
    for (var next = stored + 1; next <= CURRENT_VERSION; next++) {
      MIGRATIONS[next]();
      SheetStore.setSetting('schema_version', next);
    }
    return CURRENT_VERSION;
  }

  return { CURRENT_VERSION: CURRENT_VERSION, HEADERS: HEADERS, ensureCurrent: ensureCurrent };
})();

function runMigrations() { return Schema.ensureCurrent(); }
