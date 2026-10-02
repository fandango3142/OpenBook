/** Durable booking identities and lifecycle rules. */
var Domain = (function () {
  var TRANSITIONS = {
    CONFIRMED: ['CANCELLATION_REQUESTED', 'RESCHEDULE_REQUESTED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
    CANCELLATION_REQUESTED: ['CONFIRMED', 'CANCELLED'],
    RESCHEDULE_REQUESTED: ['CONFIRMED'],
    CANCELLED: [],
    COMPLETED: [],
    NO_SHOW: [],
  };
  var ACTIVE = ['CONFIRMED', 'CANCELLATION_REQUESTED', 'RESCHEDULE_REQUESTED'];

  function newId(prefix) {
    return prefix + '_' + Utilities.getUuid().replace(/[{}]/g, '');
  }

  function canTransition(from, to, booking, now) {
    if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, from) ||
        TRANSITIONS[from].indexOf(to) === -1) return false;
    if (to === 'COMPLETED' || to === 'NO_SHOW') {
      if (!booking || !booking.start_at) return false;
      var start = new Date(booking.start_at).getTime();
      var current = new Date(now).getTime();
      return !isNaN(start) && !isNaN(current) && current >= start;
    }
    return true;
  }

  function consumesCapacity(booking, candidateStart, candidateEnd) {
    if (!booking || ACTIVE.indexOf(booking.status) === -1) return false;
    var start = new Date(booking.start_at).getTime();
    var end = new Date(booking.end_at).getTime();
    var requestedStart = new Date(candidateStart).getTime();
    var requestedEnd = new Date(candidateEnd).getTime();
    if (isNaN(start) || isNaN(end) || isNaN(requestedStart) || isNaN(requestedEnd) ||
        start >= end || requestedStart >= requestedEnd) return false;
    return start < requestedEnd && requestedStart < end;
  }

  return {
    newId: newId,
    canTransition: canTransition,
    consumesCapacity: consumesCapacity,
  };
})();
