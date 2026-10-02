/**
 * Minimal Google Apps Script harness for Node.
 *
 * Loads real backend/*.gs files into a VM sandbox, stubbing ONLY the external
 * Google-service boundary (Calendar Advanced Service, CalendarApp, SpreadsheetApp,
 * LockService, EmailService, ContentService, Config, Logger). Everything else —
 * request handlers, partitioning, busy subtraction, interval containment,
 * overlap detection, the sheet-backed store — is the real production code.
 *
 * Design choice for realism: created calendar events are NOT reflected back into
 * Calendar.Events.list by default (opts.reflectCreatedEvents), deliberately
 * simulating the CalendarApp -> Advanced Service propagation lag that lets a
 * calendar-only re-check miss a just-created booking. This proves the authoritative
 * sheet check is what actually prevents double-booking.
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..', 'backend');

/**
 * @param {object} opts
 *   config: {KEY: value} overrides for Config.get
 *   calendarEvents: {calendarId: [rawEventResource]} for Calendar.Events.list
 *   bookingRows: legacy 2D array (incl. header row) backing the Bookings sheet
 *   sheets: {name: 2D array} backing named sheets
 *   failAppendFor/failUpdateFor: sheet names whose writes throw
 *   lock: boolean — whether LockService.tryLock succeeds (default true)
 *   reflectCreatedEvents: boolean — echo createEvent() into Events.list (default false)
 * @param {string[]} files - .gs filenames to load (in order)
 */
