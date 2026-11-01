/**
 * Domain model for RentalDesk, mirroring the PocketBase collections.
 * Amounts are stored as integer cents to avoid floating-point errors.
 */

export type Role = 'owner' | 'admin' | 'applicant' | 'tenant';

export interface User {
	id: string;
	email: string;
	name: string;
	role: Role;
	phone: string;
	verified: boolean;
	created: string;
	updated: string;
}

export type ApplicationStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'denied';

export interface Application {
	id: string;
	applicant: string; // relation -> users.id
	status: ApplicationStatus;
	full_name: string;
	phone: string;
	current_address: string;
	employer: string;
	monthly_income_cents: number;
	move_in_date: string; // YYYY-MM-DD
	notes: string;
	review_notes: string;
	submitted: string; // ISO datetime or ''
	/** Screening fee presented at submission time (snapshot — price changes never rewrite it). 0 before submission. */
	screening_fee_cents: number;
	/** Applicant-reported Zelle confirmation/reference. Means "payment reported", never "paid". */
	screening_payment_ref: string;
	/** Staff-confirmed receipt of the screening fee. Applicants can never set this (API rule). */
	screening_fee_confirmed: boolean;
	created: string;
	updated: string;
	expand?: { applicant?: User };
}

export type DocumentKind =
	| 'identification'
	| 'income'
	| 'application'
	| 'lease'
	| 'signed_lease'
	| 'inspection'
	| 'receipt'
	| 'bill'
	| 'other';

export interface DocRecord {
	id: string;
	owner: string; // uploader -> users.id
	kind: DocumentKind;
	title: string;
	file: string; // PocketBase stored filename
	application: string; // relation -> applications.id or ''
	lease: string; // relation -> leases.id or ''
	inspection: string; // relation -> inspections.id or ''
	charge: string; // relation -> charges.id or '' (bill attachments)
	created: string;
	expand?: { owner?: User };
}

export type LeaseStatus = 'active' | 'ended' | 'pending';

export interface Lease {
	id: string;
	tenant: string; // relation -> users.id
	start_date: string; // YYYY-MM-DD
	end_date: string; // YYYY-MM-DD
	monthly_rent_cents: number;
	deposit_cents: number;
	status: LeaseStatus;
	created: string;
	updated: string;
	expand?: { tenant?: User };
}

export type ChargeType = 'rent' | 'deposit' | 'late_fee' | 'other';

export interface Charge {
	id: string;
	lease: string; // relation -> leases.id
	period: string; // YYYY-MM for calendar-month rent charges, '' otherwise
	type: ChargeType;
	description: string;
	amount_cents: number;
	amount_pending?: boolean;
	due_date: string; // YYYY-MM-DD
	prorated: boolean;
	status: 'draft' | 'published';
	period_start: string; // YYYY-MM-DD or ''
	period_end: string; // YYYY-MM-DD or ''
	preview_visible?: boolean;
	publish_at?: string; // scheduled publication instant ('' when unscheduled)
	calc: import('./billing').RentComputation | null; // frozen calculation details
	created: string;
}

export type PaymentMethod = 'cash' | 'check' | 'zelle' | 'venmo' | 'bank_transfer' | 'other';

export interface Payment {
	id: string;
	lease: string; // relation -> leases.id
	charge: string; // relation -> charges.id (allocated bill), '' for general
	amount_cents: number;
	date: string; // YYYY-MM-DD
	method: PaymentMethod;
	applies_to: 'rent' | 'deposit';
	note: string;
	reference: string; // e.g. Zelle confirmation
	recorded_by: string; // relation -> users.id
	created: string;
	expand?: { recorded_by?: User };
}

export type MaintenanceStatus = 'open' | 'in_progress' | 'resolved';

export interface HelpVideo {
	id: string;
	slug: string;
	title: string;
	description: string;
	audience: 'tenant' | 'admin';
	placement: 'tenant_dashboard' | 'manage_dashboard' | 'manage_billing';
	video_file: string;
	thumbnail: string;
	captions: string;
	active: boolean;
	created: string;
	updated: string;
}

export type PropertyAccessType = 'gate' | 'door_lockbox';

export interface PropertyAccess {
	id: string;
	label: string;
	type: PropertyAccessType;
	property: string;
	unit: string;
	code: string;
	instructions: string;
	active: boolean;
	created: string;
	updated: string;
}

/** Private manager annotation for an inspection — staff-only collection (the
 * inspection record itself is tenant-visible, so private notes cannot live on it). */
export interface InspectionPrivateNote {
	id: string;
	inspection: string; // relation -> inspections.id
	body: string;
	created_by: string; // relation -> users.id
	created: string;
	updated: string;
}

