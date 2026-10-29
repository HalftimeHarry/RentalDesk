<script lang="ts" module>
	export type FormFeedback = { section?: string; message?: string } | null | undefined;
</script>

<script lang="ts">
	import type { Application } from '$lib/types';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { formatDate, formatMoney } from '$lib/format';
	import { Users } from '@lucide/svelte';

	let { applications, form }: { applications: Application[]; form: FormFeedback } = $props();
</script>

<Card>
	<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Users class="text-ocean size-5" /> Applicants
			</CardTitle>
		<CardDescription>
			{applications.length} application{applications.length === 1 ? '' : 's'} total. Review and
			update their status.
		</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col gap-3">
		{#if form?.section === 'applications'}
			<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
		{/if}
		{#if applications.length === 0}
			<p class="text-muted-foreground text-sm">No applications yet.</p>
		{/if}
		{#each applications as app (app.id)}
			<div class="flex flex-col gap-3 rounded-lg border p-4">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p class="font-medium">{app.full_name || app.expand?.applicant?.name || 'Unnamed'}</p>
						<p class="text-muted-foreground text-sm">
							{app.expand?.applicant?.email} · {app.phone || 'no phone'}
						</p>
					</div>
					<StatusBadge status={app.status} />
				</div>
				<div class="text-muted-foreground grid gap-1 text-sm sm:grid-cols-2">
					<span>Employer: {app.employer || '—'}</span>
					<span>
						Income: {app.monthly_income_cents ? formatMoney(app.monthly_income_cents) + '/mo' : '—'}
					</span>
					<span>Move-in: {formatDate(app.move_in_date)}</span>
					<span>Submitted: {app.submitted ? formatDate(app.submitted) : 'draft'}</span>
				</div>
				{#if app.notes}
					<p class="text-sm whitespace-pre-line">“{app.notes}”</p>
				{/if}
				<form
					method="POST"
					action="?/setApplicationStatus"
					use:enhance
					class="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center"
				>
					<input type="hidden" name="id" value={app.id} />
					<Select.Root type="single" name="status" value={app.status}>
						<Select.Trigger aria-label="Application status" class="w-full sm:w-44">
							<Select.Value />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="under_review">Under review</Select.Item>
							<Select.Item value="approved">Approved</Select.Item>
							<Select.Item value="denied">Denied</Select.Item>
						</Select.Content>
					</Select.Root>
					<Input name="review_notes" placeholder="Review notes (optional)" value={app.review_notes} />
					<Button type="submit" size="sm" variant="outline">Update</Button>
				</form>
			</div>
		{/each}
	</CardContent>
</Card>
