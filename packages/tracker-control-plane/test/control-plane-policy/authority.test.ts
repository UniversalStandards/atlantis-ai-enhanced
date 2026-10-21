import { describe, expect, it } from "vitest";
import {
  InvalidTrackerControlPlanePolicyError,
  assertAuthorityClass,
  controlPlaneAuthorityClasses,
  createAuthorityDescriptor,
  selectAuthorityForClass,
  trackerControlPlanePolicyVersion,
  validateAuthorityDescriptor,
  type ControlPlaneAuthorityClass,
  type ControlPlaneAuthorityDescriptor,
} from "../../src/control-plane-policy/index.js";

function authority(authorityClass: ControlPlaneAuthorityClass): ControlPlaneAuthorityDescriptor {
  return createAuthorityDescriptor(authorityClass, {
    authorityId: `${authorityClass}-id`,
    tokenIdentity: `${authorityClass}-token-id`,
    issuedAt: "2026-09-15T21:32:16.968Z",
    issuedBy: "policy-engine",
    justification: `${authorityClass} authority issued for deterministic test`,
    evidence: [`evidence:${authorityClass}`],
  });
}

describe("control-plane authority policy", () => {
  it("validates non-interchangeable role descriptors", () => {
    const descriptors: ControlPlaneAuthorityDescriptor[] = controlPlaneAuthorityClasses.map(
      (authorityClass) => authority(authorityClass),
    );
    expect(descriptors).toHaveLength(controlPlaneAuthorityClasses.length);
    for (const expectedClass of controlPlaneAuthorityClasses) {
      for (const descriptor of descriptors) {
        if (descriptor.authorityClass === expectedClass) {
          expect(assertAuthorityClass(descriptor, expectedClass).authorityClass).toBe(
            expectedClass,
          );
          continue;
        }
        expect(() => assertAuthorityClass(descriptor, expectedClass)).toThrow(
          InvalidTrackerControlPlanePolicyError,
        );
      }
    }
  });

  it("fails closed when expected authority is missing or ambiguous", () => {
    const trackerSync = authority("tracker-sync");
    const codingAgent = authority("coding-agent");

    expect(() =>
      selectAuthorityForClass([codingAgent], "tracker-sync")
    ).toThrow(/exactly one tracker-sync authority/i);
    expect(() =>
      selectAuthorityForClass([trackerSync, trackerSync], "tracker-sync")
    ).toThrow(/exactly one tracker-sync authority/i);
  });

  it("rejects token kinds that do not match the authority class", () => {
    expect(() =>
      validateAuthorityDescriptor({
        ...authority("release"),
        token: {
          kind: "deployment-token",
          tokenIdentity: "opaque-token-id",
        },
      })
    ).toThrow(/does not match authorityClass release/i);
  });

  it("rejects bearer token values in policy records", () => {
    expect(() =>
      validateAuthorityDescriptor({
        ...authority("deployment"),
        token: {
          kind: "deployment-token",
          tokenIdentity: "deployment-token-id",
          value: "secret-bearer-token",
        },
      } as unknown as ControlPlaneAuthorityDescriptor)
    ).toThrow(/token\.value is not permitted/i);
  });

  it("rejects unsupported policy versions", () => {
    expect(() =>
      validateAuthorityDescriptor({
        ...authority("repository-admin"),
        policyVersion: "tracker-control-plane/v2" as typeof trackerControlPlanePolicyVersion,
      })
    ).toThrow(/policyVersion must be tracker-control-plane\/v1/i);
  });
});
