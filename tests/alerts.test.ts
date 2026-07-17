import assert from "node:assert/strict";
import test from "node:test";
import { currentBudgetStatus, emailAlertsEnabled, notificationConfigurationError } from "@/lib/alerts";

test("budget status reports warning at 80% and paused at the cap", () => {
  assert.deepEqual(currentBudgetStatus({ used: 79 }, "100"), { used: 79, cap: 100, percentage: .79, state: "normal" });
  assert.deepEqual(currentBudgetStatus({ used: 80 }, "100"), { used: 80, cap: 100, percentage: .8, state: "warning" });
  assert.deepEqual(currentBudgetStatus({ used: 100 }, "100"), { used: 100, cap: 100, percentage: 1, state: "paused" });
});

test("budget status never treats a missing cap as a zero-credit limit", () => {
  assert.deepEqual(currentBudgetStatus({ used: 42 }, ""), { used: 0, cap: null, percentage: null, state: "unconfigured" });
  assert.deepEqual(currentBudgetStatus(null, "not-a-number"), { used: 0, cap: null, percentage: null, state: "unconfigured" });
});

test("email configuration requires all Resend values", () => {
  assert.equal(notificationConfigurationError({}), null);
  assert.match(notificationConfigurationError({ RESEND_API_KEY: "key" }) ?? "", /must be set together/);
  assert.equal(notificationConfigurationError({ RESEND_API_KEY: "key", ALERT_FROM_EMAIL: "from@example.com", ALERT_TO_EMAIL: "to@example.com" }), null);
  assert.equal(emailAlertsEnabled({ RESEND_API_KEY: "key", ALERT_FROM_EMAIL: "from@example.com", ALERT_TO_EMAIL: "to@example.com" }), true);
});
