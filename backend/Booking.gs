/** Header-aware booking records. Call mutations under the script lock. */
var BookingStore = (function () {
  function find(field, value) {
    if (!value) return null;
    var matches = SheetStore.readAll('Bookings').filter(function (row) { return row[field] === value; });
    if (matches.length > 1) throw new Error('Duplicate booking identity');
    return matches[0] || null;
  }
  function create(record) { return SheetStore.append('Bookings', record); }
  function getById(id) { return find('booking_id', id); }
  function getByTokenHash(hash) { return find('manage_token_hash', hash); }
  function listActive(start, end, serviceId) {
    return SheetStore.readAll('Bookings').filter(function (row) {
      return (!serviceId || row.service_id === serviceId) && Domain.consumesCapacity(row, start, end);
    });
  }
  function appendEvent(event) { return SheetStore.append('BookingEvents', event); }
  return { create: create, getById: getById, getByTokenHash: getByTokenHash,
    listActive: listActive, appendEvent: appendEvent };
})();
