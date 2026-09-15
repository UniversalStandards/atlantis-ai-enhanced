import { describe, expect, it } from "vitest";
import {
  InvalidTrackerControlPlanePolicyError,
  createAuthorityDescriptor,
  createControlPlaneIncident,
  createDriftEvaluationRequest,
  evaluateDrift,
  incidentSlaPolicy,
  trackerControlPlanePolicyVersion,
} from "../../src/control-plane-policy/index.js";

const sourceIdentity = createAuthorityDescriptor("tracker-sync", {
  authorityId: "tracker-sync-source",
  tokenValue: "tracker-sync-source-token",
  issuedAt: "2026-09-15T21:32:16.968Z",
  issuedBy: "policy-engine",
  justification: "source identity for drift decisions",
  evidence: ["evidence:source"],
});

const targetIdentity = createAuthorityDescriptor("release", {
  authorityId: "release-target",
  tokenValue: "release-target-token",
  issuedAt: "2026-09-15T21:32:16.968Z",
  issuedBy: "policy-engine",
  justification: "target identity for drift decisions",
  evidence: ["evidence:target"],
});

function incident() {
  return createControlPlaneIncident({
    incidentId: "incident-1",
    summary: "duplicate mirror rows detected",
    severity: "high",
    owner: "tracker-control-plane",
    slaClass: "P1",
    escalationState: "pending-triage",
    sourceIdentity,
    targetIdentity,
    classification: "automation-control",
    provenance: {
      detectedAt: "2026-09-15T21:32:16.968Z",
      detectedBy: "tracker-sync",
      authoritativeRecordLocator: "github:issues/50",
      evidence: ["evidence:drift", "evidence:mirror"],
    },
  });
}

describe("drift policy", () => {
  it("routes the full drift matrix to automatic remediation, review, or blocked outcomes", () => {
    const remediated = [
      evaluateDrift(
        createDriftEvaluationRequest({
          driftClassification: "safe-stale-mirror",
          projectionClassification: "program-work",
          sourceIdentity,
          targetIdentity,
        }),
      ),
      evaluateDrift(
        createDriftEvaluationRequest({
          driftClassification: "missing-unambiguous-row",
          projectionClassification: "program-work",
          sourceIdentity,
          targetIdentity,
        }),
      ),
    ];
    expect(remediated).toEqual([
      expect.objectContaining({
        outcome: "automatic-remediation",
        remediation: "reconcile-stale-mirror",
      }),
      expect.objectContaining({
        outcome: "automatic-remediation",
        remediation: "create-unambiguous-row",
      }),
    ]);

    const duplicateRows = evaluateDrift(
      createDriftEvaluationRequest({
        driftClassification: "duplicate-rows",
        projectionClassification: "excluded",
        sourceIdentity,
        targetIdentity,
        incident: incident(),
      }),
    );
    expect(duplicateRows.outcome).toBe("human-review");
    expect(duplicateRows.automaticDeletionPermitted).toBe(false);
    expect(duplicateRows.incident.owner).toBe("tracker-control-plane");
    expect(duplicateRows.incident.sla).toEqual(incidentSlaPolicy().P1);
    expect(duplicateRows.incident.severity).toBe("high");
    expect(duplicateRows.incident.provenance.authoritativeRecordLocator).toBe(
      "github:issues/50",
    );

    const conflictingState = evaluateDrift(
      createDriftEvaluationRequest({
        driftClassification: "conflicting-authoritative-state",
        projectionClassification: "release-control",
        sourceIdentity,
        targetIdentity,
        incident: incident(),
      }),
    );
    expect(conflictingState.outcome).toBe("human-review");

    for (const driftClassification of [
      "ambiguous-mapping",
      "schema-incompatibility",
      "unverifiable-write",
    ] as const) {
      const blocked = evaluateDrift(
        createDriftEvaluationRequest({
          driftClassification,
          projectionClassification: "automation-control",
          sourceIdentity,
          targetIdentity,
          incident: incident(),
        }),
      );
      expect(blocked.outcome).toBe("blocked");
      expect(blocked.failClosed).toBe(true);
      expect(blocked.incident.owner).toBe("tracker-control-plane");
      expect(blocked.incident.sla).toEqual(incidentSlaPolicy().P1);
      expect(blocked.incident.provenance.evidence).toEqual([
        "evidence:drift",
        "evidence:mirror",
      ]);
    }
  });

  it("fails closed for malformed incidents, unsupported versions, and unknown classifications", () => {
    expect(() =>
      evaluateDrift(
        createDriftEvaluationRequest({
          driftClassification: "duplicate-rows",
          projectionClassification: "excluded",
          sourceIdentity,
          targetIdentity,
        }),
      )
    ).toThrow(/incident is required/i);

    expect(() =>
      createControlPlaneIncident({
        incidentId: "incident-2",
        summary: "malformed incident",
        severity: "medium",
        owner: "",
        slaClass: "P2",
        escalationState: "acknowledged",
        sourceIdentity,
        targetIdentity,
        classification: "program-work" as "automation-control",
        provenance: {
          detectedAt: "2026-09-15T21:32:16.968Z",
          detectedBy: "tracker-sync",
          authoritativeRecordLocator: "github:issues/50",
          evidence: ["evidence:malformed"],
        },
      })
    ).toThrow(InvalidTrackerControlPlanePolicyError);

    expect(() =>
      evaluateDrift({
        policyVersion: "tracker-control-plane/v2" as typeof trackerControlPlanePolicyVersion,
        driftClassification: "safe-stale-mirror",
        projectionClassification: "program-work",
        sourceIdentity,
        targetIdentity,
      })
    ).toThrow(/policyVersion must be tracker-control-plane\/v1/i);

    expect(() =>
      evaluateDrift(
        createDriftEvaluationRequest({
          driftClassification: "not-supported" as "safe-stale-mirror",
          projectionClassification: "program-work",
          sourceIdentity,
          targetIdentity,
        }),
      )
    ).toThrow(InvalidTrackerControlPlanePolicyError);
  });
});
