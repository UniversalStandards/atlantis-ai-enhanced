# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: **Security → Report a
vulnerability** on this repository. Do not open a public issue for a suspected
vulnerability.

Include the affected package and version or commit, a description of the
impact, and steps to reproduce. You will receive an acknowledgement, and a fix
or mitigation plan once the report is confirmed.

## Supported versions

The project is pre-1.0. Only the `main` branch receives security fixes.

## Scope notes for contributors

- Secrets must never appear in source, fixtures, logs, prompts, or event
  payloads (AGENTS.md rule 6). The workflow runner records identifiers,
  counters, and error names/messages only; error messages are truncated but not
  scrubbed, so do not put secrets in thrown error messages.
- Budget, cancellation, and audit controls fail closed. A change that makes any
  of them fail open is a security defect.
- The in-memory event store's hash chain detects modification of stored
  history. It does not by itself prevent a party with process access from
  replacing the whole chain; anchor `headHash` externally where that matters.
