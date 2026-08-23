import { describe, expect, it } from "vitest";

import type { ExecutionReleaseArtifactStorage } from "../src/execution-release-artifact-store.js";
import {
  Day7ReleaseReadinessArtifactRepository,
} from "../src/day7-release-readiness-artifact.js";
import type {
  Day7ReleaseReadinessEvidence,
} from "../src/day7-release-readiness.js";

interface DurableReadinessArtifactFixture {
  createStorage(): ExecutionReleaseArtifactStorage;
  restart(): void;
  failNextPutBeforeCommit(): void;
  loseNextPutAcknowledgement(): void;
}

function readinessEvidence(): Day7ReleaseReadinessEvidence {
  const candidateIdentity = Object.freeze({
    candidateHeadSha: "candidate-head",
    candidateMergeSha: "candidate-merge",
    workflowRunId: "workflow-run",
    verificationMatrixRevision: "matrix-revision",
    operatorRunbookRevision: "runbook-revision",
    dependencyLockDigest: "lock-digest",
    configurationSchemaVersion: "config-v1",
    deploymentIdentity: "deployment-1",
    recordedAtEpochMs: 1,
  });
  const check = (checkId: string) => Object.freeze({
    checkId,
    expectedCondition: "pass",
    observedCondition: "pass",
    result: "PASS" as const,
    evidenceId: `${checkId}-evidence`,
  });
  const step = (stepId: string, startedAtEpochMs: number, completedAtEpochMs: number) => Object.freeze({
    stepId,
    startedAtEpochMs,
    completedAtEpochMs,
    result: "PASS" as const,
    evidenceId: `${stepId}-evidence`,
  });
  const independentGateIds = [
    "regression-ci",
    "unauthorized-protected-actions",
    "governed-repository-improvement",
    "self-improvement-human-review",
    "external-artifact-durability",
    "recovery-ownership-durability",
    "ownership-writer-atomicity",
    "provider-failover",
    "trace-completeness",
    "telemetry-binding",
    "adversarial-security",
    "browser-runtime",
    "operator-runbook",
    "deployment-reproducibility",
  ] as const;

  return {
    candidateIdentity,
    deployment: {
      deploymentRehearsalId: "deployment-rehearsal",
      candidateIdentity,
      immutableArtifactIdentities: ["release-artifact"],
      environmentClass: "rehearsal",
      configurationDigest: "config-digest",
      migrationPrerequisiteEvidence: [],
      startedAtEpochMs: 1,
      completedAtEpochMs: 2,
      steps: [step("deploy", 1, 2)],
      postDeployChecks: [check("deploy-check")],
      releaseEvidenceArtifactId: "release-artifact",
      result: "PASS",
      failureReason: null,
    },
    rollback: {
      rollbackRehearsalId: "rollback-rehearsal",
      candidateIdentity,
      fromDeploymentIdentity: "deployment-1",
      targetKnownGoodIdentity: "known-good",
      compatibilityEvidence: ["compatibility-evidence"],
      preservedAuthorityEvidence: ["authority-evidence"],
      startedAtEpochMs: 3,
      completedAtEpochMs: 4,
      steps: [step("rollback", 3, 4)],
      postRollbackChecks: [check("rollback-check")],
      uncertainOperations: [],
      result: "PASS",
      failureReason: null,
    },
    burnIn: {
      burnInId: "burn-in",
      candidateIdentity,
      plannedDurationMs: 10,
      startedAtEpochMs: 10,
      endedAtEpochMs: 20,
      executionCounts: { attempted: 1, completed: 1, failed: 0, waitingApproval: 0 },
      approvalOutcomes: ["approval-evidence"],
      injectedFailures: [],
      ownershipEvents: ["ownership-evidence"],
      persistenceUncertaintyEvents: [],
      telemetryFailures: [],
      securityFindings: [],
      regressionEvidence: ["regression-evidence"],
      traceCompletenessEvidence: ["trace-evidence"],
      incidents: [],
      finalDisposition: "PASS",
    },
    independentGates: independentGateIds.map((gateId) => ({
      gateId,
      candidateIdentity,
      disposition: "PASS" as const,
      evidenceIds: [`${gateId}-evidence`],
      blockerReason: null,
    })),
    disposition: "PASS",
    blockingGateIds: [],
  };
}