function loadBackend(opts, files) {
  opts = opts || {};
  const config = opts.config || {};
  const calendarEvents = opts.calendarEvents || {};
  const bookingRows = opts.bookingRows || null;
  const lockGranted = opts.lock === undefined ? true : opts.lock;
  const reflectCreated = !!opts.reflectCreatedEvents;

  const sandbox = {};
  sandbox.console = console;

  // --- Config stub ---
  sandbox.Config = {
    get: function (key) {
      return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : '';
    },
    getNumber: function (key) {
      return parseInt(sandbox.Config.get(key), 10) || 0;
    },
  };

  // --- Logger stub ---
  sandbox.Logger = { log: function () {} };

  // --- Created-event log (shared by CalendarApp + optional Events.list echo) ---
  const createdEvents = [];
  sandbox._createdEvents = createdEvents;

  // --- Calendar Advanced Service stub ---
  sandbox.Calendar = {
    Events: {
      list: function (calendarId, _params) {
        var items = (calendarEvents[calendarId] || []).slice();
        if (reflectCreated) {
          createdEvents.forEach(function (ce) {
            if (ce._calendarId === calendarId && !ce._deleted) items.push(ce._resource);
          });
        }
        return { items: items, nextPageToken: null };
      },
      // Direct lookup by id. Mirrors the live Advanced API: a deleted event
      // throws a 404-style "Not Found"; a cancelled event returns status
      // 'cancelled'; an active event returns status 'confirmed'.
      get: function (_calendarId, eventId) {
        for (var i = 0; i < createdEvents.length; i++) {
          var ce = createdEvents[i];
          var bareId = String(ce.id).replace(/@google\.com$/i, '');
          if (bareId === eventId || ce.id === eventId) {
            if (ce._deleted) throw new Error('API call to calendar.events.get failed with error: Not Found');
            return (ce._resource && ce._resource.status) ? ce._resource : { status: 'confirmed' };
          }
        }
        throw new Error('API call to calendar.events.get failed with error: Not Found');
      },
    },
  };

  // --- CalendarApp stub (createEvent / getEventById / deleteEvent) ---
  sandbox.CalendarApp = {
    getCalendarById: function (calId) {
      if (!calId) return null;
      return {
        createEvent: function (title, start, end, evOpts) {
          var id = 'evt-' + (createdEvents.length + 1);
          var resource = {
            summary: title,
            start: { dateTime: new Date(start).toISOString() },
            end: { dateTime: new Date(end).toISOString() },
            status: 'confirmed',
          };
          createdEvents.push({
            id: id, title: title, start: start, end: end,
            options: evOpts || {}, _calendarId: calId, _resource: resource, _deleted: false,
          });
          return { getId: function () { return id; } };
        },
        getEventById: function (id) {
          var found = null;
          for (var i = 0; i < createdEvents.length; i++) {
            if (createdEvents[i].id === id) { found = createdEvents[i]; break; }
          }
          // A deleted event is not retrievable in real GAS — getEventById returns
          // null. This lets tests model an event removed out-of-band (directly on
          // the calendar) by flipping _deleted without touching the sheet row.
          if (!found || found._deleted) return null;
          return { deleteEvent: function () { found._deleted = true; } };
        },
        // Returns only ACTIVE events overlapping [start, end] (deleted ones are
        // absent), mirroring CalendarApp.getEvents used by eventIsActive.
        getEvents: function (start, end) {
          var qs = new Date(start).getTime(), qe = new Date(end).getTime();
          var out = [];
          for (var i = 0; i < createdEvents.length; i++) {
            var ce = createdEvents[i];
            if (ce._calendarId !== calId || ce._deleted) continue;
            if (ce.start === undefined || ce.end === undefined) continue;
            var es = new Date(ce.start).getTime(), ee = new Date(ce.end).getTime();
            if (es < qe && qs < ee) { // overlap
              out.push({
                getId: (function (c) { return function () { return c.id; }; })(ce),
                getStartTime: (function (c) { return function () { return new Date(c.start); }; })(ce),
                getEndTime: (function (c) { return function () { return new Date(c.end); }; })(ce),
                getTitle: (function (c) { return function () { return c.title || ''; }; })(ce),
              });
            }
          }
          return out;
        },
      };
    },
  };

  // --- LockService stub ---
  let lockHeld = false;
  sandbox.LockService = {
    getScriptLock: function () {
      return {
        tryLock: function () {
          if (!lockGranted || lockHeld) return false;
          lockHeld = true;
          return true;
        },
        releaseLock: function () { lockHeld = false; },
      };
    },
  };

  // --- EmailService stub (records sends) ---
  const sentEmails = [];
  sandbox._sentEmails = sentEmails;
  sandbox.EmailService = {
    sendBookingConfirmation: function (r) { sentEmails.push({ type: 'confirm', record: r }); },
    sendCancellationEmail: function (r) { sentEmails.push({ type: 'cancel', record: r }); },
    sendRescheduleEmail: function (a, b) { sentEmails.push({ type: 'reschedule', from: a, to: b }); },
  };

  // --- ContentService stub (captures JSON payloads) ---
  sandbox.ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: function (text) {
      return {
        _text: text,
        setMimeType: function () { return this; },
        getContent: function () { return this._text; },
      };
    },
  };

  // --- Misc GAS globals ---
  var uuidCounter = 0;
  sandbox.Utilities = { getUuid: function () { uuidCounter++; return 'token-' + uuidCounter; } };
  // Stateful in-memory cache so rate-limiting (keyed per client) is exercisable.
  // TTL is ignored (tests fire synchronously); counts accumulate within a run.
  const cacheStore = {};
  sandbox._cacheStore = cacheStore;
  sandbox.CacheService = {
    getScriptCache: function () {
      return {
        get: function (k) { return Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null; },
        put: function (k, v) { cacheStore[k] = v; },
      };
    },
  };
  var mailQuota = opts.mailQuota === undefined ? 50 : opts.mailQuota;
  sandbox.MailApp = { getRemainingDailyQuota: function () { return mailQuota; } };

  // --- SpreadsheetApp stub with independently named sheets ---
  const sheets = {};
  const failAppendFor = (opts.failAppendFor || []).slice();
  const failUpdateFor = (opts.failUpdateFor || []).slice();
  sandbox._sheets = sheets;
  sandbox._failAppendFor = failAppendFor;
  sandbox._failUpdateFor = failUpdateFor;
  function makeSheet(name, initialRows) {
    const sheet = {
      name: name,
      rows: (initialRows || []).map(function (row) { return row.slice(); }),
      createCount: 1,
      getDataRange: function () { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); },
      appendRow: function (row) {
        if (failAppendFor.indexOf(name) !== -1) throw new Error('append failed for ' + name);
        this.rows.push(row.slice());
      },
      getLastRow: function () { return this.rows.length; },
      getLastColumn: function () { return this.rows[0] ? this.rows[0].length : 0; },
      getRange: function (row, col, numRows, numCols) {
        const self = this;
        numRows = numRows === undefined ? 1 : numRows;
        numCols = numCols === undefined ? 1 : numCols;
        return {
          getValue: function () { return self.rows[row - 1] && self.rows[row - 1][col - 1]; },
          setValue: function (value) {
            if (failUpdateFor.indexOf(name) !== -1) throw new Error('update failed for ' + name);
            if (!self.rows[row - 1]) self.rows[row - 1] = [];
            self.rows[row - 1][col - 1] = value;
          },
          getValues: function () {
            const out = [];
            for (let r = 0; r < numRows; r++) {
              const line = [];
              for (let c = 0; c < numCols; c++) {
                const value = (self.rows[row - 1 + r] || [])[col - 1 + c];
                line.push(value === undefined ? '' : value);
              }
              out.push(line);
            }
            return out;
          },
          setValues: function (values) {
            if (failUpdateFor.indexOf(name) !== -1) throw new Error('update failed for ' + name);
            for (let r = 0; r < numRows; r++) {
              if (!self.rows[row - 1 + r]) self.rows[row - 1 + r] = [];
              for (let c = 0; c < numCols; c++) self.rows[row - 1 + r][col - 1 + c] = values[r][c];
            }
          },
        };
      },
      deleteRow: function (row) { this.rows.splice(row - 1, 1); },
    };
    Object.defineProperty(sheet, '_rows', { get: function () { return this.rows; }, set: function (value) { this.rows = value; } });
    return sheet;
  }
  Object.keys(opts.sheets || {}).forEach(function (name) { sheets[name] = makeSheet(name, opts.sheets[name]); });
  if (bookingRows) {
    sheets.Bookings = makeSheet('Bookings', bookingRows);
    sandbox._sheet = sheets.Bookings;
  }
  sandbox.SpreadsheetApp = {
    openById: function () {
      return {
        getSheetByName: function (name) { return sheets[name] || null; },
        insertSheet: function (name) { return (sheets[name] = makeSheet(name, [])); },
      };
    },
    flush: function () {},
  };
  sandbox._setSetting = function (key, value) {
    const sheet = sheets.Settings || (sheets.Settings = makeSheet('Settings', [['key', 'value']]));
    const row = sheet.rows.find(function (r) { return r[0] === key; });
    if (row) row[1] = value;
    else sheet.rows.push([key, value]);
  };

  const ctx = vm.createContext(sandbox);
  files.forEach(function (f) {
    const code = fs.readFileSync(path.join(BACKEND, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  });
  return ctx;
}

/** Parse the JSON body from a handler's ContentService response. */
function parseResponse(out) {
  return JSON.parse(out.getContent());
}

module.exports = { loadBackend, parseResponse };
