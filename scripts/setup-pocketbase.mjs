/**
 * RentalDesk — PocketBase provisioning script.
 *
 * Creates/updates every collection with API rules that keep roles safe:
 *  - public registration can only create Applicant accounts
 *  - users can edit their own profile but never their own role
 *  - only the Owner can grant Owner/Admin roles
 *  - Applicants/Tenants only ever see their own records
 *
 * Usage:
 *   cp .env.example .env   # fill in values
 *   node --env-file=.env scripts/setup-pocketbase.mjs
 *
 * Requires: a running PocketBase instance and a superuser account
 * (PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD).
 */
import PocketBase from 'pocketbase';

// Print structured PocketBase errors instead of a stack through minified code.
process.on('unhandledRejection', (err) => {
	console.error('\nFAILED:', err?.status ?? '', err?.message ?? err);
	if (err?.response) console.error('Details:', JSON.stringify(err.response, null, 2));
	process.exit(1);
});

const url = process.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
const adminEmail = process.env.PB_ADMIN_EMAIL || process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const adminPassword = process.env.PB_ADMIN_PASSWORD || process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;

if (!adminEmail || !adminPassword) {
	console.error('Set PRIVATE_POCKETBASE_SUPERUSER_EMAIL and PRIVATE_POCKETBASE_SUPERUSER_PASSWORD (see .env.example).');
	process.exit(1);
}

const pb = new PocketBase(url);
pb.autoCancellation(false);

try {
	await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
} catch {
	// PocketBase < 0.23 fallback
	await pb.admins.authWithPassword(adminEmail, adminPassword);
}
console.log(`Authenticated with ${url}`);

const STAFF = '@request.auth.role = "owner" || @request.auth.role = "admin"';

