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

export type PrincipalContext = (AnonymousIdentity | AuthenticatedIdentity) & PrincipalContextFields;

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
  readonly delegatedBy?: string;
  readonly delegationId?: string;
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
      readonly principal: PrincipalContext;
      readonly reason?: never;
    }
  | {
      readonly authenticated: false;
      readonly principal?: never;
      readonly reason: AuthenticationFailureReason;
    };

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
  authenticate(request: CredentialRequest): Promise<AuthenticationResult>;
}

export interface Authorizer {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}
