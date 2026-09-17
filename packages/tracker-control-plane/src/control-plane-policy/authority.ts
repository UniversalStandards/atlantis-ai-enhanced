import {
  InvalidTrackerControlPlanePolicyError,
  requireCanonicalTimestamp,
  requireEnumValue,
  requireNonBlank,
  requireObject,
  requirePolicyVersion,
  requireStringArray,
  trackerControlPlanePolicyVersion,
  type TrackerControlPlanePolicyVersion,
} from "./shared.js";

export const controlPlaneAuthorityClasses = Object.freeze([
  "tracker-sync",
  "coding-agent",
  "release",
  "deployment",
  "repository-admin",
] as const);

export type ControlPlaneAuthorityClass = typeof controlPlaneAuthorityClasses[number];

const authorityTokenKinds = Object.freeze({
  "tracker-sync": "tracker-sync-token",
  "coding-agent": "coding-agent-token",
  release: "release-token",
  deployment: "deployment-token",
  "repository-admin": "repository-admin-token",
} as const satisfies Record<ControlPlaneAuthorityClass, string>);

export type ControlPlaneAuthorityTokenKind<TClass extends ControlPlaneAuthorityClass> =
  typeof authorityTokenKinds[TClass];

export interface ControlPlaneAuthorityToken<TClass extends ControlPlaneAuthorityClass> {
  readonly kind: ControlPlaneAuthorityTokenKind<TClass>;
  readonly tokenIdentity: string;
}

export interface ControlPlaneAuthorityProvenance {
  readonly issuedBy: string;
  readonly justification: string;
  readonly evidence: readonly string[];
}

interface ControlPlaneAuthorityDescriptorBase<TClass extends ControlPlaneAuthorityClass> {
  readonly policyVersion: TrackerControlPlanePolicyVersion;
  readonly authorityClass: TClass;
  readonly authorityId: string;
  readonly issuedAt: string;
  readonly token: Readonly<ControlPlaneAuthorityToken<TClass>>;
  readonly provenance: Readonly<ControlPlaneAuthorityProvenance>;
}

export type TrackerSyncAuthorityDescriptor =
  ControlPlaneAuthorityDescriptorBase<"tracker-sync">;
export type CodingAgentAuthorityDescriptor =
  ControlPlaneAuthorityDescriptorBase<"coding-agent">;
export type ReleaseAuthorityDescriptor = ControlPlaneAuthorityDescriptorBase<"release">;
export type DeploymentAuthorityDescriptor =
  ControlPlaneAuthorityDescriptorBase<"deployment">;
export type RepositoryAdminAuthorityDescriptor =
  ControlPlaneAuthorityDescriptorBase<"repository-admin">;

export type ControlPlaneAuthorityDescriptor =
  | TrackerSyncAuthorityDescriptor
  | CodingAgentAuthorityDescriptor
  | ReleaseAuthorityDescriptor
  | DeploymentAuthorityDescriptor
  | RepositoryAdminAuthorityDescriptor;

function validateAuthorityToken<TClass extends ControlPlaneAuthorityClass>(
  authorityClass: TClass,
  value: unknown,
): Readonly<ControlPlaneAuthorityToken<TClass>> {
  const token = requireObject("token", value);
  const expectedKind = authorityTokenKinds[authorityClass];
  const kind = requireNonBlank("token.kind", token.kind);
  if (kind !== expectedKind) {
    throw new InvalidTrackerControlPlanePolicyError(
      `token.kind ${kind} does not match authorityClass ${authorityClass}`,
    );
  }
  if (token.value !== undefined) {
    throw new InvalidTrackerControlPlanePolicyError(
      "token.value is not permitted in control-plane policy records",
    );
  }
  return Object.freeze({
    kind: expectedKind,
    tokenIdentity: requireNonBlank("token.tokenIdentity", token.tokenIdentity),
  });
}

