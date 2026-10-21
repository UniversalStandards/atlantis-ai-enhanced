import { describe, expect, it } from "vitest";

import {
  CanonicalJsonCandidateError,
  createCanonicalJsonCandidate,
} from "../src/canonical-json-candidate.js";

describe("canonical JSON candidate boundary", () => {
  it("produces a stable immutable handoff string after exact restoration", () => {
    const source = { records: [{ id: "record-1", version: 1 }] };

    const candidate = createCanonicalJsonCandidate(source, (parsed) => {
      const restored = parsed as typeof source;
      return Object.freeze({
        records: Object.freeze(
          restored.records.map((record) => Object.freeze({ ...record })),
        ),
      });
    });

    source.records[0]!.version = 99;
    source.records.push({ id: "record-2", version: 1 });

    expect(candidate.serialized).toBe(
      '{"records":[{"id":"record-1","version":1}]}',
    );
    expect(candidate.restored.records).toEqual([
      { id: "record-1", version: 1 },
    ]);
    expect(Object.isFrozen(candidate)).toBe(true);
  });

  it("rejects a lossy or reordered representation before storage handoff", () => {
    const source = {
      toJSON() {
        return { z: 1, a: 2 };
      },
    };

    expect(() => createCanonicalJsonCandidate(source, (parsed) => {
      const restored = parsed as { a: number; z: number };
      return Object.freeze({ a: restored.a, z: restored.z });
    })).toThrowError(new CanonicalJsonCandidateError(
      "candidate state must round-trip to an identical canonical JSON representation.",
    ));
  });

  it("fails closed when candidate serialization throws", () => {
    const source = {
      toJSON() {
        throw new Error("serialization side effect");
      },
    };

    expect(() => createCanonicalJsonCandidate(source, (parsed) => parsed))
      .toThrowError(new CanonicalJsonCandidateError(
        "candidate state must serialize as JSON.",
      ));
  });

  it("fails closed when the candidate does not serialize to a JSON string", () => {
    expect(() => createCanonicalJsonCandidate(undefined, (parsed) => parsed))
      .toThrowError(new CanonicalJsonCandidateError(
        "candidate state must serialize to a JSON string.",
      ));
  });
});
