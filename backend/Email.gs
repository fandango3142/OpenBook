/** Fixed, privacy-safe customer lifecycle email templates. */
var EmailService = (function () {
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function businessName() {
    return Config.get('BUSINESS_NAME') || Config.get('OWNER_NAME') || 'Your business';
  }

  function details(booking) {
    var zone = SheetStore.getSetting('business_timezone');
    var start = TimeService.formatInZone(booking.start_at, zone);
    var end = TimeService.formatInZone(booking.end_at, zone);
    return {
      businessName: businessName(),
      customerName: booking.customer_name_snapshot,
      serviceName: booking.service_name_snapshot,
      date: start.date,
      time: start.time + '–' + end.time,
      bookingId: booking.booking_id,
    };
  }

  function send(booking, title, managementUrl) {
    var data = details(booking);
    var subject = title + ': ' + data.serviceName + ' on ' + data.date;
    var body = 'Hello ' + data.customerName + ',\n\n'
      + title + '.\n\nService: ' + data.serviceName + '\nDate: ' + data.date
      + '\nTime: ' + data.time + '\nBooking ID: ' + data.bookingId
      + (managementUrl ? '\nManage booking: ' + managementUrl : '')
      + '\n\n' + data.businessName;
    var html = '<p>Hello ' + escapeHtml(data.customerName) + ',</p><p>' + escapeHtml(title)
      + '.</p><p><strong>Service:</strong> ' + escapeHtml(data.serviceName)
      + '<br><strong>Date:</strong> ' + escapeHtml(data.date)
      + '<br><strong>Time:</strong> ' + escapeHtml(data.time)
      + '<br><strong>Booking ID:</strong> ' + escapeHtml(data.bookingId)
      + (managementUrl ? '<br><a href="' + escapeHtml(managementUrl) + '">Manage booking</a>' : '')
      + '</p><p>' + escapeHtml(data.businessName) + '</p>';
    MailApp.sendEmail({ to: booking.customer_email_snapshot, subject: subject, body: body,
      htmlBody: html, name: data.businessName });
  }

  function sendConfirmation(booking, plaintextToken) {
    var base = String(Config.get('GITHUB_PAGES_URL') || '').replace(/\/$/, '');
    var url = base + '/manage.html?token=' + encodeURIComponent(String(plaintextToken));
    send(booking, 'Booking confirmed', url);
  }
  function sendCancellationRequested(booking) { send(booking, 'Cancellation requested'); }
  function sendCancellationApproved(booking) { send(booking, 'Booking cancelled'); }
  function sendCancellationRejected(booking) { send(booking, 'Cancellation request declined'); }
  function sendRescheduled(booking, previousInterval) {
    var oldStart = TimeService.formatInZone(previousInterval.start_at, SheetStore.getSetting('business_timezone'));
    var oldEnd = TimeService.formatInZone(previousInterval.end_at, SheetStore.getSetting('business_timezone'));
    send(booking, 'Booking rescheduled from ' + oldStart.date + ' ' + oldStart.time + '–' + oldEnd.time);
  }

  return { sendConfirmation: sendConfirmation, sendCancellationRequested: sendCancellationRequested,
    sendCancellationApproved: sendCancellationApproved, sendCancellationRejected: sendCancellationRejected,
    sendRescheduled: sendRescheduled };
})();
