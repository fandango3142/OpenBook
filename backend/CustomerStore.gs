/** Minimal contact records, deduplicated only inside a locked mutation. */
var CustomerStore = (function () {
  function findOrCreate(data) {
    var email = data.email.trim().toLowerCase();
    var found = SheetStore.readAll('Customers').filter(function (row) { return String(row.email).trim().toLowerCase() === email; });
    if (found.length) return found[0];
    var now = new Date().toISOString();
    return SheetStore.append('Customers', { customer_id: Domain.newId('CUS'), name: data.name,
      email: email, phone: data.phone || '', created_at: now, updated_at: now });
  }
  return { findOrCreate: findOrCreate };
})();
