import { describe } from "vitest";

import { InMemoryRecoveryOwnershipStore } from "../src/recovery-ownership-store.js";
import { recoveryOwnershipStoreConformance } from "./recovery-ownership-store-conformance.js";

describe("recovery ownership store conformance", () => {
  recoveryOwnershipStoreConformance(() => {
    let now = 1_000;
    let claim = 0;
    let token = 0;
    return {
      store: new InMemoryRecoveryOwnershipStore({
        nowEpochMs: () => now,
        createClaimId: () => `conformance-claim-${String(++claim)}`,
        createOwnershipToken: () => `conformance-token-${String(++token)}`,
        maxLeaseDurationMs: 1_000,
      }),
      clock: {
        setNow(value: number) {
          now = value;
        },
      },
    };
  });
});