function validateProvenance(value: unknown): Readonly<ControlPlaneAuthorityProvenance> {
  const provenance = requireObject("provenance", value);
  return Object.freeze({
    issuedBy: requireNonBlank("provenance.issuedBy", provenance.issuedBy),
    justification: requireNonBlank(
      "provenance.justification",
      provenance.justification,
    ),
    evidence: requireStringArray("provenance.evidence", provenance.evidence),
  });
}

export function validateAuthorityDescriptor<TClass extends ControlPlaneAuthorityClass>(
  descriptor: ControlPlaneAuthorityDescriptorBase<TClass>,
): Readonly<ControlPlaneAuthorityDescriptorBase<TClass>> {
  const policyVersion = requirePolicyVersion(descriptor.policyVersion);
  const authorityClass = requireEnumValue(
    "authorityClass",
    descriptor.authorityClass,
    controlPlaneAuthorityClasses,
  );

  return Object.freeze({
    policyVersion,
    authorityClass,
    authorityId: requireNonBlank("authorityId", descriptor.authorityId),
    issuedAt: requireCanonicalTimestamp("issuedAt", descriptor.issuedAt),
    token: validateAuthorityToken(authorityClass, descriptor.token),
    provenance: validateProvenance(descriptor.provenance),
  }) as Readonly<ControlPlaneAuthorityDescriptorBase<TClass>>;
}

export function normalizeAuthorityDescriptor(
  descriptor: ControlPlaneAuthorityDescriptor,
): ControlPlaneAuthorityDescriptor {
  return validateAuthorityDescriptor(
    descriptor,
  ) as unknown as ControlPlaneAuthorityDescriptor;
}

export function assertAuthorityClass<TClass extends ControlPlaneAuthorityClass>(
  descriptor: ControlPlaneAuthorityDescriptor,
  expectedClass: TClass,
): Extract<ControlPlaneAuthorityDescriptor, { readonly authorityClass: TClass }> {
  const validated = normalizeAuthorityDescriptor(descriptor);
  if (validated.authorityClass !== expectedClass) {
    throw new InvalidTrackerControlPlanePolicyError(
      `authorityClass ${validated.authorityClass} cannot satisfy ${expectedClass} authority`,
    );
  }
  return validated as Extract<
    ControlPlaneAuthorityDescriptor,
    { readonly authorityClass: TClass }
  >;
}

export function selectAuthorityForClass<TClass extends ControlPlaneAuthorityClass>(
  authorities: readonly ControlPlaneAuthorityDescriptor[],
  expectedClass: TClass,
): Extract<ControlPlaneAuthorityDescriptor, { readonly authorityClass: TClass }> {
  const validated = authorities.map((authority) => normalizeAuthorityDescriptor(authority));
  const matches = validated.filter(
    (authority) => authority.authorityClass === expectedClass,
  );
  if (matches.length !== 1) {
    throw new InvalidTrackerControlPlanePolicyError(
      `expected exactly one ${expectedClass} authority descriptor`,
    );
  }
  return matches[0] as Extract<
    ControlPlaneAuthorityDescriptor,
    { readonly authorityClass: TClass }
  >;
}

export function createAuthorityDescriptor<TClass extends ControlPlaneAuthorityClass>(
  authorityClass: TClass,
  input: Readonly<{
    authorityId: string;
    tokenIdentity: string;
    issuedAt: string;
    issuedBy: string;
    justification: string;
    evidence: readonly string[];
  }>,
): Extract<ControlPlaneAuthorityDescriptor, { readonly authorityClass: TClass }> {
  const descriptor = validateAuthorityDescriptor({
    policyVersion: trackerControlPlanePolicyVersion,
    authorityClass,
    authorityId: input.authorityId,
    issuedAt: input.issuedAt,
    token: {
      kind: authorityTokenKinds[authorityClass] as ControlPlaneAuthorityTokenKind<TClass>,
      tokenIdentity: input.tokenIdentity,
    },
    provenance: {
      issuedBy: input.issuedBy,
      justification: input.justification,
      evidence: input.evidence,
    },
  });
  return descriptor as unknown as Extract<
    ControlPlaneAuthorityDescriptor,
    { readonly authorityClass: TClass }
  >;
}
