# Control Portal Integration Contract

This contract describes optional work that each original website must implement. A project can be registered without any client-side changes. Each website retains its own database, authentication, permissions, business logic, and deployment.

## Current portal behavior

- Admin URLs must be public HTTPS on port 443. URL credentials, query strings, and fragments are rejected.
- Metadata and health checks pin a resolved public IP and refuse private/reserved addresses and unsafe redirects.
- A health response measures the URL's HTTP reachability only. It does not authenticate an administrator or prove that the dashboard works.
- Embedding requires an explicit `Content-Security-Policy: frame-ancestors` allow rule for the portal, no conflicting `X-Frame-Options`, and a human owner attestation after checking sign-in, navigation, forms, and an authorized write.
- Signed audit events are accepted at `POST /api/projects/{project-slug}/audit-events`. The portal encrypts the webhook secret at rest, enforces a five-minute signature window, validates a bounded schema, removes sensitive field names, and deduplicates by project and event ID.
- Live operational-data synchronization and client-side conflict protection are not implemented by this portal. They remain pending until the original backend implements them.

## Signed audit event setup

1. In Integration Manager, create a webhook secret. It is shown once; copy it directly to the original application's secret manager as `CONTROL_PORTAL_WEBHOOK_SECRET`.
2. Configure `CONTROL_PORTAL_EVENT_URL` to the endpoint shown in the portal.
3. Emit events only from the original server after its normal authentication and authorization checks succeed. Never accept an actor ID supplied only by a browser.
4. Send a JSON body matching the event shape below. Use a stable unique `id` for each logical event. Retry the same body and ID if delivery fails.
5. Set `x-control-portal-timestamp` to Unix seconds or milliseconds and `x-control-portal-signature` to `sha256=<hex>`.
6. Compute the signature as HMAC-SHA256 with the shared secret over the UTF-8 bytes of `<timestamp>.<exact raw JSON body>`. Do not parse and reserialize the body before signing.
7. The endpoint returns `202` when accepted and also when an already-accepted ID is retried. `400` means the event schema is invalid; `401` means the signature or timestamp is invalid; `413` means the body is too large.

Example event:

```json
{
  "id": "evt_01J8N6W44F0Q8Q6X1Q4J9T4P2A",
  "occurredAt": "2026-08-25T12:30:00.000Z",
  "action": "updated",
  "entityType": "product",
  "entityId": "product_123",
  "severity": "INFO",
  "actor": {
    "id": "staff_42",
    "label": "Warehouse manager"
  },
  "changes": [
    { "field": "price", "before": 500, "after": 600 },
    { "field": "stock", "before": 14, "after": 12 }
  ]
}
```

Do not send passwords, tokens, cookies, payment details, customer records, email addresses, phone numbers, or street addresses in event metadata or before/after changes. Prefer stable pseudonymous actor and record IDs. Keep event changes small and focused on fields necessary for an administrative audit.

The portal records the event as reported by the signed client service. The signature proves the sender knew the integration secret; the portal does not independently authenticate the client's named administrator. The client must derive the actor from its verified server-side session.

The project's audit feed becomes active only after a valid event is accepted. The page polls the portal for newly received events every 15 seconds; it does not read the client's database.

## Secure dashboard embedding

To allow embedding, the original Admin Dashboard response must explicitly permit the configured `PORTAL_ORIGIN`, for example:

```http
Content-Security-Policy: frame-ancestors 'self' https://portal.example.com
```

Do not remove `X-Frame-Options` or weaken other CSP directives for unrelated callers. Keep CSRF protection enabled. Session cookies must be `Secure` and use a deliberate SameSite policy. Third-party-cookie blocking can prevent login inside a cross-site frame even when CSP permits it.

After a policy check reports that framing is allowed, an authorized project manager may attest that the normal login, navigation, forms, and an authorized write work in the embedded browser. The portal records that owner attestation and the check time. Recheck when headers, domains, login behavior, cookie settings, or admin workflows change. If verification fails or the frame policy changes, use the clearly labeled original-dashboard link and keep the portal integration in configuration-required status.

Do not expose credentials in URLs, send passwords through the portal, inject scripts into the client site, or proxy an admin session through the portal.

## Live data synchronization

The audit-event endpoint reports changes to the portal; it does not copy or update products, orders, customers, or other operational records. For actual two-way synchronization, the original application must provide a project-specific authorized API or event stream with:

- Authentication tied to a named portal user or a short-lived, project-scoped grant.
- Server-side role and record authorization on every operation.
- Stable record IDs, event IDs, ordering rules, retry handling, and idempotency.
- A supported delivery mechanism such as signed webhooks, SSE, a managed WebSocket provider, or bounded polling.
- An explicit refresh or resubscription path for disconnected clients.
- No shared unrestricted admin token across projects.

The portal must not infer synchronization from an iframe or from successful health checks. The original app remains the source of truth.

## Conflict prevention contract

Before allowing an update, the original backend should return a version number or ETag for the record. A write must include the version it read. The server should compare that version atomically with the latest version and reject stale writes with `409 Conflict` or `412 Precondition Failed`, returning the current version and a safe conflict description. It must never silently accept a stale overwrite. Clients should refresh, show the changed fields, and require an explicit resolution before retrying.

Audit before/after values should be captured by that same authorized server transaction. The actor, project, stable event ID, and resulting version belong in the event. The portal currently documents this contract but does not issue operational writes to client systems.

## Deployment and secret rotation

- Store `CONTROL_PORTAL_WEBHOOK_SECRET` in the client's server-side secret manager.
- Rotate the portal secret if it is exposed. Rotation immediately invalidates the old secret, so update the client application at the same time.
- Set the portal's `INTEGRATION_KEY_ENCRYPTION_KEY` before creating secrets. Losing this key means existing webhook secrets cannot be decrypted and must be rotated.
- Use HTTPS end to end. Do not log signatures, secrets, full request bodies, or personal data.
- Test first with synthetic records in an isolated client environment.