/**
 * Reusable provider-neutral durability gate for the final Day-7 readiness artifact.
 * A concrete fixture must represent shared durable state across adapter replacement;
 * process-local fixtures are harness self-tests only and are not release evidence.
 */
export function registerDay7ReadinessArtifactDurableConformance(
  name: string,
  createFixture: () => DurableReadinessArtifactFixture,
): void {
  describe(`${name} Day-7 readiness artifact durability`, () => {
    it("survives adapter restart with exact canonical candidate-bound evidence", () => {
      const fixture = createFixture();
      const artifactId = "readiness/candidate-1";
      const expected = readinessEvidence();
      const written = new Day7ReleaseReadinessArtifactRepository(fixture.createStorage()).save(
        artifactId,
        expected,
      );
      fixture.restart();
      const restored = new Day7ReleaseReadinessArtifactRepository(fixture.createStorage()).load(artifactId);
      expect(restored).toEqual(expected);
      expect(JSON.stringify(restored)).toBe(written);
    });

    it("does not expose readiness evidence when persistence fails before commit", () => {
      const fixture = createFixture();
      const artifactId = "readiness/candidate-2";
      fixture.failNextPutBeforeCommit();
      expect(() =>
        new Day7ReleaseReadinessArtifactRepository(fixture.createStorage()).save(
          artifactId,
          readinessEvidence(),
        ),
      ).toThrow();
      fixture.restart();
      expect(new Day7ReleaseReadinessArtifactRepository(fixture.createStorage()).load(artifactId)).toBeNull();
    });

    it("settles acknowledgement loss by exact authoritative readback without rewriting", () => {
      const fixture = createFixture();
      const artifactId = "readiness/candidate-3";
      const expected = readinessEvidence();
      fixture.loseNextPutAcknowledgement();
      expect(() =>
        new Day7ReleaseReadinessArtifactRepository(fixture.createStorage()).save(artifactId, expected),
      ).toThrow();
      fixture.restart();
      const repository = new Day7ReleaseReadinessArtifactRepository(fixture.createStorage());
      const settled = repository.reconcile(artifactId, expected);
      expect(repository.load(artifactId)).toEqual(expected);
      expect(JSON.parse(settled)).toMatchObject({ disposition: "PASS" });
    });

    it("rejects acknowledgement-loss settlement for substituted candidate evidence", () => {
      const fixture = createFixture();
      const artifactId = "readiness/candidate-4";
      const expected = readinessEvidence();
      fixture.loseNextPutAcknowledgement();
      expect(() =>
        new Day7ReleaseReadinessArtifactRepository(fixture.createStorage()).save(artifactId, expected),
      ).toThrow();
      fixture.restart();
      const substituted = {
        ...expected,
        candidateIdentity: { ...expected.candidateIdentity, candidateHeadSha: "substituted-head" },
      } as Day7ReleaseReadinessEvidence;
      expect(() =>
        new Day7ReleaseReadinessArtifactRepository(fixture.createStorage()).reconcile(
          artifactId,
          substituted,
        ),
      ).toThrow();
    });
  });
}

class ProcessLocalReadinessArtifactFixture implements DurableReadinessArtifactFixture {
  readonly #artifacts = new Map<string, string>();
  #failBeforeCommit = false;
  #loseAcknowledgement = false;

  public createStorage(): ExecutionReleaseArtifactStorage {
    return {
      put: (artifactId, serializedEvidence) => {
        if (this.#failBeforeCommit) {
          this.#failBeforeCommit = false;
          return false;
        }
        this.#artifacts.set(artifactId, serializedEvidence);
        if (this.#loseAcknowledgement) {
          this.#loseAcknowledgement = false;
          return false;
        }
        return true;
      },
      get: (artifactId) => this.#artifacts.get(artifactId) ?? null,
    };
  }

  public restart(): void {
    // Adapter replacement only. Shared state remains process-local for harness verification.
  }

  public failNextPutBeforeCommit(): void {
    this.#failBeforeCommit = true;
  }

  public loseNextPutAcknowledgement(): void {
    this.#loseAcknowledgement = true;
  }
}

registerDay7ReadinessArtifactDurableConformance(
  "process-local shared-state harness self-test",
  () => new ProcessLocalReadinessArtifactFixture(),
);
