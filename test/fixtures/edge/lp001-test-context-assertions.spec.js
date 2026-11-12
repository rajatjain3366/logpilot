// Edge fixture for LP001 (Milestone 2.5): calls that look like swallowed test failures, but are not.
// In tap, tape and AVA, `t` is the test context passed to the test function. tap's assertions do
// not throw, and AVA documents that catching a failed assertion does not make the test pass. So an
// empty catch around t.fail() or t.ok(false) does not hide the failure. These catches get the
// default severity "medium", confidence "high", not the "this check can never fail" finding.

const test = require("tape");
const assert = require("node:assert");

test("rejects a bad url: t.fail()", async (t) => {
  try {
    await connect("bad");
    t.fail("should have thrown");
  } catch {}
  t.end();
});

test("rejects a bad port: t.ok(false)", async (t) => {
  try {
    await connect("localhost:-1");
    t.ok(false);
  } catch (err) {}
  t.end();
});

// Not a failure: assert(...) with a value that is not the literal `false`.
test("checks a value", async (t) => {
  try {
    assert(await connect("ok"));
  } catch {}
  t.end();
});
