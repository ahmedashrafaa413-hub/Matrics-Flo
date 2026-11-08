# Private MetricsFlo MCP foundation

This branch adds a **read-only prototype** at `POST /api/mcp` (JSON-RPC over HTTP). It is **not yet a production-ready ChatGPT or Claude connector**.

## Access controls
- Disabled by default. Set `METRICSFLO_AI_OWNER_USER_ID` to the exact Supabase Auth UUID of the intended owner, server-side only.
- Every request requires a valid Supabase access token in `Authorization: Bearer <token>`; the authenticated user UUID must match the owner UUID.
- `tools/call` also requires an authorized `workspace_id` and rechecks membership.
- Read-only: currently one tool, `get_performance_overview`, supporting `date_preset` values `today`, `yesterday`, `last_7d`, `last_30d`, `maximum`.
- Do not publish personal Supabase access tokens or service role credentials in any third-party client.

## Before connecting ChatGPT or Claude
1. Implement proper OAuth 2.1 authorization-server metadata, dynamic client registration (if required by client), PKCE authorization flow, scoped short-lived tokens, revocation, and MCP resource-server token validation. Supabase login JWTs are **not** a substitute for third-party OAuth consent.
2. Confirm protocol-version and transport requirements for the actual client; this prototype implements only a limited subset of MCP JSON-RPC and not full Streamable HTTP session/transport handling.
3. Harden request origin/host verification and internal analytics access. Ensure the requested workspace is honored end-to-end and avoid untrusted Host-derived internal URLs.
4. Add audit logs, rate limits, response-size caps, safe pagination, and explicit source freshness and data-quality annotations.
5. Run tests for unauthorized access, wrong owner, wrong workspace, expired token, malformed JSON-RPC, and successful authorized reads. Compare outputs to MetricsFlo dashboard.
6. Deploy to preview first, then configure owner UUID securely in Vercel after review. Do not enable on production before tests.

## Current status
Code committed to an isolated feature branch for review. No OAuth registration, live login test, deployment, or end-to-end validation has been performed.
