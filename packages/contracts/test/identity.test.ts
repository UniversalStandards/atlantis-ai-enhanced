import { describe, expect, it } from "vitest";
import type {
  AuthenticationResult,
  AuthorizationRequest,
  PrincipalContext,
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
});
