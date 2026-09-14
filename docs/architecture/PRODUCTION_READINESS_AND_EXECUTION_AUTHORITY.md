# Production Readiness and Execution Authority

## 0. Purpose

This policy is the standing ATLANTIS engineering authority model for the current program and future implementation work unless a narrower security, legal, account-owner, or irreversible-action boundary explicitly overrides it.

## 1. Production-ready is the default quality bar

**Every ATLANTIS artifact is expected to be production-ready by default.**

Production-ready means the implementation is engineered to the quality expected for eventual production use, including as applicable:

1. complete implementation rather than placeholders or knowingly temporary logic;
2. explicit contracts, validation, fail-closed behavior, and deterministic error semantics;
3. security, least privilege, secret safety, dependency integrity, and supply-chain checks;
4. durable state, recovery, concurrency, idempotency/uncertainty handling, and evidence integrity where relevant;
5. tests at the appropriate unit, integration, conformance, adversarial, failure-injection, and end-to-end levels;
6. observability, bounded resource behavior, operational diagnostics, and audit evidence;
7. reproducible build/install/deployment configuration and rollback/disable procedures;
8. documentation sufficient for operation, maintenance, incident response, and future evolution;
9. compatibility and migration considerations where state or public contracts are involved;
10. no intentional reduction in engineering quality merely because execution occurs in development, CI, test, staging, sandbox, preview, or another non-production environment.

A non-production environment is an execution boundary, **not a lower quality tier**.

## 2. Production is a deployment/authority state

`production` means an artifact is enabled against live production users, live authoritative data, live credentials, live infrastructure, or another environment whose mutation has real operational consequences.

Production deployment/enablement is separate from production readiness.

Therefore:

- code may and should be production-ready before it is deployed to production;
- non-production conformance implementations must still be production-ready implementations;
- a production-ready implementation does not by itself authorize production deployment;
- production deployment evidence must not be inferred from CI, mocks, local fixtures, or non-production execution.

## 3. Standing engineering authority

The program owner has established standing intent for ATLANTIS engineering work. Agents and automated build/verification cycles **do not require repeated human approval** to perform safe, reversible engineering actions that advance that intent.

Standing authority includes, when otherwise permitted by available credentials and repository/platform policy:

1. architecture and design decisions that follow established ATLANTIS principles;
2. implementation and refactoring;
3. creation and modification of source, tests, schemas, migrations, configuration, CI, documentation, runbooks, and evidence tooling;
4. adding or updating dependencies when they pass repository security and reproducibility gates;
5. installing and exercising local/CI test dependencies, databases, browsers, collectors, containers, fixtures, and other isolated non-production infrastructure;
6. selecting the evidence-backed engineering candidate when the choice is reversible and consistent with established intent;
7. executing non-production conformance, adversarial, failure-injection, recovery, browser, telemetry, persistence, deployment-rehearsal, and burn-in tests;
8. opening/updating branches, issues, pull requests, review evidence, and release-readiness records;
9. correcting defects and documentation drift without waiting for another approval cycle.

Existing documents that say `approval required`, `UNSELECTED / BLOCKED FOR IMPLEMENTATION`, or equivalent must be interpreted and updated consistently with this standing authority when the only missing approval is an internal engineering/operator choice already covered above.

## 4. Human intervention boundary

Stop and request human intervention only when the action genuinely requires it, including at least one of these conditions:

1. a secret, credential, MFA action, account-owner action, identity proof, or consent that the agent cannot legitimately supply;
2. a legal, contractual, purchasing, billing, financial, regulatory, or organizational commitment requiring a natural-person or authorized-account-holder decision;
3. an irreversible or materially destructive external action for which no established intent or safe rollback exists;
4. public or production enablement with material real-world consequences when that enablement has not already been explicitly authorized by standing policy;
5. expansion of security-sensitive privileges, protected-branch bypass, external network trust, or production-data authority beyond established policy;
6. a product/policy choice with materially different user-facing outcomes where established program intent does not resolve the choice;
7. an external system explicitly requires human approval or review and bypassing it would defeat the system's governance purpose.

Human intervention is not required merely because an implementation is sophisticated, provider-specific, production-ready, or tested against a non-production real service.

## 5. Selection rule

When multiple reversible engineering candidates exist and established ATLANTIS intent plus evidence identifies a preferred option, the engineering process should select the preferred candidate and proceed rather than manufacture an approval blocker.

The selection record must preserve:

- rationale and alternatives;
- exact versions/topology/configuration class;
- security and authority boundary;
- rollback/disable path;
- evidence required for acceptance;
- distinction between engineering selection and production deployment authority.

## 6. Evidence rule

Documentation, recommendation, mocks, and green unit tests are not operational proof. Production-ready work still requires the strongest evidence reasonably available for the layer being claimed.

Claims must remain scoped precisely:

- `production-ready` describes engineering quality and readiness characteristics;
- `production-tested` requires appropriate production-like or real-provider evidence;
- `production-deployed` requires actual production deployment evidence;
- `production-authorized` requires the applicable authority for production enablement.

These terms must not be conflated.
