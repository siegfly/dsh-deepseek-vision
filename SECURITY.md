# Security Policy

## Reporting a vulnerability

Do NOT open a public issue. Use GitHub's private reporting:

**Security → Advisories → "Report a vulnerability"** on
https://github.com/siegfly/dsh-deepseek-vision/security

Expect an initial response within a few days. Please include:

- affected version(s)
- a minimal reproduction, or at least the nature of the issue
- impact assessment

## What qualifies

Anything that leaks credentials (the settings card never echoes keys; errors
must only name the credential REF, never the value), writes outside the
plugin's own `llm-vl-gateway` settings namespace, or executes untrusted input.
The plugin's attack surface is small: it runs inside dsh and makes two
outbound HTTP calls (the VL endpoint and the DeepSeek API).

## Supported versions

Only the latest release receives security fixes (`npm dist-tag latest`).
Older 0.1.x releases are unsupported.
