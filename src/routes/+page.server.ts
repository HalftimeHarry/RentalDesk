import type { PageServerLoad } from './$types';
import type { UnitSettings } from '$lib/types';
import { fileUrl } from '$lib/files';

/** Defaults keep the landing page useful even before PocketBase is configured. */
const FALLBACK_SETTINGS: UnitSettings = {
	id: '',
	unit_name: 'Comfortable Rental Unit',
	description:
		'A clean, well-maintained unit ready for move-in. Apply online and we will be in touch shortly.',
	address: '',
	monthly_rent_cents: 225000,
	deposit_cents: 50000,
	min_lease_months: 3,
	available_date: '',
	is_available: false,
	screening_fee_cents: 3500,
	zelle_instructions: '',
	photos: [],
	created: '',
	updated: ''
};

export const load: PageServerLoad = async ({ locals }) => {
	let settings = FALLBACK_SETTINGS;
	let live = false;
	try {
		const record = await locals.pb.collection('settings').getList(1, 1, { sort: 'created' });
		if (record.items.length > 0) {
			settings = { ...FALLBACK_SETTINGS, ...(record.items[0] as unknown as UnitSettings) };
			live = true;
		}
	} catch {
		// PocketBase not reachable or settings not seeded yet — use fallback content.
	}

	return {
		settings,
		live,
		photoUrls: settings.photos.map((p) => fileUrl('settings', settings.id, p))
	};
};
