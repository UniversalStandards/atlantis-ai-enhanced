import { describe, expect, it } from "vitest";
import type {
  Authenticator,
  AuthenticationResult,
  AuthorizationRequest,
  PrincipalContext,
} from "../src/index.js";
import {
  InvalidIdentityContractError,
  validateAuthenticationResult,
  validatePrincipalContext,
} from "../src/index.js";

describe("identity contracts", () => {
  it("represents a provider-neutral authenticated principal", () => {
    const principal: PrincipalContext = {
      principalId: "agent-1",
      principalType: "agent",
      tenantId: "tenant-1",
      authMethod: "oauth",
      roles: ["operator"],
      scopes: ["tools:read"],
      attributes: { provider: "neutral" },
      credentialId: "credential-1",
    };

    expect(principal.principalType).toBe("agent");
    expect(principal.authMethod).toBe("oauth");
  });

  it("keeps authentication and authorization as separate contracts", () => {
    const authentication: AuthenticationResult = {
      authenticated: false,
      reason: "missing_credential",
    };
    const authorization: AuthorizationRequest = {
      capabilityId: "mcp.tools.list",
      requiredScopes: ["tools:read"],
    };

    expect(authentication.authenticated).toBe(false);
    expect(authorization.capabilityId).toBe("mcp.tools.list");
  });

  it("requires a principal on authentication success", () => {
    const principal: PrincipalContext = {
      principalId: "user-1",
      principalType: "user",
      authMethod: "oauth",
      roles: [],
      scopes: [],
      attributes: {},
    };
    const authentication: AuthenticationResult = {
      authenticated: true,
      principal,
    };

    expect(authentication.principal.principalId).toBe("user-1");
  });

  it("rejects contradictory authentication payloads at compile time", () => {
    // @ts-expect-error A successful result cannot omit its principal.
    const missingPrincipal: AuthenticationResult = { authenticated: true };
    const invalidPrincipal: PrincipalContext = {
      principalId: "user-1",
      principalType: "user",
      authMethod: "oauth",
      roles: [],
      scopes: [],
      attributes: {},
    };
    // @ts-expect-error A failed result cannot carry a principal.
    const principalOnFailure: AuthenticationResult = {
      authenticated: false,
      principal: invalidPrincipal,
      reason: "invalid_credential",
    };

    expect(missingPrincipal).toBeDefined();
    expect(principalOnFailure).toBeDefined();
  });

  it("rejects anonymous identities as successful authentication at compile time", () => {
    const anonymous: PrincipalContext = {
      principalId: "anonymous",
      principalType: "anonymous",
      authMethod: "none",
      roles: [],
      scopes: [],
      attributes: {},
    };
    const successfulAnonymous: AuthenticationResult = {
      authenticated: true,
      // @ts-expect-error Successful authentication cannot contain an anonymous principal.
      principal: anonymous,
    };

    expect(successfulAnonymous).toBeDefined();
  });
});

describe("identity contracts: authentication method binding", () => {
  it("allows only anonymous principals to be unauthenticated", () => {
    const anonymous: PrincipalContext = {
      principalId: "anonymous",
      principalType: "anonymous",
      authMethod: "none",
      roles: [],
      scopes: [],
      attributes: {},
    };

    expect(anonymous.authMethod).toBe("none");
  });

  it("rejects credential-less non-anonymous principals at compile time", () => {
    // @ts-expect-error A user principal cannot use authMethod "none".
    const unauthenticatedUser: PrincipalContext = {
      principalId: "user-1",
      principalType: "user",
      authMethod: "none",
      roles: [],
      scopes: [],
      attributes: {},
    };
    // @ts-expect-error An agent principal cannot use authMethod "none".
    const unauthenticatedAgent: PrincipalContext = {
      principalId: "agent-1",
      principalType: "agent",
      authMethod: "none",
      roles: [],
      scopes: [],
      attributes: {},
    };
    // @ts-expect-error An anonymous principal cannot claim a credential method.
    const anonymousWithOauth: PrincipalContext = {
      principalId: "anonymous",
      principalType: "anonymous",
      authMethod: "oauth",
      roles: [],
      scopes: [],
      attributes: {},
    };

    expect(unauthenticatedUser).toBeDefined();
    expect(unauthenticatedAgent).toBeDefined();
    expect(anonymousWithOauth).toBeDefined();
  });

  it("requires delegation evidence, bounded scopes, and an expiration together", () => {
    const principal: PrincipalContext = {
      principalId: "agent-1",
      principalType: "agent",
      authMethod: "oauth",
      roles: [],
      scopes: [],
      attributes: {},
      delegatedBy: "user-1",
      delegationId: "delegation-1",
      delegatedScopes: ["tools:read"],
      delegationExpiresAt: "2099-01-01T00:00:00.000Z",
    };
    // @ts-expect-error Delegation fields must be complete and include a bounded scope and expiry.
    const partialDelegation: PrincipalContext = {
      principalId: "agent-1",
      principalType: "agent",
      authMethod: "oauth",
      roles: [],
      scopes: [],
      attributes: {},
      delegatedBy: "user-1",
    };

    expect(principal.delegatedScopes).toEqual(["tools:read"]);
    expect(partialDelegation).toBeDefined();
  });
});

