/** Header-driven access to the milestone's durable Sheets records. */
var SheetStore = (function () {
  function spreadsheet() {
    var id = Config.get('SPREADSHEET_ID');
    if (!id) throw new Error('SPREADSHEET_ID not configured in Script Properties');
    return SpreadsheetApp.openById(id);
  }

  function sheet(name) {
    var found = spreadsheet().getSheetByName(name);
    if (!found) throw new Error('Missing sheet: ' + name);
    return found;
  }

  function ensureSheet(name, headers) {
    var ss = spreadsheet();
    var found = ss.getSheetByName(name) || ss.insertSheet(name);
    if (found.getLastRow() === 0) {
      found.appendRow(headers.slice());
      return found;
    }
    var existing = found.getRange(1, 1, 1, found.getLastColumn()).getValues()[0];
    headers.forEach(function (header) {
      if (existing.indexOf(header) !== -1) return;
      var column = existing.length + 1;
      found.getRange(1, column).setValue(header);
      existing.push(header);
    });
    return found;
  }

  function rows(name) {
    var values = sheet(name).getDataRange().getValues();
    return { headers: values[0] || [], values: values };
  }

  function readAll(name) {
    var data = rows(name);
    return data.values.slice(1).filter(function (row) {
      return row.some(function (value) { return value !== '' && value !== null; });
    }).map(function (row) {
      var record = {};
      data.headers.forEach(function (header, index) { record[header] = row[index]; });
      return record;
    });
  }

  function validateColumns(headers, record) {
    Object.keys(record).forEach(function (key) {
      if (headers.indexOf(key) === -1) throw new Error('Unknown column: ' + key);
    });
  }

  function append(name, record) {
    var target = sheet(name);
    var headers = rows(name).headers;
    validateColumns(headers, record);
    target.appendRow(headers.map(function (header) {
      return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '';
    }));
    return record;
  }

  function updateById(name, idColumn, id, patch) {
    var target = sheet(name);
    var data = rows(name);
    var idIndex = data.headers.indexOf(idColumn);
    if (idIndex === -1) throw new Error('Unknown column: ' + idColumn);
    validateColumns(data.headers, patch);
    for (var i = 1; i < data.values.length; i++) {
      if (data.values[i][idIndex] !== id) continue;
      Object.keys(patch).forEach(function (key) {
        target.getRange(i + 1, data.headers.indexOf(key) + 1).setValue(patch[key]);
      });
      return true;
    }
    return false;
  }

  function getSetting(key) {
    var found = spreadsheet().getSheetByName('Settings');
    if (!found || found.getLastRow() < 2) return '';
    var data = rows('Settings');
    var keyIndex = data.headers.indexOf('key');
    var valueIndex = data.headers.indexOf('value');
    if (keyIndex < 0 || valueIndex < 0) return '';
    for (var i = 1; i < data.values.length; i++) {
      if (data.values[i][keyIndex] === key) return data.values[i][valueIndex];
    }
    return '';
  }

  function setSetting(key, value) {
    ensureSheet('Settings', ['key', 'value']);
    if (!updateById('Settings', 'key', key, { value: value })) append('Settings', { key: key, value: value });
  }

  return {
    ensureSheet: ensureSheet,
    readAll: readAll,
    append: append,
    updateById: updateById,
    getSetting: getSetting,
    setSetting: setSetting,
  };
})();
