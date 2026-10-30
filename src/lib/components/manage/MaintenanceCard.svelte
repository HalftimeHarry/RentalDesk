<script lang="ts">
	import type { MaintenanceRequest } from '$lib/types';
	import type { FormFeedback } from './ApplicantsCard.svelte';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import MaintenancePhotos from '$lib/components/MaintenancePhotos.svelte';
	import { formatDate } from '$lib/format';
	import { Wrench } from '@lucide/svelte';

	let { maintenance, form }: { maintenance: MaintenanceRequest[]; form: FormFeedback } = $props();
</script>

<Card>
	<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Wrench class="text-coral size-5" /> Maintenance
			</CardTitle>
		<CardDescription>Requests from the tenant, newest first.</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col gap-3">
		{#if form?.section === 'maintenance'}
			<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
		{/if}
		{#if maintenance.length === 0}
			<p class="text-muted-foreground text-sm">No maintenance requests.</p>
		{/if}
		{#each maintenance as m (m.id)}
			<div class="flex flex-col gap-2 rounded-lg border p-4 text-sm">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="font-medium">{m.title}</p>
					<StatusBadge status={m.status} />
				</div>
				<p class="text-muted-foreground whitespace-pre-line">{m.description}</p>
				{#if m.photos && m.photos.length > 0}
					<MaintenancePhotos recordId={m.id} photos={m.photos} />
				{/if}
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span class="text-muted-foreground text-xs">
						{m.expand?.requester?.name || 'Tenant'} · {formatDate(m.created)}
					</span>
					<form method="POST" action="?/updateMaintenance" use:enhance class="flex items-center gap-2">
						<input type="hidden" name="id" value={m.id} />
						<Select.Root type="single" name="status" value={m.status}>
							<Select.Trigger aria-label="Maintenance status" class="w-40">
								<Select.Value />
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="open">Open</Select.Item>
								<Select.Item value="in_progress">In progress</Select.Item>
								<Select.Item value="resolved">Resolved</Select.Item>
							</Select.Content>
						</Select.Root>
						<Button type="submit" size="sm" variant="outline">Save</Button>
					</form>
				</div>
			</div>
		{/each}
	</CardContent>
</Card>
