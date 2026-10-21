# Google AI Studio Build Profile — Authority Boundary

## Status

This document governs interpretation of `docs/google-ai-studio-build-prompt.md` within the ATLANTIS release train.

The Google AI Studio build prompt is a **tool-specific civilian/reference build profile**. Its use of Google AI Studio, Gemini API, and IndexedDB is scoped to that profile and does **not** select or authorize any of those technologies as ATLANTIS production architecture.

## Production-authority boundary

The phrase "canonical build spec" inside the Google AI Studio prompt means canonical **for that Google AI Studio reference build surface only**. It does not supersede provider-neutral ATLANTIS architecture, security, persistence, identity, deployment, or release-control decisions recorded elsewhere in the repository and governed through Issue #8 / PR #10.

Specifically, importing or using the profile does not authorize:

- Gemini, Google AI Studio, or any other named model/provider as the production reasoning provider;
- IndexedDB as production durable persistence or as evidence of external durability;
- credentials, external-network access, production authentication, deployment targets, or production mutation authority;
- bypass of approval, audit, tenant-isolation, human-review, security, or release-control gates.

Any production selection of provider, persistence, identity, network, deployment, or security-sensitive authority requires its own explicit governed decision and evidence.

## Relationship to bounded work packets

Issue #33 remains the deterministic/offline/reference-identity browser/application acceptance packet and must not inherit production provider or persistence authority from the Google AI Studio profile. Dependabot PR #36 is likewise independent and is not part of this reconciliation.

## Release-train reconciliation

This authority note accompanies the ancestry reconciliation that incorporates the single out-of-band `main` documentation commit into `sprint/7-day-operational-alpha` through a reviewable, non-force merge lineage. It changes documentation authority only; it introduces no runtime implementation, credential, provider, persistence, network, deployment, or repository-setting mutation.
