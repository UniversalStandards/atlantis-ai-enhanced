import { describe, expect, it, vi } from "vitest";

import {
  InvalidImmutableWriterCommitEvidenceError,
  verifyImmutableWriterCommitEvidence,
} from "../src/immutable-writer-commit-evidence.js";

const expected = {
  operationId: "append-operation-1",
  executionId: "execution-1",
  eventId: "event-1",
  streamVersion: 4,
  contentDigest: "sha256:expected",
} as const;

const baseEvidence = {
  evidenceId: "commit-evidence-1",
  operationId: expected.operationId,
  executionId: expected.executionId,
  eventId: expected.eventId,
  streamVersion: expected.streamVersion,
  contentDigest: expected.contentDigest,
} as const;

describe("immutable writer commit evidence", () => {
  it("accepts each architecture-approved mechanism only with its required durable identifier", () => {
    const receipt = verifyImmutableWriterCommitEvidence(expected, {
      ...baseEvidence,
      mechanism: "transaction_bound_receipt",
      transactionReceiptId: "receipt-1",
    });
    expect(receipt).toEqual({
      ...baseEvidence,
      mechanism: "transaction_bound_receipt",
      transactionReceiptId: "receipt-1",
    });
    expect(Object.isFrozen(receipt)).toBe(true);

    expect(verifyImmutableWriterCommitEvidence(expected, {
      ...baseEvidence,
      mechanism: "operation_bound_historical_record",
      historicalRecordId: "history-1",
    })).toEqual({
      ...baseEvidence,
      mechanism: "operation_bound_historical_record",
      historicalRecordId: "history-1",
    });

    expect(verifyImmutableWriterCommitEvidence(expected, {
      ...baseEvidence,
      mechanism: "provider_operation_with_historical_record",
      providerOperationId: "provider-operation-1",
      historicalRecordId: "history-1",
    })).toEqual({
      ...baseEvidence,
      mechanism: "provider_operation_with_historical_record",
      providerOperationId: "provider-operation-1",
      historicalRecordId: "history-1",
    });
  });

  it("rejects event/version historical evidence from a different admitted writer operation", () => {
    expect(() => verifyImmutableWriterCommitEvidence(expected, {
      ...baseEvidence,
      mechanism: "operation_bound_historical_record",
      operationId: "append-operation-2",
      historicalRecordId: "history-1",
    })).toThrowError(
      new InvalidImmutableWriterCommitEvidenceError(
        "evidence must be bound to the exact admitted append identity",
      ),
    );
  });

  it("rejects any mismatch in execution, event, version, or digest binding", () => {
    for (const mismatchedEvidence of [
      { ...baseEvidence, executionId: "execution-2" },
      { ...baseEvidence, eventId: "event-2" },
      { ...baseEvidence, streamVersion: 5 },
      { ...baseEvidence, contentDigest: "sha256:different" },
    ]) {
      expect(() => verifyImmutableWriterCommitEvidence(expected, {
        ...mismatchedEvidence,
        mechanism: "transaction_bound_receipt",
        transactionReceiptId: "receipt-1",
      })).toThrow(InvalidImmutableWriterCommitEvidenceError);
    }
  });

  it("rejects incomplete mechanism-specific proof shapes", () => {
    for (const incompleteEvidence of [
      {
        ...baseEvidence,
        mechanism: "transaction_bound_receipt",
      },
      {
        ...baseEvidence,
        mechanism: "operation_bound_historical_record",
      },
      {
        ...baseEvidence,
        mechanism: "provider_operation_with_historical_record",
        providerOperationId: "provider-operation-1",
      },
      {
        ...baseEvidence,
        mechanism: "provider_operation_with_historical_record",
        historicalRecordId: "history-1",
      },
    ]) {
      expect(() => verifyImmutableWriterCommitEvidence(
        expected,
        incompleteEvidence as never,
      )).toThrow(InvalidImmutableWriterCommitEvidenceError);
    }
  });

  it("rejects unsupported mechanisms, unexpected fields, and empty optional identifiers", () => {
    for (const malformedEvidence of [
      {
        ...baseEvidence,
        mechanism: "current_state_readback",
        historicalRecordId: "history-1",
      },
      {
        ...baseEvidence,
        mechanism: "transaction_bound_receipt",
        transactionReceiptId: "receipt-1",
        unexpected: true,
      },
      {
        ...baseEvidence,
        mechanism: "transaction_bound_receipt",
        transactionReceiptId: "",
      },
    ]) {
      expect(() => verifyImmutableWriterCommitEvidence(
        expected,
        malformedEvidence as never,
      )).toThrow(InvalidImmutableWriterCommitEvidenceError);
    }
  });

  it("rejects accessor-backed evidence without executing the accessor", () => {
    const operationIdGetter = vi.fn(() => expected.operationId);
    const evidence = {
      ...baseEvidence,
      mechanism: "transaction_bound_receipt",
      transactionReceiptId: "receipt-1",
    } as Record<string, unknown>;

    Object.defineProperty(evidence, "operationId", {
      enumerable: true,
      get: operationIdGetter,
    });

    expect(() => verifyImmutableWriterCommitEvidence(
      expected,
      evidence as never,
    )).toThrow(InvalidImmutableWriterCommitEvidenceError);
    expect(operationIdGetter).not.toHaveBeenCalled();
  });
});