describe("identity contract runtime validation", () => {
  const validPrincipal = {
    principalId: "user-1",
    principalType: "user",
    authMethod: "oauth",
    roles: ["operator"],
    scopes: ["tools:read"],
    attributes: { region: "global" },
  };

  it("validates and snapshots an authenticated result from unknown input", () => {
    const input: unknown = { authenticated: true, principal: validPrincipal };
    const result = validateAuthenticationResult(input);

    expect(result.authenticated).toBe(true);
    if (result.authenticated) {
      expect(result.principal.principalId).toBe("user-1");
      expect(Object.isFrozen(result.principal)).toBe(true);
      expect(Object.isFrozen(result.principal.roles)).toBe(true);
    }
  });

  it.each([
    undefined,
    null,
    {},
    { authenticated: true },
    { authenticated: true, principal: { ...validPrincipal, principalType: "anonymous", authMethod: "none" } },
    { authenticated: true, principal: { ...validPrincipal, authMethod: "none" } },
    { authenticated: false },
    { authenticated: false, reason: "unknown" },
    { authenticated: false, reason: "invalid_credential", principal: validPrincipal },
    { authenticated: true, principal: validPrincipal, provider: "provider-object" },
  ])("rejects malformed authentication input %#", (input) => {
    expect(() => validateAuthenticationResult(input)).toThrow(InvalidIdentityContractError);
  });

  it("rejects malformed principal fields and unsafe property shapes", () => {
    expect(() => validatePrincipalContext({
      ...validPrincipal,
      roles: [" "],
    })).toThrow(InvalidIdentityContractError);
    expect(() => validatePrincipalContext({
      ...validPrincipal,
      providerObject: {},
    })).toThrow(InvalidIdentityContractError);

    const accessorPrincipal = Object.defineProperty({ ...validPrincipal }, "principalId", {
      enumerable: true,
      get: () => {
        throw new Error("must not invoke provider getters");
      },
    });
    expect(() => validatePrincipalContext(accessorPrincipal)).toThrow(InvalidIdentityContractError);
  });

  it("rejects partial, unbounded, or expired delegation evidence", () => {
    const base = { ...validPrincipal };
    expect(() => validatePrincipalContext({ ...base, delegatedBy: "user-1" }))
      .toThrow(InvalidIdentityContractError);
    expect(() => validatePrincipalContext({
      ...base,
      delegatedBy: "user-1",
      delegationId: "delegation-1",
      delegatedScopes: [],
      delegationExpiresAt: "2099-01-01T00:00:00.000Z",
    })).toThrow(InvalidIdentityContractError);
    expect(() => validatePrincipalContext({
      ...base,
      delegatedBy: "user-1",
      delegationId: "delegation-1",
      delegatedScopes: ["tools:read"],
      delegationExpiresAt: "2000-01-01T00:00:00.000Z",
    })).toThrow(InvalidIdentityContractError);
    expect(() => validatePrincipalContext({
      ...base,
      delegatedBy: "user-1",
      delegationId: "delegation-1",
      delegatedScopes: ["tools:write"],
      delegationExpiresAt: "2099-01-01T00:00:00.000Z",
    })).toThrow(InvalidIdentityContractError);
  });

  it("accepts a complete, non-escalating, unexpired delegation", () => {
    const principal = validatePrincipalContext({
      ...validPrincipal,
      delegatedBy: "user-1",
      delegationId: "delegation-1",
      delegatedScopes: ["tools:read"],
      delegationExpiresAt: "2099-01-01T00:00:00.000Z",
    });

    expect(principal.delegatedBy).toBe("user-1");
    expect(principal.delegatedScopes).toEqual(["tools:read"]);
  });

  it("rejects malformed unknown results returned by an Authenticator", async () => {
    const authenticator: Authenticator = {
      authenticate: async () => ({ authenticated: true }),
    };
    const result: unknown = await authenticator.authenticate({});

    expect(() => validateAuthenticationResult(result)).toThrow(InvalidIdentityContractError);
  });
});
