/** Non-sending check. Lifecycle delivery is disabled inside runBookingSmokeTest(). */
function testEmailService() {
  var methods = ['sendConfirmation', 'sendCancellationRequested', 'sendCancellationApproved',
    'sendCancellationRejected', 'sendRescheduled'];
  var missing = methods.filter(function (name) { return typeof EmailService[name] !== 'function'; });
  var quota = MailApp.getRemainingDailyQuota();
  var result = { passed: missing.length === 0 && typeof quota === 'number',
    missingMethods: missing, remainingQuota: quota, sendsEmail: false };
  Logger.log(result.passed ? 'PASS: lifecycle email interface is available (no message sent)' :
    'FAIL: lifecycle email interface check');
  return result;
}
