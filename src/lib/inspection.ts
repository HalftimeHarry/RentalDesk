/**
 * RentalDesk inspection checklist template and model.
 * Nine sections; each item tracks move-in and move-out observations separately
 * so the original condition is always preserved.
 */

export type ConditionCode = 'not_reviewed' | 'ok' | 'na' | 'other';

export const CONDITIONS: { code: ConditionCode; label: string; hint?: string }[] = [
	{ code: 'not_reviewed', label: 'Not reviewed' },
	{ code: 'ok', label: 'OK' },
	{ code: 'na', label: 'N/A' },
	{ code: 'other', label: 'O', hint: 'Other — explain in the comment' }
];

export const CONDITION_LABELS: Record<ConditionCode, string> = {
	not_reviewed: 'Not reviewed',
	ok: 'OK',
	na: 'N/A',
	other: 'O (Other)'
};

export interface ItemState {
	condition: ConditionCode;
	comment: string;
	photos: string[]; // document record ids
}

export interface ChecklistItem {
	section: string;
	item: string;
	/** Flagged for follow-up (repairs, estimates) — shown in the follow-up list. */
	flagged: boolean;
	moveIn: ItemState;
	moveOut: ItemState;
}

export const INSPECTION_SECTIONS: { section: string; items: string[] }[] = [
	{
		section: 'General Condition',
		items: [
			'Walls / Ceilings',
			'Floors / Baseboards',
			'Entry Door / Locks',
			'Windows / Screens',
			'Lighting / Fixtures'
		]
	},
	{
		section: 'Living Room',
		items: [
			'Walls / Ceilings',
			'Floors / Carpet',
			'Windows / Screens / Blinds',
			'Outlets / Switches',
			'Lighting / Ceiling Fan',
			'Closet / Doors'
		]
	},
	{
		section: 'Dining Area',
		items: [
			'Walls / Ceilings',
			'Floors',
			'Windows / Screens / Blinds',
			'Lighting / Fixture',
			'Outlets / Switches'
		]
	},
	{
		section: 'Kitchen',
		items: [
			'Cabinets / Counters / Hardware',
			'Sink / Faucet / Disposal',
			'Stove / Oven',
			'Refrigerator',
			'Dishwasher',
			'Flooring',
			'Walls / Ceiling',
			'Windows / Screens'
		]
	},
	{
		section: 'Bedroom',
		items: [
			'Walls / Ceilings',
			'Floors / Carpet',
			'Windows / Screens / Blinds',
			'Closet / Doors',
			'Outlets / Switches',
			'Lighting'
		]
	},
	{
		section: 'Bathroom',
		items: [
			'Tub / Shower',
			'Sink / Vanity',
			'Toilet',
			'Mirror / Cabinets',
			'Flooring',
			'Exhaust Fan',
			'Caulking / Grout'
		]
	},
	{
		section: 'Small Hallway',
		items: ['Walls', 'Flooring', 'Lighting', 'Smoke Detector', 'Linen Closet / Door']
	},
	{
		section: 'Systems / Safety / Security',
		items: [
			'Heating / AC',
			'Water Heater',
			'Electrical Panel',
			'Smoke / CO Detectors',
			'Doorbell / Security Device',
			'Locks / Deadbolts',
			'Fire Extinguisher'
		]
	},
	{
		section: 'Included Items / Final Notes',
		items: [
			'Keys / Remotes',
			'Appliances Included',
			'Furniture / Extras',
			'Parking / Storage',
			'Final Notes'
		]
	}
];

export function emptyState(): ItemState {
	return { condition: 'not_reviewed', comment: '', photos: [] };
}

/** A fresh checklist: every item Not reviewed, both sides empty. */
export function emptyChecklist(): ChecklistItem[] {
	return INSPECTION_SECTIONS.flatMap(({ section, items }) =>
		items.map((item) => ({ section, item, flagged: false, moveIn: emptyState(), moveOut: emptyState() }))
	);
}

function isItemState(v: unknown): v is ItemState {
	const s = v as ItemState;
	return (
		!!s &&
		typeof s === 'object' &&
		['not_reviewed', 'ok', 'na', 'other'].includes(s.condition) &&
		typeof s.comment === 'string' &&
		Array.isArray(s.photos)
	);
}

/**
 * Parse a stored checklist, filling gaps with the template so older records
 * and partial saves always render every item.
 */
export function parseChecklist(raw: unknown): ChecklistItem[] {
	const base = emptyChecklist();
	if (!Array.isArray(raw)) return base;
	for (const entry of raw as Partial<ChecklistItem>[]) {
		const target = base.find((b) => b.section === entry?.section && b.item === entry?.item);
		if (!target) continue;
		if (isItemState(entry.moveIn)) target.moveIn = entry.moveIn;
		if (isItemState(entry.moveOut)) target.moveOut = entry.moveOut;
		if (typeof entry.flagged === 'boolean') target.flagged = entry.flagged;
	}
	return base;
}

/** All items marked O (Other) on either side — used for the PDF summary. */
export function otherItems(checklist: ChecklistItem[]): {
	section: string;
	item: string;
	side: 'Move-in' | 'Move-out';
	comment: string;
}[] {
	const out: { section: string; item: string; side: 'Move-in' | 'Move-out'; comment: string }[] = [];
	for (const c of checklist) {
		if (c.moveIn.condition === 'other')
			out.push({ section: c.section, item: c.item, side: 'Move-in', comment: c.moveIn.comment });
		if (c.moveOut.condition === 'other')
			out.push({ section: c.section, item: c.item, side: 'Move-out', comment: c.moveOut.comment });
	}
	return out;
}

export type InspectionStage = 'draft' | 'in_progress' | 'tenant_reviewed' | 'completed' | 'signed';

/**
 * A proposed security-deposit deduction. Proposals are documentation only —
 * they are never applied to charges automatically.
 */
export interface ProposedDeduction {
	description: string;
	amount_cents: number;
}

/** Sanitize stored proposed deductions. */
export function parseDeductions(raw: unknown): ProposedDeduction[] {
	if (!Array.isArray(raw)) return [];
	return (raw as Partial<ProposedDeduction>[])
		.filter(
			(d): d is { description: string; amount_cents: number } =>
				typeof d?.description === 'string' &&
				typeof d?.amount_cents === 'number' &&
				Number.isInteger(d.amount_cents) &&
				d.amount_cents >= 0
		)
		.map((d) => ({ description: d.description, amount_cents: d.amount_cents }));
}

/** Items flagged for follow-up on either workflow side. */
export function flaggedItems(checklist: ChecklistItem[]): { section: string; item: string }[] {
	return checklist
		.filter((c) => c.flagged)
		.map((c) => ({ section: c.section, item: c.item }));
}

export const STAGE_LABELS: Record<InspectionStage, string> = {
	draft: 'Draft',
	in_progress: 'In progress',
	tenant_reviewed: 'Tenant reviewed',
	completed: 'Completed',
	signed: 'Signed'
};

export const DEFAULT_PROPERTY_ADDRESS = '2728 B Street, San Diego CA 92102';
export const DEFAULT_UNIT = '102';

/** Display label for a stored condition; unmarked items render as a plain dash
 * (never implied OK). Legacy 'ok' marks still display as OK. */
export function markLabel(code: ConditionCode): string {
	return code === 'not_reviewed' ? '—' : CONDITION_LABELS[code];
}
