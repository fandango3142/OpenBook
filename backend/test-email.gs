/** Non-sending smoke check for the current lifecycle email service. */
function testEmailService() {
  var methods = ['sendConfirmation', 'sendCancellationRequested', 'sendCancellationApproved',
    'sendCancellationRejected', 'sendRescheduled'];
  var missing = methods.filter(function (name) { return typeof EmailService[name] !== 'function'; });
  var quota = MailApp.getRemainingDailyQuota();
  var result = { passed: missing.length === 0 && typeof quota === 'number',
    missingMethods: missing, remainingQuota: quota };
  Logger.log(result.passed ? 'PASS: lifecycle email interface is available' : 'FAIL: lifecycle email interface check');
  return result;
}