/** Collections as plain data so they are easy to audit and re-run idempotently. */
const TIMESTAMPS = [
	{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
	{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
];

function collectionDefs(usersId, applicationsId, leasesId, inspectionsId, chargesId) {
	const defs = [
		{
			name: 'applications',
			type: 'base',
			fields: [
				{ name: 'applicant', type: 'relation', required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: true },
				{ name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'submitted', 'under_review', 'approved', 'denied'] },
				{ name: 'full_name', type: 'text', required: true, max: 200 },
				{ name: 'phone', type: 'text', max: 50 },
				{ name: 'current_address', type: 'text', max: 500 },
				{ name: 'employer', type: 'text', max: 200 },
				{ name: 'monthly_income_cents', type: 'number', min: 0, onlyInt: true },
				{ name: 'move_in_date', type: 'date' },
				{ name: 'notes', type: 'text', max: 5000 },
				{ name: 'review_notes', type: 'text', max: 5000 },
				{ name: 'submitted', type: 'date' },
				// Screening fee: amount presented at submission (snapshot — later price
				// changes never rewrite it), the applicant-reported payment reference
				// ("payment reported", not "paid"), and staff confirmation of receipt.
				{ name: 'screening_fee_cents', type: 'number', min: 0, onlyInt: true },
				{ name: 'screening_payment_ref', type: 'text', max: 200 },
				{ name: 'screening_fee_confirmed', type: 'bool' }
			],
			listRule: `applicant = @request.auth.id || ${STAFF}`,
			viewRule: `applicant = @request.auth.id || ${STAFF}`,
			createRule: '@request.auth.role = "applicant" && @request.body.applicant = @request.auth.id',
			// Applicants may save drafts, submit, and report their screening-fee
			// reference — but never set review outcomes or confirm their own fee.
			updateRule: `(applicant = @request.auth.id && (@request.body.status:isset = false || @request.body.status = "draft" || @request.body.status = "submitted") && @request.body.screening_fee_confirmed:isset = false) || ${STAFF}`,
			deleteRule: null
		},
		{
			name: 'leases',
			type: 'base',
			fields: [
				{ name: 'tenant', type: 'relation', required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: false },
				{ name: 'start_date', type: 'date', required: true },
				{ name: 'end_date', type: 'date', required: true },
				{ name: 'monthly_rent_cents', type: 'number', required: true, min: 0, onlyInt: true },
				{ name: 'deposit_cents', type: 'number', required: true, min: 0, onlyInt: true },
				// pending = created but not activated (awaiting signed packet + activation)
				{ name: 'status', type: 'select', required: true, maxSelect: 1, values: ['active', 'ended', 'pending'] }
			],
			listRule: `tenant = @request.auth.id || ${STAFF}`,
			viewRule: `tenant = @request.auth.id || ${STAFF}`,
			createRule: STAFF,
			updateRule: STAFF,
			deleteRule: null
		},
		{
			name: 'charges',
			type: 'base',
			fields: [
				{ name: 'lease', type: 'relation', required: true, collectionId: leasesId, maxSelect: 1, cascadeDelete: true },
				{ name: 'period', type: 'text', max: 7 },
				{ name: 'type', type: 'select', required: true, maxSelect: 1, values: ['rent', 'deposit', 'late_fee', 'other'] },
				{ name: 'description', type: 'text', required: true, max: 300 },
				{ name: 'amount_cents', type: 'number', required: true, min: 0, onlyInt: true },
				{ name: 'due_date', type: 'date', required: true },
				{ name: 'prorated', type: 'bool' },
				// Drafts are management-only; published charges reach the tenant.
				{ name: 'status', type: 'select', required: true, maxSelect: 1, values: ['draft', 'published'] },
				{ name: 'period_start', type: 'date' },
				{ name: 'period_end', type: 'date' },
				// Scheduled publication instant for draft bills (empty = unscheduled draft).
				{ name: 'publish_at', type: 'date' },
				// Frozen calculation details so later settings changes never rewrite history.
				{ name: 'calc', type: 'json', maxSize: 1000000 }
			],
			listRule: `(lease.tenant = @request.auth.id && status = "published") || ${STAFF}`,
			viewRule: `(lease.tenant = @request.auth.id && status = "published") || ${STAFF}`,
			createRule: STAFF,
			updateRule: STAFF,
			deleteRule: STAFF
		},
		// After charges: the rules below resolve charge.status, so the charges
		// collection (with its status field) must exist first on a fresh install.
		{
			name: 'documents',
			type: 'base',
			fields: [
				{ name: 'owner', type: 'relation', required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: true },
				{ name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['identification', 'income', 'application', 'lease', 'signed_lease', 'inspection', 'receipt', 'bill', 'other'] },
				{ name: 'title', type: 'text', required: true, max: 300 },
				// Protected: downloads require a short-lived file token satisfying the record viewRule.
				// PDF/JPEG/PNG only; 100x100 thumbs generated for image previews.
				{ name: 'file', type: 'file', required: true, maxSelect: 1, maxSize: 10485760, protected: true, mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'], thumbs: ['100x100'] },
				{ name: 'application', type: 'relation', collectionId: applicationsId, maxSelect: 1, cascadeDelete: false },
				{ name: 'lease', type: 'relation', collectionId: leasesId, maxSelect: 1, cascadeDelete: false },
				{ name: 'inspection', type: 'relation', collectionId: inspectionsId, maxSelect: 1, cascadeDelete: false },
				{ name: 'charge', type: 'relation', collectionId: chargesId, maxSelect: 1, cascadeDelete: false }
			],
			listRule: `@request.auth.id != "" && (owner = @request.auth.id || application.applicant = @request.auth.id || (lease.tenant = @request.auth.id && (charge = "" || charge.status = "published")) || ${STAFF})`,
			viewRule: `@request.auth.id != "" && (owner = @request.auth.id || application.applicant = @request.auth.id || (lease.tenant = @request.auth.id && (charge = "" || charge.status = "published")) || ${STAFF})`,
			// signed_lease uploads are restricted to staff; every signed-in user can still upload their own other kinds.
			createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id && (@request.body.kind != "signed_lease" || @request.auth.role = "owner" || @request.auth.role = "admin")',
			updateRule: STAFF,
			deleteRule: `owner = @request.auth.id || ${STAFF}`
		},
		{
			name: 'payments',
			type: 'base',
			fields: [
				{ name: 'lease', type: 'relation', required: true, collectionId: leasesId, maxSelect: 1, cascadeDelete: true },
				{ name: 'amount_cents', type: 'number', required: true, min: 0, onlyInt: true },
				{ name: 'date', type: 'date', required: true },
				{ name: 'method', type: 'select', required: true, maxSelect: 1, values: ['cash', 'check', 'zelle', 'venmo', 'bank_transfer', 'other'] },
				{ name: 'applies_to', type: 'select', required: true, maxSelect: 1, values: ['rent', 'deposit'] },
				{ name: 'note', type: 'text', max: 500 },
				{ name: 'charge', type: 'relation', collectionId: chargesId, maxSelect: 1, cascadeDelete: false },
				{ name: 'reference', type: 'text', max: 200 },
				{ name: 'recorded_by', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false }
			],
			listRule: `lease.tenant = @request.auth.id || ${STAFF}`,
			viewRule: `lease.tenant = @request.auth.id || ${STAFF}`,
			createRule: STAFF,
			updateRule: STAFF,
			deleteRule: STAFF
		},
		{
			name: 'maintenance_requests',
			type: 'base',
			fields: [
				{ name: 'requester', type: 'relation', required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: true },
				{ name: 'title', type: 'text', required: true, max: 200 },
				{ name: 'description', type: 'text', required: true, max: 5000 },
				{ name: 'status', type: 'select', required: true, maxSelect: 1, values: ['open', 'in_progress', 'resolved'] },
				// Tenant photo attachments — protected; served via /files/maintenance_requests/...
				{ name: 'photos', type: 'file', required: false, maxSelect: 6, maxSize: 5242880, protected: true, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], thumbs: ['100x100', '300x300', '1024x1024'] }
			],
			listRule: `requester = @request.auth.id || ${STAFF}`,
			viewRule: `requester = @request.auth.id || ${STAFF}`,
			createRule: '@request.auth.id != "" && @request.body.requester = @request.auth.id',
			updateRule: `(requester = @request.auth.id && (@request.body.status:isset = false || @request.body.status = status)) || ${STAFF}`,
			deleteRule: STAFF
		},
		{
			name: 'inspections',
			type: 'base',
			fields: [
				// Optional so inspections work while the unit is vacant; no cascade so
				// history survives lease/tenant turnover.
				{ name: 'lease', type: 'relation', required: false, collectionId: leasesId, maxSelect: 1, cascadeDelete: false },
				{ name: 'date', type: 'date', required: true },
				{ name: 'type', type: 'select', required: true, maxSelect: 1, values: ['move_in', 'move_out', 'periodic'] },
				{ name: 'notes', type: 'text', max: 5000 },
				{ name: 'address', type: 'text', max: 300 },
				{ name: 'unit', type: 'text', max: 50 },
				{ name: 'tenant_names', type: 'text', max: 300 },
				{ name: 'occupancy', type: 'select', maxSelect: 1, values: ['occupied', 'vacant'] },
				{ name: 'move_in_date', type: 'date' },
				{ name: 'move_out_date', type: 'date' },
				{ name: 'stage', type: 'select', maxSelect: 1, values: ['draft', 'in_progress', 'tenant_reviewed', 'completed', 'signed'] },
				{ name: 'created_by', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false },
				{ name: 'checklist', type: 'json', maxSize: 5000000 },
				{ name: 'proposed_deductions', type: 'json', maxSize: 1000000 },
				{ name: 'manager_notes', type: 'text', max: 5000 },
				{ name: 'archived', type: 'bool' },
				{ name: 'signed_copy', type: 'file', maxSelect: 1, maxSize: 10485760, protected: true, mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] },
				// Server-generated final report PDF, persisted when both signatures land.
				// signed_copy stays for manually uploaded paper scans — separate use.
				{ name: 'final_pdf', type: 'file', maxSelect: 1, maxSize: 10485760, protected: true, mimeTypes: ['application/pdf'] },
				// Captured signatures (PNG), printed names, server-side timestamps, and
				// device context (e.g. signed in person on the manager's device).
				{ name: 'sig_landlord', type: 'file', maxSelect: 1, maxSize: 2097152, protected: true, mimeTypes: ['image/png'] },
				{ name: 'sig_landlord_name', type: 'text', max: 200 },
				{ name: 'sig_landlord_at', type: 'date' },
				{ name: 'sig_landlord_meta', type: 'text', max: 300 },
				{ name: 'sig_tenant', type: 'file', maxSelect: 1, maxSize: 2097152, protected: true, mimeTypes: ['image/png'] },
				{ name: 'sig_tenant_name', type: 'text', max: 200 },
				{ name: 'sig_tenant_at', type: 'date' },
				{ name: 'sig_tenant_meta', type: 'text', max: 300 },
				// Frozen content snapshot captured when the second signature is saved.
				{ name: 'signed_snapshot', type: 'json', maxSize: 5000000 }
			],
			listRule: `@request.auth.id != "" && (lease.tenant = @request.auth.id || ${STAFF})`,
			viewRule: `@request.auth.id != "" && (lease.tenant = @request.auth.id || ${STAFF})`,
			createRule: STAFF,
			updateRule: STAFF,
			deleteRule: STAFF
		},
		{
			name: 'messages',
			type: 'base',
			fields: [
				{ name: 'sender', type: 'relation', required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: false },
				{ name: 'recipient', type: 'relation', required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: false },
				{ name: 'body', type: 'text', required: true, max: 5000 },
				{ name: 'read', type: 'bool' }
			],
			listRule: `sender = @request.auth.id || recipient = @request.auth.id || ${STAFF}`,
			viewRule: `sender = @request.auth.id || recipient = @request.auth.id || ${STAFF}`,
			createRule: '@request.auth.id != "" && @request.body.sender = @request.auth.id',
			updateRule: `recipient = @request.auth.id || ${STAFF}`,
			deleteRule: null
		},
		{
			name: 'settings',
			type: 'base',
			fields: [
				{ name: 'unit_name', type: 'text', required: true, max: 200 },
				{ name: 'description', type: 'text', max: 10000 },
				{ name: 'address', type: 'text', max: 300 },
				{ name: 'monthly_rent_cents', type: 'number', required: true, min: 0, onlyInt: true },
				{ name: 'deposit_cents', type: 'number', required: true, min: 0, onlyInt: true },
				{ name: 'min_lease_months', type: 'number', required: true, min: 1, onlyInt: true },
				{ name: 'available_date', type: 'date' },
				{ name: 'is_available', type: 'bool' },
				// Configurable screening (credit-check) fee presented before submission.
				{ name: 'screening_fee_cents', type: 'number', min: 0, onlyInt: true },
				{ name: 'zelle_instructions', type: 'text', max: 1000 },
				{ name: 'photos', type: 'file', maxSelect: 10, maxSize: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] }
			],
			// Public read so the landing page can show the listing.
			listRule: '',
			viewRule: '',
			createRule: STAFF,
			updateRule: STAFF,
			deleteRule: STAFF
		},
		{
			name: 'help_videos',
			type: 'base',
			fields: [
				{ name: 'slug', type: 'text', required: true, max: 100 },
				{ name: 'title', type: 'text', required: true, max: 200 },
				{ name: 'description', type: 'text', max: 2000 },
				{ name: 'audience', type: 'select', required: true, maxSelect: 1, values: ['tenant', 'admin'] },
				{ name: 'placement', type: 'select', required: true, maxSelect: 1, values: ['tenant_dashboard', 'manage_billing'] },
				{ name: 'video_file', type: 'file', required: true, maxSelect: 1, maxSize: 25165824, protected: true, mimeTypes: ['video/mp4'] },
				{ name: 'thumbnail', type: 'file', required: true, maxSelect: 1, maxSize: 5242880, protected: true, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
				{ name: 'captions', type: 'file', required: true, maxSelect: 1, maxSize: 1048576, protected: true, mimeTypes: ['text/vtt', 'text/plain'] },
				{ name: 'active', type: 'bool', required: true }
			],
			listRule: `@request.auth.id != "" && active = true && ((audience = "tenant" && @request.auth.role = "tenant") || (audience = "admin" && (@request.auth.role = "admin" || @request.auth.role = "owner")))`,
			viewRule: `@request.auth.id != "" && active = true && ((audience = "tenant" && @request.auth.role = "tenant") || (audience = "admin" && (@request.auth.role = "admin" || @request.auth.role = "owner")))`,
			createRule: STAFF,
			updateRule: STAFF,
			deleteRule: STAFF
		},
		{
			name: 'property_access',
			type: 'base',
			fields: [
				{ name: 'label', type: 'text', required: true, max: 200 },
				{ name: 'type', type: 'select', required: true, maxSelect: 1, values: ['gate', 'door_lockbox'] },
				{ name: 'property', type: 'text', max: 200 },
				{ name: 'unit', type: 'text', max: 100 },
				{ name: 'code', type: 'text', required: true, max: 200 },
				{ name: 'instructions', type: 'text', max: 1500 },
				{ name: 'active', type: 'bool', required: true }
			],
			listRule: `@request.auth.id != "" && active = true && (@request.auth.role = "tenant" || @request.auth.role = "admin" || @request.auth.role = "owner")`,
			viewRule: `@request.auth.id != "" && active = true && (@request.auth.role = "tenant" || @request.auth.role = "admin" || @request.auth.role = "owner")`,
			createRule: STAFF,
			updateRule: STAFF,
			deleteRule: STAFF
		},
		{
			name: 'move_out_notices',
			type: 'base',
			fields: [
				{ name: 'lease', type: 'relation', required: true, collectionId: leasesId, maxSelect: 1, cascadeDelete: false },
				{ name: 'tenant', type: 'relation', required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: false },
				{ name: 'tenant_names', type: 'text', required: true, max: 300 },
				{ name: 'property_address', type: 'text', required: true, max: 300 },
				{ name: 'unit', type: 'text', max: 50 },
				{ name: 'requested_date', type: 'date', required: true },
				{ name: 'forwarding_address', type: 'text', max: 300 },
				{ name: 'notes', type: 'text', max: 2000 },
				{ name: 'signer_name', type: 'text', required: true, max: 200 },
				{ name: 'submitted_at', type: 'date', required: true },
				{ name: 'notice_pdf', type: 'file', maxSelect: 1, maxSize: 2097152, protected: true, mimeTypes: ['application/pdf'] },
				{ name: 'status', type: 'select', required: true, maxSelect: 1, values: ['submitted', 'acknowledged'] },
				{ name: 'acknowledged_at', type: 'date' },
				{ name: 'acknowledged_by', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false },
				// Recorded separately from requested_date — never auto-approved.
				{ name: 'agreed_termination_date', type: 'date' },
				{ name: 'client_token', type: 'text', max: 64 }
			],
			listRule: `tenant = @request.auth.id || ${STAFF}`,
			viewRule: `tenant = @request.auth.id || ${STAFF}`,
			createRule: '@request.auth.role = "tenant" && @request.body.tenant = @request.auth.id',
			updateRule: STAFF,
			deleteRule: STAFF
		},
		{
			name: 'invitations',
			type: 'base',
			fields: [
				{ name: 'email', type: 'text', required: true, max: 200 },
				// Invitations can only ever grant Admin — the schema allows no other role.
				{ name: 'role', type: 'select', required: true, maxSelect: 1, values: ['admin'] },
				{ name: 'token', type: 'text', required: true, max: 64 },
				{ name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'accepted', 'expired'] },
				{ name: 'invited_by', type: 'relation', required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: false },
				{ name: 'expires', type: 'date', required: true },
				// Filled at acceptance — who accepted and when (server-side only).
				{ name: 'accepted_by', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false },
				{ name: 'accepted_at', type: 'date' }
			],
			// Staff manage invitations; status transitions happen only via the
			// server-side acceptance endpoint (superuser) — no client updates.
			listRule: STAFF,
			viewRule: STAFF,
			createRule: STAFF,
			updateRule: null,
			deleteRule: STAFF
		},
		{
			// Private manager annotations for an inspection. The tenant can view the
			// inspection record itself, so private notes can NOT live on it — they
			// live here, staff-only.
			name: 'inspection_private_notes',
			type: 'base',
			fields: [
				{ name: 'inspection', type: 'relation', required: true, collectionId: inspectionsId, maxSelect: 1, cascadeDelete: true },
				{ name: 'body', type: 'text', max: 5000 },
				{ name: 'created_by', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false }
			],
			listRule: STAFF,
			viewRule: STAFF,
			createRule: STAFF,
			updateRule: STAFF,
			deleteRule: STAFF
		},
		{
			// Per-recipient delivery tracking for signed-inspection confirmations.
			// One row per recipient per signed inspection record (revisions are new
			// records, so delivery is version-scoped). Failures retry without
			// resending successful deliveries.
			name: 'inspection_notifications',
			type: 'base',
			fields: [
				{ name: 'inspection', type: 'relation', required: true, collectionId: inspectionsId, maxSelect: 1, cascadeDelete: true },
				{ name: 'recipient', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false },
				{ name: 'email', type: 'text', required: true, max: 200 },
				{ name: 'role', type: 'select', required: true, maxSelect: 1, values: ['landlord', 'tenant'] },
				{ name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'sent', 'failed'] },
				{ name: 'error', type: 'text', max: 500 },
				{ name: 'attempts', type: 'number', min: 0, onlyInt: true },
				{ name: 'sent_at', type: 'date' }
			],
			listRule: STAFF,
			viewRule: STAFF,
			createRule: STAFF,
			updateRule: STAFF,
			deleteRule: STAFF
		}
	];
	return defs.map((d) => ({ ...d, fields: [...(d.fields || []), ...TIMESTAMPS] }));
}

