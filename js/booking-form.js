/** Contact and quantity form for the public booking flow. */
var BookingForm = (function () {
  let _onSubmit = null;
  function init(onSubmit) {
    _onSubmit = onSubmit;
    const form = document.getElementById('booking-form');
    if (!form || form.dataset.initialized) return;
    form.dataset.initialized = 'true';
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const data = extractFormData();
      const errors = validateAll(data, Number(document.getElementById('quantity').max || 1));
      clearErrors();
      Object.keys(errors).forEach(function (field) {
        const message = document.getElementById(field + '-error');
        const input = document.getElementById(field);
        if (message) message.textContent = errors[field];
        if (input) input.classList.add('invalid');
      });
      if (!Object.keys(errors).length && _onSubmit) _onSubmit(data);
    });
  }
  function validateAll(data, capacity) {
    const errors = {};
    const name = String(data.name || '').trim();
    const email = String(data.email || '').trim();
    const quantity = Number(data.quantity);
    if (!name) errors.name = 'Name is required';
    if (!email) errors.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Please enter a valid email address';
    if (!Number.isSafeInteger(quantity) || quantity < 1) errors.quantity = 'Choose a valid quantity';
    else if (quantity > capacity) errors.quantity = `Only ${capacity} places remain`;
    return errors;
  }
  function extractFormData() {
    function value(id) { const element = document.getElementById(id); return element ? element.value.trim() : ''; }
    return { name: value('name'), email: value('email'), phone: value('phone'),
      quantity: Number(value('quantity') || 1), hp: value('hp') };
  }
  function setCapacity(capacity) {
    const input = document.getElementById('quantity');
    const label = document.querySelector('label[for="quantity"]');
    if (!input) return;
    const count = Math.max(1, Math.floor(Number(capacity) || 1));
    input.min = '1'; input.max = String(count); input.value = '1'; input.disabled = count === 1;
    if (label) label.textContent = count === 1 ? 'Quantity' : 'Number of places';
  }
  function clearErrors() {
    ['name', 'email', 'quantity'].forEach(function (id) {
      const message = document.getElementById(id + '-error');
      const input = document.getElementById(id);
      if (message) message.textContent = '';
      if (input) input.classList.remove('invalid');
    });
  }
  return { init, validateAll, extractFormData, setCapacity, clearErrors };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BookingForm;
