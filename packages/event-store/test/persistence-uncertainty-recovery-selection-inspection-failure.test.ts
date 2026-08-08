import { describe, expect, it } from "vitest";

import type { PersistenceUncertaintyStatus } from "@atlantis/contracts/persistence-uncertainty";

import {
  InvalidPersistenceUncertaintyRecoverySelectionError,
  selectPersistenceUncertaintyRecoveryBatch,
  type PersistenceUncertaintyRecoverySelection,
} from "../src/persistence-uncertainty-recovery-selection.js";

describe("persistence uncertainty recovery selection inspection failures", () => {
  it("normalizes hostile selection prototype inspection into the domain error", () => {
    const selection = new Proxy(
      { statuses: ["pending"] as PersistenceUncertaintyStatus[], limit: 1 },
      {
        getPrototypeOf: () => {
          throw new Error("hostile selection prototype trap");
        },
      },
    );

    expect(() => selectPersistenceUncertaintyRecoveryBatch([], selection)).toThrow(
      InvalidPersistenceUncertaintyRecoverySelectionError,
    );
    expect(() => selectPersistenceUncertaintyRecoveryBatch([], selection)).toThrow(
      "recovery selection could not be inspected safely.",
    );
  });

  it("normalizes hostile selection descriptor inspection into the domain error", () => {
    const selection = new Proxy(
      { statuses: ["pending"] as PersistenceUncertaintyStatus[], limit: 1 },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("hostile selection descriptor trap");
        },
      },
    );

    expect(() => selectPersistenceUncertaintyRecoveryBatch([], selection)).toThrow(
      InvalidPersistenceUncertaintyRecoverySelectionError,
    );
    expect(() => selectPersistenceUncertaintyRecoveryBatch([], selection)).toThrow(
      "recovery selection could not be inspected safely.",
    );
  });

  it("normalizes hostile status-array enumeration into the domain error", () => {
    const statuses = new Proxy(["pending"] as PersistenceUncertaintyStatus[], {
      ownKeys: () => {
        throw new Error("hostile statuses ownKeys trap");
      },
    });

    expect(() => selectPersistenceUncertaintyRecoveryBatch([], {
      statuses,
      limit: 1,
    })).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);
    expect(() => selectPersistenceUncertaintyRecoveryBatch([], {
      statuses,
      limit: 1,
    })).toThrow("recovery selection statuses could not be inspected safely.");
  });

  it("normalizes revoked runtime selections instead of leaking a native proxy error", () => {
    const revocable = Proxy.revocable(
      { statuses: ["pending"] as PersistenceUncertaintyStatus[], limit: 1 },
      {},
    );
    revocable.revoke();

    expect(() => selectPersistenceUncertaintyRecoveryBatch(
      [],
      revocable.proxy as PersistenceUncertaintyRecoverySelection,
    )).toThrow(InvalidPersistenceUncertaintyRecoverySelectionError);
  });

  it("normalizes an uninspectable thrown value instead of leaking instanceof failure", () => {
    const thrownValue = Proxy.revocable({}, {});
    thrownValue.revoke();
    const selection = new Proxy(
      { statuses: ["pending"] as PersistenceUncertaintyStatus[], limit: 1 },
      {
        getPrototypeOf: () => {
          throw thrownValue.proxy;
        },
      },
    );

    expect(() => selectPersistenceUncertaintyRecoveryBatch([], selection)).toThrow(
      InvalidPersistenceUncertaintyRecoverySelectionError,
    );
    expect(() => selectPersistenceUncertaintyRecoveryBatch([], selection)).toThrow(
      "recovery selection could not be inspected safely.",
    );
  });
});
