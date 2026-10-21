import { describe, expect, it } from "vitest";
import {
  ApprovalRejectedError,
  ApprovalRequiredError,
  InvalidApprovalError,
  normalizeApprovalRequest,
  requireApproved,
  resolveApproval,
  type ApprovalRequest,
} from "../src/approval-control.js";

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalId: "approval-1",
    executionId: "execution-1",
    requestVersion: 1,
    stepId: "deploy",
    action: "deploy preview",
    reason: "consequential external change",
    requestedBy: "workflow-runner",
    requestedAt: "2026-08-03T20:00:00.000Z",
    metadata: { repository: "UniversalStandards/atlantis-ai-enhanced" },
    ...overrides,
  };
}

const approved = {
  approvalId: "approval-1",
  executionId: "execution-1",
  requestVersion: 1,
  decision: "approved" as const,
  resolvedBy: "reviewer-1",
  resolvedAt: "2026-08-03T20:01:00.000Z",
};

describe("approval control", () => {
  it("normalizes and freezes approval requests", () => {
    const normalized = normalizeApprovalRequest(
      request({ action: "  deploy preview  ", metadata: { scope: " preview " } }),
    );

    expect(normalized.action).toBe("deploy preview");
    expect(normalized.metadata).toEqual({ scope: "preview" });
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.metadata)).toBe(true);
  });

  it("pauses with a normalized request when no resolution exists", () => {
    expect(() => requireApproved(request())).toThrow(ApprovalRequiredError);

    try {
      requireApproved(request({ action: "  deploy preview  " }));
    } catch (error) {
      expect(error).toBeInstanceOf(ApprovalRequiredError);
      expect((error as ApprovalRequiredError).request.action).toBe("deploy preview");
    }
  });

  it("accepts a matching approval resolution", () => {
    const result = requireApproved(request(), approved);

    expect(result.resolution.decision).toBe("approved");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects a matching rejection resolution", () => {
    expect(() =>
      requireApproved(request(), { ...approved, decision: "rejected" }),
    ).toThrow(ApprovalRejectedError);
  });

  it("fails closed on approval identity mismatch", () => {
    expect(() =>
      resolveApproval(request(), { ...approved, approvalId: "approval-2" }),
    ).toThrow(InvalidApprovalError);
  });

  it("fails closed on execution identity mismatch", () => {
    expect(() =>
      resolveApproval(request(), { ...approved, executionId: "execution-2" }),
    ).toThrow(InvalidApprovalError);
  });

  it("fails closed on stale request-version mismatch", () => {
    expect(() =>
      resolveApproval(request({ requestVersion: 2 }), approved),
    ).toThrow(InvalidApprovalError);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid request version %s",
    (requestVersion) => {
      expect(() => normalizeApprovalRequest(request({ requestVersion }))).toThrow(
        InvalidApprovalError,
      );
    },
  );

  it("rejects resolutions that predate the request", () => {
    expect(() =>
      resolveApproval(request(), {
        ...approved,
        resolvedAt: "2026-08-03T19:59:59.999Z",
      }),
    ).toThrow(InvalidApprovalError);
  });

  it.each(["", "not-a-date", "2026-08-03T20:00:00Z"])(
    "rejects non-canonical request timestamp %s",
    (requestedAt) => {
      expect(() => normalizeApprovalRequest(request({ requestedAt }))).toThrow(
        InvalidApprovalError,
      );
    },
  );

  it("rejects blank metadata values", () => {
    expect(() => normalizeApprovalRequest(request({ metadata: { scope: " " } }))).toThrow(
      InvalidApprovalError,
    );
  });

  it("rejects blank optional comments when supplied", () => {
    expect(() => resolveApproval(request(), { ...approved, comment: " " })).toThrow(
      InvalidApprovalError,
    );
  });
});
