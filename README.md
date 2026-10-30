# Rental Desk

A personalized rental-management experience, initially built for one owner and one
rental unit. It connects a public listing with applicant onboarding, lease
documents, billing, maintenance, inspections, and move-out workflows.

Its intended value is clearer communication and less administrative work: people
know what to pay, where their documents are, how to report problems, and what
happens next.

SvelteKit + TypeScript (strict), Tailwind CSS + shadcn-svelte, PocketBase for
auth/data/files, deployed on Netlify.

## Six-month pilot

- Use the app for at least six months before evaluating commercial expansion.
- Target pilot window: **October 30, 2026 – April 30, 2027**; review on or after
  April 30, extending the pilot if useful.
- Prioritize reliability and actual rental needs over speculative features.
- Keep a lightweight record of bugs, confusing steps, manual workarounds, time
  saved, tenant feedback, and operating costs.
- Evaluate real billing/payment cycles, utilities, document retrieval,
  maintenance, notifications, and inspections.
- Test workflows that do not naturally occur during the pilot (e.g. move-out)
  with isolated fictional data — never by experimenting on real records.

## Possible future customers

Small landlords, agents who place tenants, and agents who manage a small rental
portfolio. Sales-focused brokerage workflows are outside the current scope.

## Potential differentiation (hypothesis — not proven demand)

- Personalized property branding and clear tenant communication.
- Attractive listing photos, video, and promotional content.
- A connected listing-to-application-to-tenancy experience.
- A possible service offering combining setup, listing content, and the tenant
  portal.

Rental Desk is **not** currently positioned as a full replacement for established
property-management platforms.

## Customization strategy

One maintainable foundation with configurable branding, property details,
contacts, fees, templates, and supported workflow options. Avoid separate
codebases per customer.

## Future expansion gates

Before serving unrelated customers, evaluate:

- Multi-property support.
- Organization-level data isolation ("multi-tenancy"), distinct from rental
  tenants.
- Role permissions, backups, audit history, support, accessibility, and privacy.
- Reliable notifications, operational monitoring, and database migrations.
- Sustainable setup/support pricing and demonstrated willingness to pay.

## Six-month re-evaluation

Use pilot evidence to decide whether to:

1. Keep it as a personal rental tool.
2. Offer a small service-backed product to a few customers.
3. Invest in a broader subscription platform.

Review reliability, reconciliation accuracy, user feedback, support burden,
hosting/email costs, and actual customer interest before choosing.

## What the app does today

1. **Public landing page** — photos, description, rent, availability, map preview,
   Apply button.
2. **Registration/login** — self-registration always creates an Applicant.
3. **Applicant dashboard** — contact details, application draft/submit, document
   uploads (incl. ID), configurable credit-check fee with payment instructions and
   a reference field ("payment reported", staff confirms receipt), messages.
4. **Management dashboard (Owner/Admin)** — applicants review, pending lease +
   explicit tenancy activation (requires approved application + uploaded signed
   lease; activation grants Tenant access, creates draft move-in charges, delists
   the unit), billing workspace (charges, payments, draft/published + scheduled
   publishing, monthly statements), inspections, maintenance, move-out notices,
   messages, settings, team management.
5. **Tenant dashboard** — itemized charges and balances, payment history, monthly
   statements, lease documents, inspections, maintenance requests with photos,
   move-out notice + cleaning-receipt upload, messages.

DocuSign signing happens **outside** the app (no integration); staff upload the
completed packet. Credit-screening authorization/signature collection is **not
built yet** — see the note under Security.

### Roles

| Role | Access |
| --- | --- |
| Owner | Full access; only the Owner can directly change account roles |
| Admin | Everything managerial; can invite new Admins by link |
| Applicant | Own application, documents, and messages |
| Tenant | Own lease, itemized charges, payments, inspections, documents, maintenance, messages |

Admin invitations: staff create a 7-day invite link (invitations can only grant
Admin); acceptance is server-side and requires the invited account.

### Financial records

- Configurable rent, deposit (tracked separately from rent), screening fee
  (initially $35), and lease dates with a three-month minimum.
- Calendar-month billing; partial first/last months prorated by calendar day.
- Charges start as drafts; publishing is explicit (manual or scheduled via a
  Netlify function). Payments are recorded against specific charges with a
  duplicate guard; the rent and deposit ledgers stay separate.

## Development & testing practices

- **Fictional test data belongs in the isolated local PocketBase** — never in
  production. Production holds real records and must not be replaced with test
  data.