/**
 * Merge field definitions: update options of existing fields (keeping their
 * ids) and append new ones. Never removes fields, so reruns are safe.
 */
function mergeFields(existingFields, defFields) {
	const existing = existingFields || [];
	const defs = defFields || [];
	const merged = existing.map((f) => {
		const def = defs.find((d) => d.name === f.name);
		return def ? { ...def, id: f.id, name: f.name } : f;
	});
	const existingNames = new Set(existing.map((f) => f.name));
	return [...merged, ...defs.filter((d) => !existingNames.has(d.name))];
}

async function upsertCollection(def) {
	const { name, ...body } = def;
	try {
		const existing = await pb.collections.getOne(name);
		await pb.collections.update(existing.id, {
			...body,
			fields: mergeFields(existing.fields, body.fields)
		});
		console.log(`updated  ${name}`);
	} catch {
		await pb.collections.create({ name, ...body });
		console.log(`created  ${name}`);
	}
}

// --- users (auth collection) -------------------------------------------------
const users = await pb.collections.getOne('users').catch(() => null);
const userFields = [
	{ name: 'role', type: 'select', required: true, maxSelect: 1, values: ['owner', 'admin', 'applicant', 'tenant'] },
	{ name: 'phone', type: 'text', max: 50 }
];
const userRules = {
	// Public sign-up may only ever create an Applicant.
	createRule: '@request.body.role:isset = false || @request.body.role = "applicant"',
	// Self-service edits may never change one's own role. Admins may only flip
	// non-staff records between applicant/tenant (e.g. when a lease starts).
	// Only the Owner can assign management roles.
	updateRule: `(id = @request.auth.id && (@request.body.role:isset = false || @request.body.role = @request.auth.role)) || @request.auth.role = "owner" || (@request.auth.role = "admin" && role != "owner" && role != "admin" && (@request.body.role = "applicant" || @request.body.role = "tenant"))`,
	// Any signed-in user can see staff accounts (management contact); non-staff
	// records are visible only to the account itself and to staff.
	listRule: `@request.auth.id != "" && (id = @request.auth.id || role = "owner" || role = "admin" || ${STAFF})`,
	viewRule: `@request.auth.id != "" && (id = @request.auth.id || role = "owner" || role = "admin" || ${STAFF})`,
	deleteRule: '@request.auth.role = "owner"'
};
if (users) {
	await pb.collections.update(users.id, {
		...userRules,
		fields: mergeFields(users.fields, userFields)
	});
	console.log('updated  users');
} else {
	await pb.collections.create({ name: 'users', type: 'auth', ...userRules, fields: userFields });
	console.log('created  users');
}

