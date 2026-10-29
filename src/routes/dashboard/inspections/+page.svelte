<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { STAGE_LABELS } from '$lib/inspection';
	import { formatDate } from '$lib/format';
	import { ClipboardList, Plus } from '@lucide/svelte';
	import type { InspectionStage } from '$lib/inspection';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let leaseId = $state('');
	let type = $state('move_in');
	let tenantName = $state('');

	let leaseLabel = $derived(
		leaseId === 'vacant'
			? 'Vacant — no lease'
			: (() => {
					const l = data.leases.find((x) => x.id === leaseId);
					return l
						? `${l.expand?.tenant?.name || 'Tenant'} · ${formatDate(l.start_date)} (${l.status})`
						: 'Select lease or vacant';
				})()
	);

	const typeLabels: Record<string, string> = {
		move_in: 'Move-in',
		move_out: 'Move-out',
		periodic: 'Periodic'
	};
</script>

<svelte:head>
	<title>Inspections — RentalDesk</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight text-white drop-shadow-sm">Inspections</h1>
		<p class="text-white/85 drop-shadow-sm">Inspection history and new inspection reports.</p>
	</div>

	<Card class="bg-card/95">
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Plus class="size-5" /> New inspection
			</CardTitle>
			<CardDescription>
				Creates a draft with the full nine-section checklist. Dates load from the lease.
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.message}
				<p class="bg-destructive/10 text-destructive mb-3 rounded-md px-3 py-2 text-sm">
					{form.message}
				</p>
			{/if}
			<form
				method="POST"
				action="?/createInspection"
				use:enhance
				class="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4"
			>
				<div class="flex flex-col gap-2">
					<Label for="i-lease">Lease / tenant</Label>
					<Select.Root type="single" name="lease" bind:value={leaseId}>
						<Select.Trigger id="i-lease" class="min-h-12 w-full">
							{leaseLabel}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="vacant">Vacant — no lease</Select.Item>
							{#each data.leases as lease (lease.id)}
								<Select.Item value={lease.id}>
									{lease.expand?.tenant?.name || lease.expand?.tenant?.email || 'Tenant'} · {formatDate(
										lease.start_date
									)} ({lease.status})
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="i-tenant-name">Tenant / contact name (vacant units)</Label>
					<Input
						id="i-tenant-name"
						name="tenant_name"
						placeholder="e.g. Jordan Walker"
						bind:value={tenantName}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="i-type">Inspection type</Label>
					<Select.Root type="single" name="type" bind:value={type}>
						<Select.Trigger id="i-type" class="min-h-12 w-full">
							{typeLabels[type]}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="move_in">Move-in</Select.Item>
							<Select.Item value="move_out">Move-out</Select.Item>
							<Select.Item value="periodic">Periodic</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<Button type="submit" class="min-h-12 text-base">New inspection</Button>
			</form>
		</CardContent>
	</Card>

	<Card class="bg-card/95">
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<ClipboardList class="size-5" /> Inspection history
			</CardTitle>
			<CardDescription>All inspections, newest first. Prior inspections are preserved.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if data.inspections.length === 0}
				<p class="text-muted-foreground text-sm">No inspections yet.</p>
			{:else}
				<!-- Stacked readable cards on small screens -->
				<ul class="flex flex-col gap-3 sm:hidden">
					{#each data.inspections as i (i.id)}
						<li>
							<a
								href="/dashboard/inspections/{i.id}/record"
								class="bg-card block rounded-xl border p-4 shadow-sm"
							>
								<div class="flex items-center justify-between gap-2">
									<p class="font-medium">{i.tenant_names || 'Vacant / no tenant'}</p>
									<StatusBadge status={i.stage === 'tenant_reviewed' ? 'under_review' : i.stage === 'in_progress' ? 'in_progress' : i.stage === 'completed' ? 'resolved' : i.stage === 'signed' ? 'signed' : 'draft'} />
								</div>
								<p class="text-muted-foreground mt-1 text-sm">{i.address} · Unit {i.unit}</p>
								<p class="text-muted-foreground text-sm">
									{typeLabels[i.type] ?? i.type} · {formatDate(i.date)} · by{' '}
									{i.expand?.created_by?.name || '—'}
								</p>
								<p class="text-muted-foreground mt-1 text-xs">
									{STAGE_LABELS[(i.stage as InspectionStage) || 'draft']} · {i.occupancy === 'vacant' ? 'Vacant' : 'Occupied'}
								</p>
								{#if i.notes}
									<p class="text-muted-foreground mt-1 text-xs">{i.notes}</p>
								{/if}
							</a>
						</li>
					{/each}
				</ul>

				<!-- Full table on larger screens -->
				<div class="hidden sm:block">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Tenant(s)</TableHead>
								<TableHead>Property / Unit</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Inspection date</TableHead>
								<TableHead>Created by</TableHead>
								<TableHead>Workflow stage</TableHead>
								<TableHead>Notes</TableHead>
								<TableHead class="text-right">Open</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each data.inspections as i (i.id)}
								<TableRow>
									<TableCell>{i.tenant_names || 'Vacant / no tenant'}</TableCell>
									<TableCell class="max-w-44 truncate">{i.address} · Unit {i.unit}</TableCell>
									<TableCell>
										{typeLabels[i.type] ?? i.type}
										<span class="text-muted-foreground block text-xs">
											{i.occupancy === 'vacant' ? 'Vacant' : 'Occupied'}
										</span>
									</TableCell>
									<TableCell>{formatDate(i.date)}</TableCell>
									<TableCell>{i.expand?.created_by?.name || '—'}</TableCell>
									<TableCell>
										<StatusBadge status={i.stage === 'tenant_reviewed' ? 'under_review' : i.stage === 'in_progress' ? 'in_progress' : i.stage === 'completed' ? 'resolved' : i.stage === 'signed' ? 'signed' : 'draft'} />
										<span class="text-muted-foreground ml-1 text-xs">
											{STAGE_LABELS[(i.stage as InspectionStage) || 'draft']}
										</span>
									</TableCell>
									<TableCell class="text-muted-foreground max-w-40 truncate">{i.notes}</TableCell>
									<TableCell class="text-right">
										<Button href="/dashboard/inspections/{i.id}/record" variant="outline" size="sm">
											Open
										</Button>
									</TableCell>
								</TableRow>
							{/each}
						</TableBody>
					</Table>
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
