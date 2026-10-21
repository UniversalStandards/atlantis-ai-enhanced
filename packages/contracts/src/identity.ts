export type PrincipalType =
  | "anonymous"
  | "user"
  | "service_account"
  | "agent"
  | "application"
  | "workload";

export type AuthMethod =
  | "none"
  | "oauth"
  | "api_key"
  | "workload_identity";

/**
 * Only an anonymous principal may be unauthenticated. Every other principal
 * type must carry a real authentication method, and an anonymous principal
 * may never claim one. Enforced at compile time so a credential-less "user",
 * "agent", or "workload" cannot be constructed through the shared contract.
 */
export type AnonymousIdentity = {
  readonly principalType: "anonymous";
  readonly authMethod: "none";
};

export type AuthenticatedIdentity = {
  readonly principalType: Exclude<PrincipalType, "anonymous">;
  readonly authMethod: Exclude<AuthMethod, "none">;
};

export type NonDelegatedContext = {
  readonly delegatedBy?: never;
  readonly delegationId?: never;
  readonly delegatedScopes?: never;
  readonly delegationExpiresAt?: never;
};

export type DelegationContext =
  | NonDelegatedContext
  | {
      readonly delegatedBy: string;
      readonly delegationId: string;
      readonly delegatedScopes: readonly string[];
      readonly delegationExpiresAt: string;
    };

export interface PrincipalContextFields {
  readonly principalId: string;
  readonly tenantId?: string;
  readonly roles: readonly string[];
  readonly scopes: readonly string[];
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly credentialId?: string;
  readonly sessionId?: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string;
}

export type AuthenticatedPrincipalContext = AuthenticatedIdentity &
  PrincipalContextFields &
  DelegationContext;

export type PrincipalContext =
  | (AnonymousIdentity & PrincipalContextFields & NonDelegatedContext)
  | AuthenticatedPrincipalContext;

export class InvalidIdentityContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidIdentityContractError";
  }
}

const principalContextKeys = [
  "principalId",
  "principalType",
  "authMethod",
  "tenantId",
  "roles",
  "scopes",
  "attributes",
  "credentialId",
  "sessionId",
  "issuedAt",
  "expiresAt",
  "delegatedBy",
  "delegationId",
  "delegatedScopes",
  "delegationExpiresAt",
] as const;

function fail(message: string): never {
  throw new InvalidIdentityContractError(message);
}

function readDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${field} must be a plain object`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(`${field} must be a plain object`);
  }

  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.includes(key)) {
      return fail(`${field} contains an unsupported property`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return fail(`${field}.${key} must be an enumerable data property`);
    }
    record[key] = descriptor.value;
  }
  return record;
}

function requireNonBlank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fail(`${field} must be a non-blank string`);
  }
  return value;
}

function requireTimestamp(value: unknown, field: string): string {
  const timestamp = requireNonBlank(value, field);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    return fail(`${field} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function requireStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) {
    return fail(`${field} must be an array`);
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)))
  ) {
    return fail(`${field} must contain only indexed values`);
  }

  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return fail(`${field}[${index}] must be an enumerable data property`);
    }
    result.push(requireNonBlank(descriptor.value, `${field}[${index}]`));
  }
  return Object.freeze(result);
}

function requireAttributes(value: unknown): Readonly<Record<string, string | number | boolean>> {
  const attributes = readDataRecord(
    value,
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Reflect.ownKeys(value).filter((key): key is string => typeof key === "string")
      : [],
    "attributes",
  );
  for (const key of Object.keys(attributes)) {
    if (key.trim().length === 0) {
      return fail("attributes keys must be non-blank strings");
    }
    const attribute = attributes[key];
    if (
      typeof attribute !== "string" &&
      typeof attribute !== "boolean" &&
      (typeof attribute !== "number" || !Number.isFinite(attribute) || Object.is(attribute, -0))
    ) {
      return fail(`attributes.${key} must be a string, finite number, or boolean`);
    }
  }
  return Object.freeze(attributes) as Readonly<Record<string, string | number | boolean>>;
}