const usersId = (await pb.collections.getOne('users')).id;

// Resolve relation targets (create placeholders if missing).
async function ensureCollectionId(name) {
	try {
		return (await pb.collections.getOne(name)).id;
	} catch {
		const created = await pb.collections.create({ name, type: 'base', fields: [{ name: 'placeholder', type: 'text' }] });
		console.log(`created  ${name} (placeholder, will be replaced)`);
		return created.id;
	}
}
const applicationsId = await ensureCollectionId('applications');
const leasesId = await ensureCollectionId('leases');
const inspectionsId = await ensureCollectionId('inspections');
const chargesId = await ensureCollectionId('charges');

for (const def of collectionDefs(usersId, applicationsId, leasesId, inspectionsId, chargesId)) {
	await upsertCollection(def);
}

// Self-referencing link from a move-out inspection back to its move-in record.
{
	const inspCol = await pb.collections.getOne('inspections');
	if (!(inspCol.fields || []).some((f) => f.name === 'linked_inspection')) {
		await pb.collections.update(inspCol.id, {
			fields: [
				...(inspCol.fields || []),
				{ name: 'linked_inspection', type: 'relation', collectionId: inspCol.id, maxSelect: 1, cascadeDelete: false }
			]
		});
		console.log('updated  inspections (+linked_inspection)');
	}
}

