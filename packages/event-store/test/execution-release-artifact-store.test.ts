import { describe, expect, it } from "vitest";

import type { ExecutionReleaseEvidence } from "../src/execution-release-evidence.js";
import {
  ExecutionReleaseArtifactRepository,
  InMemoryExecutionReleaseArtifactStorage,
  type ExecutionReleaseArtifactStorage,
} from "../src/execution-release-artifact-store.js";

const evidence = Object.freeze({
  executionId: "release-artifact-1",
  summary: Object.freeze({}),
  topology: Object.freeze({}),
}) as unknown as ExecutionReleaseEvidence;

describe("execution release artifact repository", () => {
  it("persists and authoritatively reads back the exact governed artifact", () => {
    const repository = new ExecutionReleaseArtifactRepository(new InMemoryExecutionReleaseArtifactStorage());
    const serialized = repository.save("artifact-1", evidence);

    expect(repository.load("artifact-1")).toBe(serialized);
    expect(JSON.parse(serialized)).toEqual(evidence);
  });

  it("fails closed when storage does not acknowledge persistence", () => {
    const storage: ExecutionReleaseArtifactStorage = {
      put: () => false,
      get: () => null,
    };
    const repository = new ExecutionReleaseArtifactRepository(storage);

    expect(() => repository.save("artifact-2", evidence)).toThrow(/did not acknowledge persistence/);
  });

  it("fails closed when acknowledgement readback differs from governed bytes", () => {
    const storage: ExecutionReleaseArtifactStorage = {
      put: () => true,
      get: () => "{}",
    };
    const repository = new ExecutionReleaseArtifactRepository(storage);

    expect(() => repository.save("artifact-3", evidence)).toThrow(/exact governed artifact/);
  });

  it("rejects empty artifact identities", () => {
    const repository = new ExecutionReleaseArtifactRepository(new InMemoryExecutionReleaseArtifactStorage());
    expect(() => repository.save("   ", evidence)).toThrow(/artifactId must be non-empty/);
  });
});