/** Per-recipient delivery tracking for a signed-inspection confirmation email. */
export interface InspectionNotification {
	id: string;
	inspection: string; // relation -> inspections.id (the signed version)
	recipient: string; // relation -> users.id ('' when no account)
	email: string;
	role: 'landlord' | 'tenant';
	status: 'pending' | 'sent' | 'failed';
	error: string;
	attempts: number;
	sent_at: string; // ISO datetime or ''
	created: string;
	updated: string;
	expand?: { recipient?: User };
}

/** Staff invitation to become an Admin (only role invitations can grant). */
export interface Invitation {
	id: string;
	email: string;
	role: 'admin';
	token: string;
	status: 'pending' | 'accepted' | 'expired' | 'revoked';
	invited_by: string; // relation -> users.id
	expires: string; // ISO datetime
	accepted_by: string; // relation -> users.id ('' until accepted)
	accepted_at: string; // ISO datetime ('' until accepted)
	created: string;
	updated: string;
}

export interface MaintenanceRequest {
	id: string;
	requester: string; // relation -> users.id
	title: string;
	description: string;
	status: MaintenanceStatus;
	photos: string[]; // PocketBase stored filenames (protected multi-image field)
	created: string;
	updated: string;
	expand?: { requester?: User };
}

export type InspectionType = 'move_in' | 'move_out' | 'periodic';

export interface Inspection {
	id: string;
	lease: string; // relation -> leases.id
	date: string; // YYYY-MM-DD — when the inspection takes place
	type: InspectionType;
	notes: string;
	// Full inspection form
	address: string;
	unit: string;
	tenant_names: string;
	move_in_date: string; // YYYY-MM-DD, from the lease (correctable by staff)
	move_out_date: string; // optional
	occupancy: 'occupied' | 'vacant' | '';
	stage: 'draft' | 'in_progress' | 'tenant_reviewed' | 'completed' | 'signed';
	created_by: string; // relation -> users.id
	linked_inspection: string; // move-out -> move-in record link, or ''
	checklist: import('./inspection').ChecklistItem[];
	proposed_deductions: import('./inspection').ProposedDeduction[];
	manager_notes: string; // private — never shown on tenant-facing reports
	signed_copy: string; // protected file (manually uploaded paper scan)
	/** Server-generated final report PDF, persisted at signing (separate from signed_copy). */
	final_pdf: string;
	// Captured signatures + version tying
	sig_landlord: string;
	sig_landlord_name: string;
	sig_landlord_at: string;
	sig_landlord_meta: string;
	sig_tenant: string;
	sig_tenant_name: string;
	sig_tenant_at: string;
	sig_tenant_meta: string;
	signed_snapshot: Record<string, unknown> | null; // frozen content when fully signed
	revision_of: string; // -> inspections.id when this is an unsigned newer revision
	archived: boolean;
	created: string;
	updated: string;
	expand?: { created_by?: User; lease?: Lease };
}

export type MoveOutNoticeStatus = 'submitted' | 'acknowledged';

export interface MoveOutNotice {
	id: string;
	lease: string; // relation -> leases.id
	tenant: string; // relation -> users.id
	tenant_names: string; // snapshot at submission
	property_address: string; // snapshot
	unit: string; // snapshot
	requested_date: string; // YYYY-MM-DD — requested, never auto-approved
	forwarding_address: string;
	notes: string;
	signer_name: string; // typed confirmation
	submitted_at: string; // server timestamp
	notice_pdf: string; // protected file — frozen PDF copy
	status: MoveOutNoticeStatus;
	acknowledged_at: string;
	acknowledged_by: string; // relation -> users.id
	agreed_termination_date: string; // recorded separately by management
	supersedes: string; // -> move_out_notices.id when this is a correction
	client_token: string; // idempotency key (double-click safe submit)
	created: string;
	expand?: { tenant?: User };
}

export interface Message {
	id: string;
	sender: string; // relation -> users.id
	recipient: string; // relation -> users.id
	body: string;
	read: boolean;
	created: string;
	expand?: { sender?: User; recipient?: User };
}

/** Singleton settings record describing the unit and financial defaults. */
export interface UnitSettings {
	id: string;
	unit_name: string;
	description: string;
	address: string;
	monthly_rent_cents: number;
	deposit_cents: number;
	min_lease_months: number;
	available_date: string; // YYYY-MM-DD
	is_available: boolean;
	/** Credit-check (screening) fee presented to applicants before submission. */
	screening_fee_cents: number;
	zelle_instructions: string; // shown to tenants for out-of-band payments
	photos: string[];
	created: string;
	updated: string;
}

/** Ledger summary for a lease, with the deposit tracked separately from rent. */
export interface Ledger {
	rentCharged: number;
	rentPaid: number;
	rentBalance: number;
	depositCharged: number;
	depositPaid: number;
	depositBalance: number;
	totalBalance: number;
}
