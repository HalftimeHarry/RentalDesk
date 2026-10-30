<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import {
		markLabel,
		STAGE_LABELS,
		type ChecklistItem,
		type InspectionStage
	} from '$lib/inspection';
	import { docUrl, isImageFile, signedCopyUrl } from '$lib/files';
	import { formatDate, formatMoney } from '$lib/format';
	import {
		ArrowLeft,
		Download,
		FileText,
		Flag,
		PenLine,
		Printer,
		Receipt
	} from '@lucide/svelte';

	let { data }: { data: PageData } = $props();
	let inspection = $derived(data.inspection);

	const typeLabels: Record<string, string> = {
		move_in: 'Move-in',
		move_out: 'Move-out',
		periodic: 'Periodic'
	};
	const stageStatus: Record<string, string> = {
		draft: 'draft',
		in_progress: 'in_progress',
		tenant_reviewed: 'under_review',
		completed: 'resolved',
		signed: 'signed'
	};

	let sections = $derived.by(() => {
		const out: { name: string; items: ChecklistItem[] }[] = [];
		for (const item of data.checklist) {
			let s = out.find((x) => x.name === item.section);
			if (!s) {
				s = { name: item.section, items: [] };
				out.push(s);
			}
			s.items.push(item);
		}
		return out;
	});

	function hasMark(item: ChecklistItem, side: 'moveIn' | 'moveOut'): boolean {
		return item[side].condition !== 'not_reviewed' || item[side].comment !== '';
	}
</script>

