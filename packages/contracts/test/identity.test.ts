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
});
