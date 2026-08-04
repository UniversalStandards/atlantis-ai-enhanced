import { describe, expect, it } from "vitest";

import {
  InvalidExactDataRecordError,
  normalizeExactDataRecord,
  requireExactDataFields,
} from "../src/exact-data-record.js";

describe("normalizeExactDataRecord", () => {
  it("copies only allowed enumerable data fields", () => {
    const record = normalizeExactDataRecord(
      "claim",
      { ownerId: "worker-1", generation: 7 },
      ["ownerId", "generation"],
    );

    expect(record).toEqual({ ownerId: "worker-1", generation: 7 });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.getPrototypeOf(record)).toBe(null);
  });

  it("rejects accessors without invoking them", () => {
    let getterCalls = 0;
    const input = Object.defineProperty({}, "ownerId", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "worker-1";
      },
    });

    expect(() =>
      normalizeExactDataRecord("claim", input, ["ownerId"]),
    ).toThrowError(InvalidExactDataRecordError);
    expect(getterCalls).toBe(0);
  });

  it("rejects non-enumerable authorization fields", () => {
    const input = Object.defineProperty({}, "claimToken", {
      enumerable: false,
      value: "secret-token",
    });

    expect(() =>
      normalizeExactDataRecord("claim", input, ["claimToken"]),
    ).toThrow("claim.claimToken must be an enumerable data property");
  });

  it("rejects inherited required fields", () => {
    const input = Object.create({ ownerId: "inherited-worker" }) as object;
    Object.defineProperty(input, "leaseDurationMs", {
      enumerable: true,
      value: 1_000,
    });

    expect(() =>
      normalizeExactDataRecord("ownership request", input, [
        "ownerId",
        "leaseDurationMs",
      ]),
    ).toThrow("ownership request must be a plain data record");
  });

  it("rejects symbols and unexpected fields", () => {
    expect(() =>
      normalizeExactDataRecord(
        "renewal request",
        { leaseDurationMs: 1_000, extra: true },
        ["leaseDurationMs"],
      ),
    ).toThrow("renewal request contains unexpected field extra");

    expect(() =>
      normalizeExactDataRecord(
        "claim",
        { claimToken: "token", [Symbol("hidden")]: "value" },
        ["claimToken"],
      ),
    ).toThrow("claim must not contain symbol fields");
  });
});

describe("requireExactDataFields", () => {
  it("requires every declared field as an own property", () => {
    const record = normalizeExactDataRecord(
      "renewal request",
      {},
      ["leaseDurationMs"],
    );

    expect(() =>
      requireExactDataFields("renewal request", record, ["leaseDurationMs"]),
    ).toThrow("renewal request is missing required field leaseDurationMs");
  });
});