// Self-referencing revision link: editing a signed inspection creates a new
// unsigned revision pointing back at the preserved signed version.
{
	const inspCol = await pb.collections.getOne('inspections');
	if (!(inspCol.fields || []).some((f) => f.name === 'revision_of')) {
		await pb.collections.update(inspCol.id, {
			fields: [
				...(inspCol.fields || []),
				{ name: 'revision_of', type: 'relation', collectionId: inspCol.id, maxSelect: 1, cascadeDelete: false }
			]
		});
		console.log('updated  inspections (+revision_of)');
	}
}

// Self-referencing correction link for move-out notices (a correction is a new
// version; the submitted original is never modified).
{
	const monCol = await pb.collections.getOne('move_out_notices');
	if (!(monCol.fields || []).some((f) => f.name === 'supersedes')) {
		await pb.collections.update(monCol.id, {
			fields: [
				...(monCol.fields || []),
				{ name: 'supersedes', type: 'relation', collectionId: monCol.id, maxSelect: 1, cascadeDelete: false }
			]
		});
		console.log('updated  move_out_notices (+supersedes)');
	}
}

// Remove placeholder fields left from placeholder creation, if any.
for (const name of ['applications', 'leases', 'inspections']) {
	const col = await pb.collections.getOne(name);
	const cleaned = (col.fields || []).filter((f) => f.name !== 'placeholder');
	if (cleaned.length !== (col.fields || []).length) {
		await pb.collections.update(col.id, { fields: cleaned });
		console.log(`cleaned  ${name} placeholder field`);
	}
}

