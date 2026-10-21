import { describe, expect, it } from "vitest";
import {
  InvalidDurableAppendEvidenceError,
  reconcileDurableAppendUncertainty,
  validateDurableAppendUncertaintyRecord,
  type DurableAppendUncertaintyRecord,
} from "../src/durable-append-outcome.js";

const base = (): DurableAppendUncertaintyRecord => ({
  identity: {
    operationId: "op-1",
    executionId: "exec-1",
    eventId: "event-1",
    expectedStreamVersion: 4,
    contentDigest: "sha256:abc",
  },
  firstAttemptEpochMs: 100,
  lastAttemptEpochMs: 120,
  reconciliationState: "pending",
  retryCount: 0,
  lastObservedEvidenceId: "evidence-uncertain",
});

describe("durable append uncertainty", () => {
  it("reconciles an exact authoritative commit without retrying the mutation", () => {
    const settled = reconcileDurableAppendUncertainty(base(), {
      operationId: "op-1",
      evidenceId: "evidence-readback",
      status: "exact-commit",
      executionId: "exec-1",
      eventId: "event-1",
      streamVersion: 5,
      contentDigest: "sha256:abc",
    });
    expect(settled.reconciliationState).toBe("committed");
    expect(settled.retryCount).toBe(0);
    expect(settled.lastObservedEvidenceId).toBe("evidence-readback");
  });

  it("classifies authoritative non-commit before any retry is permitted", () => {
    const settled = reconcileDurableAppendUncertainty(base(), {
      operationId: "op-1",
      evidenceId: "evidence-no-commit",
      status: "absent-known-not-committed",
      executionId: "exec-1",
      eventId: "event-1",
    });
    expect(settled.reconciliationState).toBe("known-failure");
  });

  it("keeps ambiguous authoritative evidence pending", () => {
    const settled = reconcileDurableAppendUncertainty(base(), {
      operationId: "op-1",
      evidenceId: "evidence-still-ambiguous",
      status: "ambiguous",
      executionId: "exec-1",
      eventId: "event-1",
    });
    expect(settled.reconciliationState).toBe("pending");
  });

  it("quarantines an exact-commit claim whose immutable digest differs", () => {
    const settled = reconcileDurableAppendUncertainty(base(), {
      operationId: "op-1",
      evidenceId: "evidence-substitution",
      status: "exact-commit",
      executionId: "exec-1",
      eventId: "event-1",
      streamVersion: 5,
      contentDigest: "sha256:other",
    });
    expect(settled.reconciliationState).toBe("quarantined");
    expect(settled.quarantineReason).toMatch(/content digest/i);
  });

  it("rejects authoritative readback identity substitution", () => {
    expect(() => reconcileDurableAppendUncertainty(base(), {
      operationId: "op-other",
      evidenceId: "evidence-other",
      status: "ambiguous",
      executionId: "exec-1",
      eventId: "event-1",
    })).toThrow(InvalidDurableAppendEvidenceError);
  });

  it("requires quarantine reason only for quarantined records", () => {
    expect(() => validateDurableAppendUncertaintyRecord({
      ...base(),
      reconciliationState: "quarantined",
    })).toThrow(InvalidDurableAppendEvidenceError);
    expect(() => validateDurableAppendUncertaintyRecord({
      ...base(),
      quarantineReason: "not allowed",
    })).toThrow(InvalidDurableAppendEvidenceError);
  });

  it("rejects unsupported reconciliation states at the runtime boundary", () => {
    expect(() => validateDurableAppendUncertaintyRecord({
      ...base(),
      reconciliationState: "settled" as DurableAppendUncertaintyRecord["reconciliationState"],
    })).toThrow(InvalidDurableAppendEvidenceError);
  });
});
