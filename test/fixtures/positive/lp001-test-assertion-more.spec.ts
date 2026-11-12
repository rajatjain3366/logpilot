// Positive fixture for LP001 (swallowed test assertion), Milestone 2.5: more calls that fail a
// test by throwing. The empty catch swallows that failure too, so the check can never fail:
// severity "high", confidence "high".

import assert from "node:assert";
import * as chai from "chai";
import { describe, it } from "mocha";
import { assert as test } from "./shared"; // an assertion library under another name

declare function connect(url: string): Promise<void>;

describe("connect", () => {
  it("rejects a bad url: assert(false)", async () => {
    try {
      await connect("bad");
      assert(false, "should have thrown");
    } catch {}
  });

  it("rejects a bad port: assert.ok(false)", async () => {
    try {
      await connect("localhost:-1");
      assert.ok(false);
    } catch (err) {}
  });

  it("rejects an empty url: chai.expect.fail()", async () => {
    try {
      await connect("");
      chai.expect.fail("should have thrown");
    } catch {}
  });

  it("rejects a relative url: chai.assert.fail()", async () => {
    try {
      await connect("./x");
      chai.assert.fail();
    } catch {}
  });

  it("rejects a missing host: test.ok(false), where test is an assertion library", async () => {
    try {
      await connect("mongodb://");
      test.ok(false);
    } catch {}
  });

  it("rejects a closed client: test.fail(), where test is an assertion library", async () => {
    try {
      await connect("closed");
      test.fail("should have thrown");
    } catch {}
  });
});
