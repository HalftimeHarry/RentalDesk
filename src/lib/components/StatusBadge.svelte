<script lang="ts">
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';

	const map: Record<string, { label: string; variant: BadgeVariant }> = {
		draft: { label: 'Draft', variant: 'secondary' },
		submitted: { label: 'Submitted', variant: 'info' },
		under_review: { label: 'Under review', variant: 'warning' },
		approved: { label: 'Approved', variant: 'success' },
		denied: { label: 'Denied', variant: 'destructive' },
		pending: { label: 'Pending', variant: 'warning' },
		open: { label: 'Open', variant: 'warning' },
		in_progress: { label: 'In progress', variant: 'info' },
		resolved: { label: 'Resolved', variant: 'success' },
		active: { label: 'Active', variant: 'success' },
		ended: { label: 'Ended', variant: 'secondary' },
		signed: { label: 'Signed', variant: 'success' },
		unpaid: { label: 'Unpaid', variant: 'warning' },
		partially_paid: { label: 'Partially paid', variant: 'info' },
		paid: { label: 'Paid', variant: 'success' }
	};

	let { status }: { status: string } = $props();
	let entry = $derived(map[status] ?? { label: status, variant: 'outline' as BadgeVariant });
</script>

<Badge variant={entry.variant}>{entry.label}</Badge>