<svelte:head>
	<title>{inspection.tenant_names || 'Inspection'} — Inspection record — RentalDesk</title>
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
	<div class="flex flex-wrap items-center gap-2">
		<Button href="/dashboard/inspections" variant="outline" size="sm">
			<ArrowLeft class="size-4" /> History
		</Button>
		<div class="ml-auto flex flex-wrap gap-2">
			<Button href="/dashboard/inspections/{inspection.id}/print" variant="outline" class="min-h-12">
				<Printer class="size-4" /> Print
			</Button>
			<Button href="/dashboard/inspections/{inspection.id}/print?pdf=1" variant="outline" class="min-h-12">
				<Download class="size-4" /> Download PDF
			</Button>
			<Button href="/dashboard/inspections/{inspection.id}" class="min-h-12">
				<PenLine class="size-4" /> Edit inspection
			</Button>
		</div>
	</div>

	<!-- Header: tenant name leads -->
	<Card class="bg-card/95">
		<CardHeader>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle class="text-2xl">{inspection.tenant_names || 'Vacant / no tenant'}</CardTitle>
				<StatusBadge status={stageStatus[inspection.stage] ?? 'draft'} />
			</div>
			<CardDescription>
				{inspection.address} · Unit {inspection.unit} · {typeLabels[inspection.type]} inspection
			</CardDescription>
		</CardHeader>
		<CardContent>
			<dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
				<div><dt class="text-muted-foreground inline">Inspection date: </dt><dd class="inline font-medium">{formatDate(inspection.date)}</dd></div>
				<div><dt class="text-muted-foreground inline">Workflow stage: </dt><dd class="inline font-medium">{STAGE_LABELS[(inspection.stage as InspectionStage) || 'draft']}</dd></div>
				<div><dt class="text-muted-foreground inline">Occupancy: </dt><dd class="inline font-medium">{inspection.occupancy === 'vacant' ? 'Vacant' : 'Occupied'}</dd></div>
				<div><dt class="text-muted-foreground inline">Created by: </dt><dd class="inline font-medium">{inspection.expand?.created_by?.name || '—'}</dd></div>
				<div><dt class="text-muted-foreground inline">Move-in date: </dt><dd class="inline font-medium">{formatDate(inspection.move_in_date)}</dd></div>
				<div><dt class="text-muted-foreground inline">Move-out date: </dt><dd class="inline font-medium">{inspection.move_out_date ? formatDate(inspection.move_out_date) : '—'}</dd></div>
				{#if data.linkedMoveIn}
					<div class="sm:col-span-2">
						<dt class="text-muted-foreground inline">Linked move-in record: </dt>
						<dd class="inline font-medium">
							<a class="text-ocean underline-offset-4 hover:underline" href="/dashboard/inspections/{data.linkedMoveIn.id}/record">
								{formatDate(data.linkedMoveIn.date)}
							</a>
						</dd>
					</div>
				{/if}
			</dl>
			{#if inspection.notes}
				<p class="mt-3 border-t pt-3 text-sm whitespace-pre-line">{inspection.notes}</p>
			{/if}
		</CardContent>
	</Card>

	<!-- Checklist review: every item, marks + comments inline -->
	<Card class="bg-card/95">
		<CardHeader>
			<CardTitle>Checklist review</CardTitle>
			<CardDescription>
				“—” means no mark was recorded. O = Other condition requiring explanation.
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-6">
			{#each sections as section (section.name)}
				<section>
					<h2 class="text-ocean mb-2 text-sm font-semibold">{section.name}</h2>
					<ul class="divide-y rounded-lg border text-sm">
						{#each section.items as item (item.item)}
							<li class="flex flex-col gap-1 p-3">
								<div class="flex items-baseline gap-2">
									<span class="font-medium">{item.item}</span>
									{#if inspection.type === 'move_out'}
										<span class="text-muted-foreground ml-auto text-xs whitespace-nowrap">
											in: {markLabel(item.moveIn.condition)} · out: {markLabel(item.moveOut.condition)}
										</span>
									{:else}
										<span class="text-muted-foreground ml-auto text-xs whitespace-nowrap">
											{markLabel(item.moveIn.condition)}
										</span>
									{/if}
								</div>
								{#if inspection.type === 'move_out'}
									{#if hasMark(item, 'moveIn') && item.moveIn.comment}
										<p class="text-xs"><span class="text-muted-foreground">Move-in</span> — <span class="text-red-700 dark:text-red-300">{item.moveIn.comment}</span></p>
									{/if}
									{#if hasMark(item, 'moveOut') && item.moveOut.comment}
										<p class="text-xs"><span class="text-muted-foreground">Move-out</span> — <span class="text-red-700 dark:text-red-300">{item.moveOut.comment}</span></p>
									{/if}
								{:else if item.moveIn.comment}
									<p class="text-xs text-red-700 dark:text-red-300">{item.moveIn.comment}</p>
								{/if}
								{#if item.flagged}
									<p class="text-coral flex items-center gap-1 text-xs">
										<Flag class="size-3" /> Flagged for follow-up
									</p>
								{/if}
								{#if item.moveIn.photos.length + item.moveOut.photos.length > 0}
									<div class="flex flex-wrap gap-2 pt-1">
										{#each [...item.moveIn.photos, ...item.moveOut.photos] as pid (pid)}
											{@const doc = data.documents.find((d) => d.id === pid)}
											{#if doc}
												<a href={docUrl(doc.id, doc.file)} target="_blank" rel="noreferrer">
													{#if isImageFile(doc.file)}
														<img
															src="{docUrl(doc.id, doc.file)}?thumb=100x100"
															alt={doc.title}
															class="size-12 rounded border object-cover"
														/>
													{:else}
														<span class="text-ocean flex items-center gap-1 text-xs underline-offset-4 hover:underline">
															<FileText class="size-3" />{doc.title}
														</span>
													{/if}
												</a>
											{/if}
										{/each}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</CardContent>
	</Card>

	{#if data.others.length > 0}
		<Card class="bg-card/95">
			<CardHeader>
				<CardTitle class="text-base">Exceptions (O items)</CardTitle>
			</CardHeader>
			<CardContent>
				<ul class="list-disc pl-5 text-sm">
					{#each data.others as o (o.section + o.item + o.side)}
						<li>
							<span class="text-navy">{o.section} → {o.item}</span>
							<span class="text-muted-foreground"> — O — </span>
							<span class="text-red-700 dark:text-red-300">{o.comment || 'no comment'}</span>
							<span class="text-muted-foreground"> ({o.side})</span>
						</li>
					{/each}
				</ul>
			</CardContent>
		</Card>
	{/if}

	{#if data.deductions.length > 0}
		<Card class="bg-card/95">
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-base">
					<Receipt class="text-coral size-4" /> Proposed deductions (not applied to the ledger)
				</CardTitle>
			</CardHeader>
			<CardContent>
				<ul class="list-disc pl-5 text-sm">
					{#each data.deductions as d (d.description)}
						<li>{d.description} — {formatMoney(d.amount_cents)}</li>
					{/each}
				</ul>
			</CardContent>
		</Card>
	{/if}

	<!-- Private manager notes (staff-only page) -->
	{#if inspection.manager_notes}
		<Card class="border-coral/40 bg-card/95">
			<CardHeader>
				<CardTitle class="text-coral text-base">Private manager notes</CardTitle>
				<CardDescription>Never shown on tenant-facing reports.</CardDescription>
			</CardHeader>
			<CardContent class="text-sm whitespace-pre-line">{inspection.manager_notes}</CardContent>
		</Card>
	{/if}

	{#if inspection.signed_copy}
		<Card class="bg-card/95">
			<CardHeader>
				<CardTitle class="text-base">Signed copy</CardTitle>
			</CardHeader>
			<CardContent>
				<a
					class="text-ocean text-sm underline-offset-4 hover:underline"
					href={signedCopyUrl(inspection)}
					target="_blank"
					rel="noreferrer"
				>
					View signed copy
				</a>
			</CardContent>
		</Card>
	{/if}
</div>
