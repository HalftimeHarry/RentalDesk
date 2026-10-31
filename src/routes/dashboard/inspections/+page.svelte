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
	import { archiveRequiredReason, canDeleteInspection } from '$lib/inspection-cleanup';
	import { STAGE_LABELS } from '$lib/inspection';
	import { formatDate } from '$lib/format';
	import { ClipboardList, Plus } from '@lucide/svelte';
	import type { InspectionStage } from '$lib/inspection';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let leaseId = $state('');
	let type = $state('move_in');
	let tenantName = $state('');
	let selectedIds = $state<Record<string, boolean>>({});
	let selectedCount = $derived(Object.values(selectedIds).filter(Boolean).length);
	let selectedNames = $derived(
		data.inspections
			.filter((inspection) => selectedIds[inspection.id])
			.map(
				(inspection) =>
					`${inspection.tenant_names || 'Vacant / no tenant'} · ${inspection.address || 'Unknown property'} · Unit ${inspection.unit || '—'}`
			)
	);

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

	function workflowStatus(status: string): string {
		switch (status) {
			case 'draft':
				return 'draft';
			case 'in_progress':
				return 'in_progress';
			case 'tenant_reviewed':
				return 'under_review';
			case 'completed':
				return 'resolved';
			case 'signed':
				return 'signed';
			default:
				return 'draft';
		}
	}

	function displayWorkflowName(inspection: { stage: string; archived?: boolean }): string {
		if (inspection.archived) return 'Archived';
		return STAGE_LABELS[(inspection.stage as InspectionStage) || 'draft'];
	}

	function confirmDeleteInspection(inspection: { tenant_names?: string; address?: string; unit?: string }) {
		const name = `${inspection.tenant_names || 'Vacant / no tenant'} · ${inspection.address || 'Unknown property'} · Unit ${inspection.unit || '—'}`;
		return confirm(`Delete this unsigned draft inspection?\n${name}`);
	}

	function confirmBulkDelete() {
		if (selectedCount === 0) return false;
		const preview = selectedNames.slice(0, 3).join('\n');
		const extras = selectedNames.length > 3 ? `\n... and ${selectedNames.length - 3} more` : '';
		return confirm(`Delete ${selectedCount} eligible unsigned draft inspection(s)?\n${preview}${extras}`);
	}

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
			<div class="mb-4 flex items-center justify-between gap-3">
				<p class="text-muted-foreground text-sm">
					{data.showArchived ? 'Showing archived and active inspections.' : 'Showing active inspections only.'}
				</p>
				{#if data.showArchived}
					<Button href="/dashboard/inspections" variant="outline" size="sm">Hide archived</Button>
				{:else}
					<Button href="/dashboard/inspections?show_archived=1" variant="outline" size="sm">Show archived</Button>
				{/if}
			</div>

			{#if selectedCount > 0}
				<div class="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
					<div class="flex items-center justify-between gap-3">
						<p>{selectedCount} eligible draft inspection(s) selected for deletion.</p>
						<form method="POST" action="?/bulkDeleteInspections" use:enhance>
							{#each data.inspections as inspection (inspection.id)}
								{#if selectedIds[inspection.id]}
									<input type="hidden" name="ids" value={inspection.id} />
								{/if}
							{/each}
							<Button
								type="submit"
								variant="destructive"
								size="sm"
								onclick={(event) => {
									if (!confirmBulkDelete()) event.preventDefault();
								}}
							>
								Delete selected
							</Button>
						</form>
					</div>
				</div>
			{/if}

			{#if data.inspections.length === 0}
				<p class="text-muted-foreground text-sm">No inspections yet.</p>
			{:else}
				<ul class="flex flex-col gap-3 sm:hidden">
					{#each data.inspections as i (i.id)}
						<li>
							<div class="bg-card rounded-xl border p-4 shadow-sm">
								<div class="flex items-center justify-between gap-2">
									<p class="font-medium">{i.tenant_names || 'Vacant / no tenant'}</p>
									<StatusBadge status={workflowStatus(i.stage)} />
								</div>
								<p class="text-muted-foreground mt-1 text-sm">{i.address} · Unit {i.unit}</p>
								<p class="text-muted-foreground text-sm">
									{typeLabels[i.type] ?? i.type} · {formatDate(i.date)} · by {i.expand?.created_by?.name || '—'}
								</p>
								<p class="text-muted-foreground mt-1 text-xs">
									{displayWorkflowName(i)} · {i.occupancy === 'vacant' ? 'Vacant' : 'Occupied'}
								</p>
								{#if i.notes}
									<p class="text-muted-foreground mt-1 text-xs">{i.notes}</p>
								{/if}

								<div class="mt-3 flex flex-wrap items-center gap-2">
									{#if !i.archived}
										<Button href="/dashboard/inspections/{i.id}" variant="outline" size="sm">Edit</Button>
									{/if}
									{#if i.archived}
										<form method="POST" action="?/restoreInspection" use:enhance>
											<input type="hidden" name="id" value={i.id} />
											<Button type="submit" variant="outline" size="sm">Restore</Button>
										</form>
									{:else if canDeleteInspection(i)}
										<label class="flex items-center gap-2 text-xs text-muted-foreground">
											<input
												type="checkbox"
												checked={!!selectedIds[i.id]}
												onchange={(event) => {
													selectedIds[i.id] = (event.currentTarget as HTMLInputElement).checked;
												}}
											/>
											Select
										</label>
										<form method="POST" action="?/deleteInspection" use:enhance>
											<input type="hidden" name="id" value={i.id} />
											<Button
												type="submit"
												variant="destructive"
												size="sm"
												onclick={(event) => {
													if (!confirmDeleteInspection(i)) event.preventDefault();
												}}
											>
												Delete
											</Button>
										</form>
									{:else}
										<form method="POST" action="?/archiveInspection" use:enhance>
											<input type="hidden" name="id" value={i.id} />
											<Button
												type="submit"
												variant="outline"
												size="sm"
												onclick={(event) => {
													if (!confirm(`Archive this inspection to preserve its history?`)) event.preventDefault();
												}}
											>
												Archive
											</Button>
										</form>
										{#if archiveRequiredReason(i)}
											<p class="text-muted-foreground text-xs">{archiveRequiredReason(i)}</p>
										{/if}
									{/if}
								</div>
							</div>
						</li>
					{/each}
				</ul>

				<div class="hidden sm:block">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead class="w-10 text-center">Select</TableHead>
								<TableHead>Tenant(s)</TableHead>
								<TableHead>Property / Unit</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Inspection date</TableHead>
								<TableHead>Created by</TableHead>
								<TableHead>Workflow</TableHead>
								<TableHead>Notes</TableHead>
								<TableHead class="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each data.inspections as i (i.id)}
								<TableRow>
									<TableCell class="text-center">
										{#if !i.archived && canDeleteInspection(i)}
											<input
												type="checkbox"
												checked={!!selectedIds[i.id]}
												onchange={(event) => {
													selectedIds[i.id] = (event.currentTarget as HTMLInputElement).checked;
												}}
											/>
										{/if}
									</TableCell>
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
										<StatusBadge status={workflowStatus(i.stage)} />
									</TableCell>
									<TableCell class="text-muted-foreground max-w-40 truncate">{i.notes}</TableCell>
									<TableCell class="text-right">
										<div class="flex flex-wrap justify-end gap-2">
											{#if i.archived}
												<form method="POST" action="?/restoreInspection" use:enhance>
													<input type="hidden" name="id" value={i.id} />
													<Button type="submit" variant="outline" size="sm">Restore</Button>
												</form>
											{:else if canDeleteInspection(i)}
												<form method="POST" action="?/deleteInspection" use:enhance>
													<input type="hidden" name="id" value={i.id} />
													<Button
														type="submit"
														variant="destructive"
														size="sm"
														onclick={(event) => {
															if (!confirmDeleteInspection(i)) event.preventDefault();
														}}
													>
														Delete
													</Button>
												</form>
											{:else}
												<form method="POST" action="?/archiveInspection" use:enhance>
													<input type="hidden" name="id" value={i.id} />
													<Button
														type="submit"
														variant="outline"
														size="sm"
														onclick={(event) => {
															if (!confirm(`Archive this inspection to preserve its history?`)) event.preventDefault();
														}}
													>
														Archive
													</Button>
												</form>
											{/if}
											<Button href="/dashboard/inspections/{i.id}/record" variant="outline" size="sm">
												Open
											</Button>
										</div>
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
