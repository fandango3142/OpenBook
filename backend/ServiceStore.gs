/** Header-mapped, validated service configuration. No cross-request caching. */
var ServiceStore = (function () {
  function integer(value, name, minimum, fallback) {
    if ((value === '' || value === undefined) && fallback !== undefined) value = fallback;
    if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Invalid ' + name);
    if (String(value).trim() === '') throw new Error('Invalid ' + name);
    var number = Number(value);
    if (!Number.isSafeInteger(number) || number < minimum) throw new Error('Invalid ' + name);
    return number;
  }

  function normalize(row) {
    if (!row.service_id || !row.name) throw new Error('Invalid service');
    return {
      service_id: row.service_id, name: row.name, description: row.description || '',
      duration_minutes: integer(row.duration_minutes, 'duration_minutes', 1),
      buffer_before_minutes: integer(row.buffer_before_minutes, 'buffer_before_minutes', 0, 0),
      buffer_after_minutes: integer(row.buffer_after_minutes, 'buffer_after_minutes', 0, 0),
      capacity: integer(row.capacity, 'capacity', 1, 1),
      active: row.active === true || String(row.active).toLowerCase() === 'true',
    };
  }

  function listActive() {
    return SheetStore.readAll('Services').filter(function (row) {
      return row.active === true || String(row.active).toLowerCase() === 'true';
    }).map(normalize);
  }

  function getById(id) {
    var found = SheetStore.readAll('Services').filter(function (row) { return row.service_id === id; });
    if (found.length > 1) throw new Error('Invalid duplicate service_id');
    return found.length ? normalize(found[0]) : null;
  }
  return { listActive: listActive, getById: getById };
})();