- **Separate checkouts/caches prevent environment collisions**: run the
  production-connected dev server from this checkout (`.env`) and the test app
  from a separate copy with its own `.svelte-kit`/`node_modules/.vite` (SvelteKit
  dev writes resolved env into shared generated files — one checkout cannot serve
  both configurations).
- **Git/Netlify deployment does not migrate PocketBase.** Schema/rule changes go
  through the idempotent provisioning script and require reviewed migrations and
  production backups.
- **Never commit secrets, private documents, or real tenant information.**

Commands:

```sh
npm run check            # strict TypeScript/Svelte diagnostics
npm test                 # database-free unit tests (billing math, email safeguards, templates)
```

Local test stack (all guarded — verification scripts refuse non-local targets):

```sh
# Isolated PocketBase (any local install) at http://127.0.0.1:8090, then:
node --env-file=.env.test --env-file=.env.test.local scripts/setup-pocketbase.mjs   # provision local schema
node --env-file=.env.test --env-file=.env.test.local scripts/seed-local-test.mjs    # fictional Owner/Admin/Applicant/Tenant + sample data (idempotent)

# Test app on a separate copy, e.g. /tmp/rentaldesk-test (own caches), port 5174:
PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090 npm run dev -- --port 5174
```

`.env.test.local` (git-ignored) holds the local superuser and the shared
`@example.test` account password — open it privately. `invitee@example.test` is
deliberately unseeded for invitation testing.

Verifier scripts (self-cleaning, local only):

```sh
node --env-file=.env.test --env-file=.env.test.local scripts/verify-pocketbase-rules.mjs         # access-rule matrix
node --env-file=.env.test --env-file=.env.test.local scripts/verify-lease-activation.mjs         # pending lease + screening fee
node --env-file=.env.test --env-file=.env.test.local scripts/verify-charge-payments.mjs          # payment recording (HTTP)
node --env-file=.env.test --env-file=.env.test.local scripts/verify-charge-payments.browser.mjs  # real-browser UI (needs Playwright + chromium)
node --env-file=.env.test --env-file=.env.test.local scripts/verify-invitations.mjs              # admin invitations
node --env-file=.env.test --env-file=.env.test.local scripts/verify-inspections.mjs              # inspection workflow
node --env-file=.env.test --env-file=.env.test.local scripts/verify-move-out-notices.mjs         # move-out notices
node --env-file=.env.test --env-file=.env.test.local scripts/verify-maintenance-photos.mjs       # maintenance photos
node --env-file=.env.test --env-file=.env.test.local scripts/verify-settings-persistence.mjs     # settings round-trip
```

## Security

- Every collection has explicit API rules; ownership rules are wrapped in
  `@request.auth.id != "" && (...)` so blank optional relations can never match an
  anonymous request.
- Private files are **proxied** through `/files/<collection>/<id>/<filename>` with
  a short-lived per-user file token — PocketBase URLs and tokens stay server-side,
  and anonymous requests are rejected.
- Outbound email ([src/lib/server/mail.ts](src/lib/server/mail.ts)) is disabled
  unless `PRIVATE_EMAIL_ENABLED=true` and every To/CC/BCC recipient must be on a
  server-side test allowlist. No automatic notifications are currently wired.
- Screening authorization/signature and SSN handling are intentionally **not
  implemented** pending a screening-provider decision; the app never collects SSNs.
- Secrets live only in git-ignored env files and Netlify environment variables.

## Setup

1. **PocketBase**: run one locally (`pocketbase serve`) or use a hosted instance.
2. **Env**: `cp .env.example .env` and fill in values.
3. **Provision schema**:

   ```sh
   node --env-file=.env scripts/setup-pocketbase.mjs
   ```

   Creates/updates all collections with hardened API rules, seeds unit settings,
   and optionally creates the first Owner account (`OWNER_EMAIL`/`OWNER_PASSWORD`).

4. **Develop**: `npm install && npm run dev`.

## Deploy (Netlify)

`@sveltejs/adapter-netlify` (see `netlify.toml`). Connect the repository and set:

- `PUBLIC_POCKETBASE_URL` — PocketBase URL
- `PRIVATE_POCKETBASE_SUPERUSER_EMAIL` / `PRIVATE_POCKETBASE_SUPERUSER_PASSWORD` —
  used by the scheduled bill-publishing function only
- `RESEND_API_KEY`, `EMAIL_FROM`, `PRIVATE_EMAIL_ENABLED` — email (leave the enable
  flag unset/false to keep all outbound email off)

Deployment does not touch PocketBase data or schema — provision separately.
