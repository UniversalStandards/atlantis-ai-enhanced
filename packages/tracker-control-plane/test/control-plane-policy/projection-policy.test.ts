import { describe, expect, it } from "vitest";
import {
  InvalidTrackerControlPlanePolicyError,
  classifyProjectionCandidate,
  createAuthorityDescriptor,
  createProjectionClassificationRequest,
  systemControlLabels,
  trackerControlPlanePolicyVersion,
} from "../../src/control-plane-policy/index.js";

const trackerSync = createAuthorityDescriptor("tracker-sync", {
  authorityId: "tracker-sync-1",
  tokenValue: "tracker-sync-token-value",
  issuedAt: "2026-09-15T21:32:16.968Z",
  issuedBy: "policy-engine",
  justification: "tracker sync projection classification",
  evidence: ["evidence:tracker-sync"],
});

function combinations<T>(values: readonly T[]): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let mask = 1; mask < 2 ** values.length; mask += 1) {
    const next: T[] = [];
    for (let index = 0; index < values.length; index += 1) {
      if ((mask & (1 << index)) !== 0) {
        next.push(values[index] as T);
      }
    }
    result.push(next);
  }
  return result;
}

describe("projection classification policy", () => {
  it("allows unlabeled ordinary work to remain program-work", () => {
    const decision = classifyProjectionCandidate(
      createProjectionClassificationRequest({
        requestedClassification: "program-work",
        labels: [],
        sourceIdentity: trackerSync,
      }),
    );

    expect(decision.classification).toBe("program-work");
    expect(decision.projectedAsProgramWork).toBe(true);
    expect(decision.controlPlaneOnly).toBe(false);
  });

  it("excludes every system-control label combination from normal program-work projection", () => {
    for (const labels of combinations(systemControlLabels)) {
      for (const candidate of [labels, [...labels].reverse()]) {
        const decision = classifyProjectionCandidate(
          createProjectionClassificationRequest({
            requestedClassification: "program-work",
            labels: candidate,
            sourceIdentity: trackerSync,
          }),
        );

        expect(decision.classification).toBe("excluded");
        expect(decision.projectedAsProgramWork).toBe(false);
        expect(decision.controlPlaneOnly).toBe(true);
        expect(new Set(decision.matchedSystemControlLabels)).toEqual(new Set(labels));
      }
    }
  });

  it("keeps control-plane classifications eligible for control-plane handling", () => {
    const decision = classifyProjectionCandidate(
      createProjectionClassificationRequest({
        requestedClassification: "automation-control",
        labels: ["tracker-drift", "sync-internal"],
        sourceIdentity: trackerSync,
      }),
    );

    expect(decision.classification).toBe("automation-control");
    expect(decision.projectedAsProgramWork).toBe(false);
    expect(decision.controlPlaneOnly).toBe(true);
  });

  it("fails closed on unknown labels and unsupported classifications", () => {
    expect(() =>
      classifyProjectionCandidate(
        createProjectionClassificationRequest({
          requestedClassification: "program-work",
          labels: ["unknown-label"],
          sourceIdentity: trackerSync,
        }),
      )
    ).toThrow(InvalidTrackerControlPlanePolicyError);

    expect(() =>
      classifyProjectionCandidate({
        policyVersion: trackerControlPlanePolicyVersion,
        requestedClassification: "not-supported" as "program-work",
        labels: [],
        sourceIdentity: trackerSync,
      })
    ).toThrow(InvalidTrackerControlPlanePolicyError);
  });
});