// --- dedupe settings (keeps the most recently saved record; never resets data) ---
const allSettings = await pb.collection('settings').getFullList().catch(() => []);
if (allSettings.length > 1) {
	const ranked = [...allSettings].sort((a, b) =>
		(a.updated || a.created || '').localeCompare(b.updated || b.created || '')
	);
	const keep = ranked[ranked.length - 1];
	for (const r of allSettings) {
		if (r.id !== keep.id) await pb.collection('settings').delete(r.id);
	}
	console.log(`deduped  settings (${allSettings.length - 1} duplicate(s) removed, kept ${keep.id})`);
}

// --- seed settings ------------------------------------------------------------
const settings = await pb.collection('settings').getList(1, 1).catch(() => null);
if (!settings || settings.totalItems === 0) {
	await pb.collection('settings').create({
		unit_name: 'Rental Unit',
		description: 'A clean, well-maintained unit ready for move-in.',
		address: '',
		monthly_rent_cents: 225000, // $2,250
		deposit_cents: 50000, // $500
		min_lease_months: 3,
		available_date: '',
		is_available: true,
		screening_fee_cents: 3500 // $35 credit-check fee
	});
	console.log('seeded   settings ($2,250 rent, $500 deposit, 3-month minimum, $35 screening fee)');
}

// --- seed owner account --------------------------------------------------------
const ownerEmail = process.env.OWNER_EMAIL;
const ownerPassword = process.env.OWNER_PASSWORD;
if (ownerEmail && ownerPassword) {
	const existing = await pb
		.collection('users')
		.getFirstListItem(`email = "${ownerEmail}"`)
		.catch(() => null);
	if (!existing) {
		await pb.collection('users').create({
			email: ownerEmail,
			password: ownerPassword,
			passwordConfirm: ownerPassword,
			name: process.env.OWNER_NAME || 'Owner',
			role: 'owner'
		});
		console.log(`created  owner account ${ownerEmail}`);
	} else {
		console.log(`owner    ${ownerEmail} already exists`);
	}
}

console.log('\nDone. RentalDesk schema is ready.');
