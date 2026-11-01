export function buildTenantInviteLink(baseUrl: string, email: string): string {
	const normalized = email.trim().toLowerCase();
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
		throw new Error('A valid email address is required for a tenant invite.');
	}

	const base = baseUrl.replace(/\/$/, '');
	const url = new URL('/register', base);
	url.searchParams.set('email', normalized);
	url.searchParams.set('tenantInvite', '1');
	url.searchParams.set('next', '/dashboard/applicant');
	return url.toString();
}
