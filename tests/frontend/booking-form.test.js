const BookingForm = require('../../js/booking-form');
const fs = require('fs');
const path = require('path');

beforeEach(() => {
  document.body.textContent = '';
  const form = document.createElement('form');
  form.id = 'booking-form';
  [
    ['name', 'Jane Doe'], ['email', 'jane@example.com'], ['phone', '+1 555 0100'],
    ['quantity', '2'], ['hp', ''],
  ].forEach(([id, value]) => {
    const input = document.createElement('input'); input.id = id; input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
});

test('extracts only contact, quantity, and honeypot fields', () => {
  expect(BookingForm.extractFormData()).toEqual({
    name: 'Jane Doe', email: 'jane@example.com', phone: '+1 555 0100', quantity: 2, hp: '',
  });
});

test('validates required contact fields and a positive integer quantity within capacity', () => {
  expect(BookingForm.validateAll({ name: '', email: 'bad', quantity: 0 }, 2)).toEqual({
    name: 'Name is required', email: 'Please enter a valid email address', quantity: 'Choose a valid quantity',
  });
  expect(BookingForm.validateAll({ name: 'Jane', email: 'jane@example.com', quantity: 3 }, 2).quantity)
    .toBe('Only 2 places remain');
});

test('quantity is fixed to one for capacity one and bounded to remaining capacity otherwise', () => {
  const quantity = document.getElementById('quantity');
  BookingForm.setCapacity(1);
  expect(quantity.value).toBe('1');
  expect(quantity.max).toBe('1');
  expect(quantity.disabled).toBe(true);
  BookingForm.setCapacity(4);
  expect(quantity.disabled).toBe(false);
  expect(quantity.max).toBe('4');
});

test('the form contains no purpose, notes, format, or location fields', () => {
  expect(document.querySelector('#purpose, #notes, #format, #location')).toBeNull();
});

test('the public page exposes only name, email, optional phone, quantity, and honeypot inputs', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  ['id="name"', 'id="email"', 'id="phone"', 'id="quantity"', 'id="hp"'].forEach((field) => expect(page).toContain(field));
  ['id="purpose"', 'id="notes"', 'id="format"', 'id="location"', 'id="duration"'].forEach((field) => expect(page).not.toContain(field));
});
