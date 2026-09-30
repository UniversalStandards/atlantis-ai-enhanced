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

export interface PrincipalContext {
  readonly principalId: string;
  readonly principalType: PrincipalType;
  readonly tenantId?: string;
  readonly authMethod: AuthMethod;
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

export interface AuthenticationResult {
  readonly authenticated: boolean;
  readonly principal?: PrincipalContext;
  readonly reason?:
    | "missing_credential"
    | "invalid_credential"
    | "malformed_principal"
    | "expired_credential";
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
  authenticate(request: CredentialRequest): Promise<AuthenticationResult>;
}

export interface Authorizer {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}
