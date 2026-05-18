# Security Review Checklist

## Scan Categories

### 1. Secrets Detection (CRITICAL)

- No hardcoded API keys, passwords, tokens, or connection strings in source code
- Secrets loaded from environment variables or secret managers only
- No secrets in git history (check with grep/trufflehog if suspicious)
- `.env` files in `.gitignore`

### 2. Injection Prevention (CRITICAL)

- All SQL queries parameterized (no string concatenation with user input)
- No command injection via `exec`/`spawn` with unsanitized input
- No NoSQL injection in MongoDB/Firestore queries
- ORMs used safely (no raw queries with user input)

### 3. Authentication & Authorization (CRITICAL)

Here's your updated checklist tailored for an Ory stack (Kratos + Hydra + Keto):

---

### 3. Authentication & Authorization (CRITICAL)

**Identity & Credential Management (Ory Kratos)**

- Kratos handles all password hashing — verify no custom auth code bypasses Kratos flows
- Self-service flows (login, registration, recovery, verification) use Kratos native UI or custom UI via flow API only — no custom credential handling
- Kratos session cookie is `httpOnly`, `secure`, `sameSite=Strict/Lax` — verify in Kratos config (`session.cookie.*`)
- Session lifetimes and refresh behavior configured appropriately in Kratos (`session.lifespan`, `session.earliest_possible_extend`)
- Account enumeration protection enabled (Kratos has this built-in, verify it's not accidentally disabled)
- Rate limiting on Kratos public API endpoints (login, registration, recovery) — Kratos doesn't do this itself, must be handled at gateway/ingress level

**OAuth2 & Token Management (Ory Hydra)**

- Access tokens validated on every request — signature, expiry (`exp`), issuer (`iss`), audience (`aud`)
- Token introspection or JWT verification happens server-side, never trust client-supplied token claims without validation
- Short-lived access tokens with refresh token rotation enabled
- PKCE enforced for all public OAuth2 clients
- `redirect_uri` strictly validated — no open redirects in Hydra client config
- Client secrets stored securely, never hardcoded or committed

**Authorization (Ory Keto)**

- Every route/endpoint checks Keto permission, not just authentication (authn ≠ authz)
- No IDOR — resource access checks go through Keto relation tuples, never rely on "user owns this ID" logic in app code alone
- Namespace and relation tuple design reviewed — overly broad `viewer` or `editor` relations not accidentally granting excess access
- Keto check API called with the authenticated subject from Kratos session/Hydra token — never a client-supplied subject
- Deny-by-default — absence of a relation tuple means no access, verify this assumption holds in your Keto namespace config

**General**

- Ory services not exposed directly to the public internet — only public-facing APIs proxied through gateway
- Kratos Admin API, Hydra Admin API, and Keto Write API are internal-only (never publicly accessible)
- All Ory service-to-service communication uses mTLS or is network-isolated
- Ory config files reviewed for insecure defaults before production deploy

### 4. Input Validation & Output Encoding (HIGH)

- All user inputs validated and sanitized server-side
- XSS prevention: output escaped, Content-Security-Policy header set
- File uploads validated (type, size, content) and stored outside webroot
- URL inputs validated against allowlist to prevent SSRF

### 5. Data Protection (HIGH)

- HTTPS enforced; no mixed content
- PII encrypted at rest; sensitive data not logged
- Error messages do not expose internal details or stack traces
- Security headers set (HSTS, X-Content-Type-Options, X-Frame-Options, CSP)
- CORS configured with specific origins (not wildcard in production)

### 6. Dependencies (HIGH)

- `pnpm audit` / `pip audit` / dependency-check clean of critical/high CVEs
- No deprecated or unmaintained packages in critical paths
- Lock files committed; dependencies pinned

### 7. Financial/Transaction Security (CRITICAL, when applicable)

- Financial operations use atomic transactions with row locks
- No race conditions in balance checks (check-then-act patterns)
- No floating-point arithmetic for money (use integer cents or Decimal)
- Audit logging for all money movements
- Rate limiting on financial endpoints

### 8. Database Security (HIGH)

- Row Level Security (RLS) enabled on multi-tenant tables
- No direct database access from client
- Database credentials not hardcoded; rotated regularly
- Parameterized queries only

### 9. Logging & Monitoring (MEDIUM)

- Security events logged (failed logins, authorization failures, input validation errors)
- No sensitive data in logs (passwords, tokens, PII)
- Alerts configured for anomalous patterns

## Anti-Patterns to Always Flag

- Hardcoded secrets or credentials
- String-concatenated SQL/commands with user input
- `innerHTML` with unsanitized user input
- Plaintext password storage or comparison
- Missing authorization checks on endpoints
- `fetch(userProvidedUrl)` without URL validation
- `GRANT ALL` or overly permissive database roles
- Race conditions in financial operations (check-then-act without locks)
- Disabled security features in production (debug mode, permissive CORS)
- Logging passwords, tokens, or API keys

## Common False Positives

- Credentials in `.env.example` (placeholder values, not real secrets)
- Test credentials clearly marked in test files
- Public/publishable API keys (e.g., Stripe publishable key)
- SHA256/MD5 used for checksums, not password hashing

## Output Format

Report findings grouped by severity (CRITICAL > HIGH > MEDIUM > LOW) with:

- File location and line number
- Vulnerability category (e.g., SQL Injection, XSS, Hardcoded Secret)
- Issue description and impact
- Recommended fix

End with the security checklist showing pass/fail status and an overall risk level (CRITICAL / HIGH / MEDIUM / LOW).
