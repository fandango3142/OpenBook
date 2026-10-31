/** Read-only Calendar configuration check; booking/event lifecycle is tested by runBookingSmokeTest(). */
function testCalendarSmokeConfiguration() {
  var result = { passed: false, booking_calendar: false, conflict_calendars: 0 };
  try {
    var calendarId = String(SheetStore.getSetting('booking_calendar_id') || '').trim();
    if (!calendarId) throw new Error('Settings.booking_calendar_id is required');
    if (!CalendarApp.getCalendarById(calendarId)) throw new Error('Dedicated booking Calendar is not accessible');
    var from = new Date();
    var to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    var conflicts = CalendarGateway.listConflicts(from, to, []);
    result.booking_calendar = true;
    result.conflict_calendars = JSON.parse(String(SheetStore.getSetting('conflict_calendar_ids') || '[]')).length;
    result.conflicts_in_next_day = conflicts.length;
    result.passed = true;
    Logger.log('PASS: Calendar configuration is accessible; conflict count=' + conflicts.length);
  } catch (e) {
    result.error = String(e && e.message || e);
    Logger.log('FAIL: Calendar smoke configuration: ' + result.error);
  }
  return result;
}
