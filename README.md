# RentalDesk

A simple rental management app for one unit. SvelteKit + TypeScript (strict), Tailwind CSS + shadcn-svelte, PocketBase for auth/data/files, deployed on Netlify.

## Roles

| Role | Access |
| --- | --- |
| Owner | Full access, including assigning Admins |
| Admin | Management dashboard (applicants, lease, charges, payments, maintenance, messages) |
| Applicant | Own application, documents, and messages |
| Tenant | Own lease, itemized charges, payments, inspections, documents, maintenance requests, and messages |

Role is enforced server-side: self-registration always creates an **Applicant**, and PocketBase API rules make it impossible for applicants to grant themselves management roles. Only the Owner can assign the Admin role.

## Financial records

- Configurable monthly rent (initially **$2,250**) and security deposit (initially **$500**, tracked separately from rent).
- Configurable lease dates with a **three-month minimum**.
- Calendar-month billing: rent is charged per calendar month; partial first/last months are **prorated by calendar day**.
- Charges and payments are split into a rent ledger and a deposit ledger.

## Areas

1. Public landing page — unit photos, description, rent, availability, Apply button.
2. Registration and login.
3. Owner/Admin dashboard — applicants, current tenant, balance due, maintenance, upcoming lease dates, unit settings, team roles (Owner only).
4. Applicant dashboard — contact details, application status, multi-file document uploads, messages.
5. Tenant dashboard — itemized charges, payments, lease documents, inspections, maintenance requests, messages.

## Setup

1. **PocketBase**: run one locally (`pocketbase serve`) or use a hosted instance.
2. **Env**: `cp .env.example .env` and fill in values.
3. **Provision schema**:

   ```sh
   node --env-file=.env scripts/setup-pocketbase.mjs
   ```

   This creates/updates all collections with hardened API rules, seeds the unit
   settings ($2,250 rent / $500 deposit / 3-month minimum), and optionally creates
   the first Owner account (`OWNER_EMAIL` / `OWNER_PASSWORD`).

4. **Develop**:

   ```sh
   npm install
   npm run dev
   ```

## Deploy (Netlify)

The project uses `@sveltejs/adapter-netlify` (see `netlify.toml`). Connect the
repository in Netlify and set `PUBLIC_POCKETBASE_URL` to your PocketBase URL.

## Useful commands

- `npm run check` — TypeScript/Svelte diagnostics (strict)
- `npm run build` — production build
- `npm run preview` — preview the production build
- `node --env-file=.env scripts/inspect-pocketbase.mjs` — read-only PocketBase schema overview
- `node --env-file=.env scripts/setup-pocketbase.mjs` — provision/refresh collections + API rules (idempotent)
- `node --env-file=.env scripts/verify-pocketbase-rules.mjs` — access-rule test matrix using temporary ordinary accounts (cleans up after itself)

Private document downloads go through `/files/documents/<id>/<filename>`, which
mints a short-lived file token with the signed-in user's permissions before
redirecting to PocketBase. The `documents.file` field is marked `protected`;
upgrade PocketBase to a current release so tokenless URLs are denied outright.
