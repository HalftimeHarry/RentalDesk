import type PocketBase from 'pocketbase';
import type { User } from '$lib/types';
import { STAFF_ROLES } from './guard';

/** Pick the first staff account (owner preferred) as the management contact for messages. */
export async function managementContact(pb: PocketBase): Promise<User | null> {
	for (const role of STAFF_ROLES) {
		try {
			const record = await pb
				.collection('users')
				.getFirstListItem(`role = "${role}"`, { sort: 'created' });
			return record as unknown as User;
		} catch {
			// no user with that role yet
		}
	}
	return null;
}

/** All staff accounts, for grouping conversations on the management dashboard. */
export async function staffUsers(pb: PocketBase): Promise<User[]> {
	try {
		const records = await pb
			.collection('users')
			.getFullList({ filter: 'role = "owner" || role = "admin"', sort: 'created' });
		return records as unknown as User[];
	} catch {
		return [];
	}
}
