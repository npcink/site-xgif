import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDate } from "../calendar-date.js";

test("calendar date follows the configured publishing timezone", () => {
  const instant = new Date("2026-07-23T16:30:00.000Z");
  assert.equal(calendarDate(instant, "Asia/Shanghai"), "2026-07-24");
  assert.equal(calendarDate(instant, "UTC"), "2026-07-23");
});
