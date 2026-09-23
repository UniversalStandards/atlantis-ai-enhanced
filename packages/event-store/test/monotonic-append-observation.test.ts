import { describe, expect, it } from "vitest";

import { isMonotonicAppendCandidateObserved } from "../src/monotonic-append-observation.js";

function candidate(events: readonly unknown[]): string {
  return JSON.stringify(events);
}

describe("monotonic append observation", () => {
  const writerA = [
    {
      streamId: "workflow-1",
      eventId: "event-a",
      eventType: "workflow.step.completed",
      payload: { value: "a" },
      occurredAt: "2026-08-07T00:00:00.000Z",
      traceId: "trace-1",
      sequence: 1,
      streamVersion: 1,
    },
  ] as const;

  it("accepts an exact immediate-successor observation", () => {
    const value = candidate(writerA);

    expect(
      isMonotonicAppendCandidateObserved(0, value, {
        revision: 1,
        value,
      }),
    ).toBe(true);
  });

  it("accepts writer A after writer B advances an append-only snapshot", () => {
    const writerB = {
      streamId: "workflow-2",
      eventId: "event-b",
      eventType: "workflow.step.completed",
      payload: { value: "b" },
      occurredAt: "2026-08-07T00:00:01.000Z",
      traceId: "trace-2",
      sequence: 2,
      streamVersion: 1,
    };

    expect(
      isMonotonicAppendCandidateObserved(0, candidate(writerA), {
        revision: 2,
        value: candidate([...writerA, writerB]),
      }),
    ).toBe(true);
  });

  it("fails closed when the historical candidate prefix has changed", () => {
    const divergent = [
      {
        ...writerA[0],
        eventType: "workflow.step.tampered",
      },
      {
        streamId: "workflow-2",
        eventId: "event-b",
        eventType: "workflow.step.completed",
        payload: { value: "b" },
        occurredAt: "2026-08-07T00:00:01.000Z",
        traceId: "trace-2",
        sequence: 2,
        streamVersion: 1,
      },
    ];

    expect(
      isMonotonicAppendCandidateObserved(0, candidate(writerA), {
        revision: 2,
        value: candidate(divergent),
      }),
    ).toBe(false);
  });

  it("fails closed when revision advancement is not matched by append growth", () => {
    expect(
      isMonotonicAppendCandidateObserved(0, candidate(writerA), {
        revision: 9,
        value: candidate(writerA),
      }),
    ).toBe(false);
  });

  it("fails closed for malformed or regressed observations", () => {
    const value = candidate(writerA);

    expect(
      isMonotonicAppendCandidateObserved(0, value, {
        revision: 0,
        value,
      }),
    ).toBe(false);
    expect(
      isMonotonicAppendCandidateObserved(0, value, {
        revision: 2,
        value: "not-json",
      }),
    ).toBe(false);
    expect(
      isMonotonicAppendCandidateObserved(Number.NaN, value, {
        revision: 1,
        value,
      }),
    ).toBe(false);
  });
});
