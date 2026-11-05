# Future Project Integration Prompt

Use this brief when adding a future client website to Control Portal. Treat the portal as an independent control plane; do not rebuild the client's dashboard or move its operational database.

## Project facts to supply

- Project name and public website URL
- Original Admin Dashboard URL
- Hosting/runtime and database type
- Authentication and role model
- Whether the dashboard explicitly permits the configured portal origin in CSP
- Supported event delivery, refresh, and version/ETag behavior
- A synthetic test account and isolated test records, if browser verification is requested

## Required implementation rules

1. Keep the existing frontend, backend, authentication, business logic, and database authoritative.
2. Do not send database credentials, passwords, permanent login tokens, cookies, customer data, or unrestricted admin credentials to Control Portal.
3. Add the signed audit event contract from `docs/PORTAL_INTEGRATION.md` only to the original server. Derive actors from verified authentication and authorization context.
4. Implement project-scoped authorization for every API action. Use stable event IDs and idempotent retries.
5. Protect concurrent writes with a server-side record version or ETag. Reject stale versions with `409` or `412`; never silently overwrite a newer value.
6. Add live sync only through a real, documented original-backend capability. Choose signed webhooks, SSE, managed WebSockets, or polling according to hosting support. Include reconnect and refresh behavior.
7. Allow iframe embedding only when CSP explicitly permits the portal, authentication works under browser cookie restrictions, and the original site's CSRF protections remain enabled. Never bypass X-Frame-Options or CSP.
8. Test the connection, sign-in, navigation, forms, an authorized write, event delivery, duplicate retries, permission boundaries, stale-write conflicts, and reconnect behavior using synthetic data.
9. Report each capability as implemented, verified, pending, or unsupported. A 200 response or visible iframe alone is not proof of authenticated integration or synchronization.

## Completion evidence

Provide the exact test commands and results, the external application's changed files, its environment variable names (never values), verified response policies, and remaining steps. Mark a capability active in Control Portal only after the relevant evidence has been observed in the connected application.
