/** Business-local civil time conversion. Production uses only Apps Script APIs. */
var TimeService = (function () {
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function civilDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid local date');
    var date = new Date(value + 'T00:00:00.000Z');
    if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid local date');
    return date;
  }

  function clockMinutes(value) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Invalid local time');
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  }

  function instant(value) {
    // Never let the machine/browser timezone interpret an unzoned timestamp.
    if (typeof value === 'string') {
      if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) {
        throw new Error('Invalid instant');
      }
      civilDate(value.slice(0, 10));
    } else if (Object.prototype.toString.call(value) !== '[object Date]') {
      throw new Error('Invalid instant');
    }
    var result = new Date(value);
    if (isNaN(result.getTime())) throw new Error('Invalid instant');
    return result;
  }

  function formatInZone(value, zone) {
    if (typeof zone !== 'string' || !zone) throw new Error('Invalid timezone');
    var date = instant(value);
    var localDate = Utilities.formatDate(date, zone, 'yyyy-MM-dd');
    return { date: localDate, time: Utilities.formatDate(date, zone, 'HH:mm'),
      weekday: WEEKDAYS[civilDate(localDate).getUTCDay()] };
  }

  function localDateTimeToInstant(localDate, localTime, zone, disambiguation) {
    var base = civilDate(localDate).getTime() + clockMinutes(localTime) * 60000;
    var choice = disambiguation === undefined ? 'reject' : disambiguation;
    if (['reject', 'earlier', 'later'].indexOf(choice) === -1) throw new Error('Invalid disambiguation');
    if (typeof zone !== 'string' || !zone) throw new Error('Invalid timezone');
    var target = localDate + 'T' + localTime + ':00';
    var offsets = {};
    // Probe both sides of transitions, including half-hour and date-line jumps.
    // The formatted value is fixed ISO fields, never a locale-dependent date.
    for (var hours = -48; hours <= 48; hours += 6) {
      var probe = base + hours * 3600000;
      var rendered = Utilities.formatDate(new Date(probe), zone, "yyyy-MM-dd'T'HH:mm:ss");
      offsets[new Date(rendered + 'Z').getTime() - probe] = true;
    }
    var matches = Object.keys(offsets).map(function (offset) { return base - Number(offset); })
      .filter(function (candidate) {
        return Utilities.formatDate(new Date(candidate), zone, "yyyy-MM-dd'T'HH:mm:ss") === target;
      }).sort(function (a, b) { return a - b; });
    if (!matches.length) throw new Error('nonexistent local time');
    if (matches.length > 1 && choice === 'reject') throw new Error('ambiguous local time');
    return new Date(choice === 'later' ? matches[matches.length - 1] : matches[0]);
  }

  return { localDateTimeToInstant: localDateTimeToInstant, formatInZone: formatInZone,
    instant: instant, civilDate: civilDate, clockMinutes: clockMinutes };
})();
