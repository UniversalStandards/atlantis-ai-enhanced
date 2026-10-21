import { describe, expect, it } from "vitest";
import type { ExternalEffectOwnershipStore } from "../src/external-effect-ownership.js";
import { ObservableExternalEffectOwnershipStore } from "../src/observable-external-effect-ownership-store.js";

const authoritativeStore = {} as ExternalEffectOwnershipStore;
const observer = { onLifecycleEvent() {} };

describe("ObservableExternalEffectOwnershipStore options", () => {
  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects a %s observation deadline", (_label, observationTimeoutMs) => {
    expect(
      () =>
        new ObservableExternalEffectOwnershipStore(
          authoritativeStore,
          observer,
          { observationTimeoutMs },
        ),
    ).toThrow("observationTimeoutMs must be a positive safe integer");
  });

  it.each([1, Number.MAX_SAFE_INTEGER])(
    "accepts the positive safe-integer deadline %s",
    (observationTimeoutMs) => {
      expect(
        () =>
          new ObservableExternalEffectOwnershipStore(
            authoritativeStore,
            observer,
            { observationTimeoutMs },
          ),
      ).not.toThrow();
    },
  );

  it("accepts the documented default deadline", () => {
    expect(
      () =>
        new ObservableExternalEffectOwnershipStore(
          authoritativeStore,
          observer,
        ),
    ).not.toThrow();
  });
});