function validatePrincipalContextUnsafe(value: unknown): PrincipalContext {
  const principal = readDataRecord(value, principalContextKeys, "principal");
  const principalId = requireNonBlank(principal.principalId, "principalId");
  const roles = requireStringArray(principal.roles, "roles");
  const scopes = requireStringArray(principal.scopes, "scopes");
  const attributes = requireAttributes(principal.attributes);
  const principalType = principal.principalType;
  const authMethod = principal.authMethod;

  if (
    principalType !== "anonymous" &&
    principalType !== "user" &&
    principalType !== "service_account" &&
    principalType !== "agent" &&
    principalType !== "application" &&
    principalType !== "workload"
  ) {
    return fail("principalType must be a supported value");
  }
  if (
    authMethod !== "none" &&
    authMethod !== "oauth" &&
    authMethod !== "api_key" &&
    authMethod !== "workload_identity"
  ) {
    return fail("authMethod must be a supported value");
  }
  if ((principalType === "anonymous") !== (authMethod === "none")) {
    return fail("anonymous principals must use authMethod none, and authenticated principals must not");
  }

  const issuedAt = principal.issuedAt === undefined
    ? undefined
    : requireTimestamp(principal.issuedAt, "issuedAt");
  const expiresAt = principal.expiresAt === undefined
    ? undefined
    : requireTimestamp(principal.expiresAt, "expiresAt");
  if (issuedAt !== undefined && expiresAt !== undefined && expiresAt <= issuedAt) {
    return fail("expiresAt must be later than issuedAt");
  }
  if (expiresAt !== undefined && expiresAt <= new Date().toISOString()) {
    return fail("expiresAt must be in the future");
  }

  const hasDelegation = [
    "delegatedBy",
    "delegationId",
    "delegatedScopes",
    "delegationExpiresAt",
  ].some((key) => Object.hasOwn(principal, key));
  if (principalType === "anonymous" && hasDelegation) {
    return fail("anonymous principals cannot carry delegation");
  }
  let delegatedBy: string | undefined;
  let delegationId: string | undefined;
  let delegatedScopes: readonly string[] | undefined;
  let delegationExpiresAt: string | undefined;
  if (hasDelegation) {
    delegatedBy = requireNonBlank(principal.delegatedBy, "delegatedBy");
    delegationId = requireNonBlank(principal.delegationId, "delegationId");
    delegatedScopes = requireStringArray(principal.delegatedScopes, "delegatedScopes");
    if (delegatedScopes.length === 0) {
      return fail("delegatedScopes must not be empty");
    }
    if (delegatedScopes.some((scope) => !scopes.includes(scope))) {
      return fail("delegatedScopes must be a subset of the principal scopes");
    }
    delegationExpiresAt = requireTimestamp(principal.delegationExpiresAt, "delegationExpiresAt");
    if (issuedAt !== undefined && delegationExpiresAt <= issuedAt) {
      return fail("delegationExpiresAt must be later than issuedAt");
    }
    if (expiresAt !== undefined && delegationExpiresAt > expiresAt) {
      return fail("delegationExpiresAt must not exceed expiresAt");
    }
    if (delegationExpiresAt <= new Date().toISOString()) {
      return fail("delegationExpiresAt must be in the future");
    }
  }

  return Object.freeze({
    principalId,
    principalType,
    authMethod,
    roles,
    scopes,
    attributes,
    ...(principal.tenantId === undefined ? {} : { tenantId: requireNonBlank(principal.tenantId, "tenantId") }),
    ...(principal.credentialId === undefined
      ? {}
      : { credentialId: requireNonBlank(principal.credentialId, "credentialId") }),
    ...(principal.sessionId === undefined ? {} : { sessionId: requireNonBlank(principal.sessionId, "sessionId") }),
    ...(issuedAt === undefined ? {} : { issuedAt }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(delegatedBy === undefined
      ? {}
      : {
          delegatedBy,
          delegationId: delegationId as string,
          delegatedScopes: delegatedScopes as readonly string[],
          delegationExpiresAt: delegationExpiresAt as string,
        }),
  }) as PrincipalContext;
}

export function validatePrincipalContext(value: unknown): PrincipalContext {
  try {
    return validatePrincipalContextUnsafe(value);
  } catch (error) {
    if (error instanceof InvalidIdentityContractError) {
      throw error;
    }
    throw new InvalidIdentityContractError("principal is malformed");
  }
}

export interface CredentialRequest {
  readonly authorization?: string;
  readonly apiKey?: string;
  readonly requestId?: string;
}

export type AuthenticationFailureReason =
  | "missing_credential"
  | "invalid_credential"
  | "malformed_principal"
  | "expired_credential";

export type AuthenticationResult =
  | {
      readonly authenticated: true;
      readonly principal: AuthenticatedPrincipalContext;
      readonly reason?: never;
    }
  | {
      readonly authenticated: false;
      readonly principal?: never;
      readonly reason: AuthenticationFailureReason;
    };

export function validateAuthenticationResult(value: unknown): AuthenticationResult {
  try {
    const result = readDataRecord(
      value,
      ["authenticated", "principal", "reason"],
      "authentication result",
    );
    if (result.authenticated === true) {
      if (Object.hasOwn(result, "reason")) {
        return fail("successful authentication cannot include a failure reason");
      }
      const principal = validatePrincipalContextUnsafe(result.principal);
      if (principal.principalType === "anonymous") {
        return fail("successful authentication requires an authenticated principal");
      }
      return Object.freeze({
        authenticated: true,
        principal: principal as AuthenticatedPrincipalContext,
      }) as AuthenticationResult;
    }
    if (result.authenticated === false) {
      if (Object.hasOwn(result, "principal")) {
        return fail("failed authentication cannot include a principal");
      }
      const reason = result.reason;
      if (
        reason !== "missing_credential" &&
        reason !== "invalid_credential" &&
        reason !== "malformed_principal" &&
        reason !== "expired_credential"
      ) {
        return fail("failed authentication requires a supported failure reason");
      }
      return Object.freeze({ authenticated: false, reason }) as AuthenticationResult;
    }
    return fail("authenticated must be a boolean");
  } catch (error) {
    if (error instanceof InvalidIdentityContractError) {
      throw error;
    }
    throw new InvalidIdentityContractError("authentication result is malformed");
  }
}

export type AuthorizationDecision =
  | {
      readonly outcome: "allow";
      readonly controlId: string;
      readonly reasons: readonly string[];
    }
  | {
      readonly outcome: "deny";
      readonly controlId: string;
      readonly reasons: readonly string[];
    };

export interface AuthorizationRequest {
  readonly principal?: PrincipalContext;
  readonly tenantId?: string;
  readonly capabilityId: string;
  readonly requiredScopes: readonly string[];
  readonly resourceId?: string;
}

export interface Authenticator {
  authenticate(request: CredentialRequest): Promise<unknown>;
}

export interface Authorizer {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}
