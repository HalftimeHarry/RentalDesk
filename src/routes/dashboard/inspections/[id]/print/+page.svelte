<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { CONDITION_LABELS, markLabel, STAGE_LABELS, type InspectionStage } from '$lib/inspection';
	import { formatDate, formatMoney } from '$lib/format';
	import { ArrowLeft, Download, Printer } from '@lucide/svelte';

	let { data }: { data: PageData } = $props();
	let inspection = $derived(data.inspection);

	function formatDateTime(iso: string): string {
		return iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
	}
	// Captured signatures embed in this record's own side; the other side keeps
	// blank handwritten lines for its own later signing.
	const sigSide = $derived(inspection.type === 'move_out' ? 'Move-out' : 'Move-in');
	const hasSigs = $derived(!!(data.sigLandlordUrl || data.sigTenantUrl));

	const typeLabels: Record<string, string> = {
		move_in: 'Move-in',
		move_out: 'Move-out',
		periodic: 'Periodic'
	};

	// Group the flat checklist back into its nine sections.
	let sections = $derived.by(() => {
		const out: { name: string; items: typeof data.checklist }[] = [];
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

	onMount(() => {
		// "Download PDF" opens the print dialog — choose “Save as PDF”.
		if (data.pdfMode) window.print();
	});
</script>

<svelte:head>
	<title>Property Inspection Report — {inspection.address} Unit {inspection.unit}</title>
</svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-6">
	<!-- Screen toolbar (never printed) -->
	<div class="no-print bg-card/95 sticky top-16 z-30 flex flex-wrap items-center gap-2 rounded-xl border p-3 shadow-sm print:hidden">
		<Button
			href={data.isStaff ? `/dashboard/inspections/${inspection.id}` : '/dashboard/tenant'}
			variant="outline"
			size="sm"
		>
			<ArrowLeft class="size-4" /> {data.isStaff ? 'Back to inspection' : 'Back to dashboard'}
		</Button>
		<div class="ml-auto flex gap-2">
			<Button onclick={() => window.print()} variant="outline" class="min-h-12">
				<Printer class="size-4" /> Print
			</Button>
			<Button onclick={() => window.print()} class="min-h-12" title="Choose “Save as PDF” in the print dialog">
				<Download class="size-4" /> Download PDF
			</Button>
		</div>
	</div>
	<p class="no-print text-muted-foreground text-xs print:hidden">
		Generated from the saved inspection record. “Download PDF” opens the print dialog — choose
		“Save as PDF”.
	</p>

	<!-- Report -->
	<article class="rounded-xl border bg-white p-6 text-[#16324F] shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none">
		<header class="mb-6 border-b-2 border-[#075985] pb-4">
			<h1 class="text-2xl font-bold tracking-tight">Property Inspection Report</h1>
			<div class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
				<p><span class="font-semibold">Property:</span> {inspection.address}</p>
				<p><span class="font-semibold">Unit:</span> {inspection.unit}</p>
				<p><span class="font-semibold">Tenant(s):</span> {inspection.tenant_names || '—'}</p>
				<p>
					<span class="font-semibold">Occupancy:</span>
					{inspection.occupancy === 'vacant' ? 'Vacant' : 'Occupied'}
				</p>
				<p><span class="font-semibold">Move-in date:</span> {formatDate(inspection.move_in_date)}</p>
				<p>
					<span class="font-semibold">Move-out date:</span>
					{inspection.move_out_date ? formatDate(inspection.move_out_date) : '—'}
				</p>
				<p><span class="font-semibold">Inspection date:</span> {formatDate(inspection.date)}</p>
				<p><span class="font-semibold">Inspection type:</span> {typeLabels[inspection.type]}</p>
				<p>
					<span class="font-semibold">Workflow stage:</span>
					{STAGE_LABELS[(inspection.stage as InspectionStage) || 'draft']}
				</p>
				<p>
					<span class="font-semibold">Prepared by:</span>
					{inspection.expand?.created_by?.name || 'Management'}
				</p>
				{#if data.linkedDate}
					<p>
						<span class="font-semibold">Linked move-in inspection:</span>
						{formatDate(data.linkedDate)}
					</p>
				{/if}
			</div>
			{#if inspection.notes}
				<p class="mt-3 text-sm whitespace-pre-line">{inspection.notes}</p>
			{/if}
		</header>

		<p class="mb-4 text-xs">
			Marks: <span class="font-semibold">O = Other condition requiring explanation (see comment)</span>{' '}
			· N/A = not applicable · — = no mark recorded · OK = acceptable (legacy marks).
		</p>

		{#each sections as section (section.name)}
			<section class="mb-5 [break-inside:avoid-page]">
				<h2
					class="mb-1 border-b border-[#075985]/40 text-base font-semibold text-[#075985] [break-after:avoid]"
				>
					{section.name}
				</h2>
				<table class="w-full border-collapse text-xs">
					<thead>
						<tr class="border-b border-[#16324F]/30 text-left">
							<th class="w-[24%] py-1 pr-2">Item</th>
							<th class="w-[9%] py-1 pr-2">Move-in</th>
							<th class="w-[27%] py-1 pr-2">Move-in comment</th>
							<th class="w-[9%] py-1 pr-2">Move-out</th>
							<th class="w-[31%] py-1">Move-out comment</th>
						</tr>
					</thead>
					<tbody>
						{#each section.items as item (item.item)}
							<tr class="border-b border-[#16324F]/10 align-top [break-inside:avoid]">
								<td class="py-1.5 pr-2 font-medium">{item.item}</td>
								<td class="py-1.5 pr-2">{markLabel(item.moveIn.condition)}</td>
								<td class="py-1.5 pr-2">
									{item.moveIn.comment}
									{#if item.moveIn.photos.length > 0}
										<span class="mt-0.5 flex flex-wrap gap-1">
											{#each item.moveIn.photos as pid (pid)}
												{#if data.photoUrl[pid]}
													<img
														src={data.photoUrl[pid]}
														alt=""
														class="size-10 rounded border object-cover"
													/>
												{/if}
											{/each}
										</span>
									{/if}
								</td>
								<td class="py-1.5 pr-2">{markLabel(item.moveOut.condition)}</td>
								<td class="py-1.5">
									{item.moveOut.comment}
									{#if item.moveOut.photos.length > 0}
										<span class="mt-0.5 flex flex-wrap gap-1">
											{#each item.moveOut.photos as pid (pid)}
												{#if data.photoUrl[pid]}
													<img
														src={data.photoUrl[pid]}
														alt=""
														class="size-10 rounded border object-cover"
													/>
												{/if}
											{/each}
										</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/each}

		{#if data.others.length > 0}
			<section class="mb-5 [break-inside:avoid-page]">
				<h2
					class="mb-1 border-b border-[#075985]/40 text-base font-semibold text-[#075985] [break-after:avoid]"
				>
					Summary of O (Other) items
				</h2>
				<ul class="list-disc pl-5 text-xs">
					{#each data.others as o (o.section + o.item + o.side)}
						<li>
							<span class="font-medium">{o.section} → {o.item}</span> ({o.side}) — {o.comment ||
								'no comment'}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.flagged.length > 0 || data.deductions.length > 0}
			<section class="mb-5 [break-inside:avoid-page]">
				<h2
					class="mb-1 border-b border-[#075985]/40 text-base font-semibold text-[#075985] [break-after:avoid]"
				>
					Follow-ups &amp; deposit documentation
				</h2>
				{#if data.flagged.length > 0}
					<p class="mb-1 text-xs font-semibold">Items flagged for follow-up:</p>
					<ul class="mb-3 list-disc pl-5 text-xs">
						{#each data.flagged as f (f.section + f.item)}
							<li>{f.section} → {f.item}</li>
						{/each}
					</ul>
				{/if}
				{#if data.deductions.length > 0}
					<table class="mb-2 w-full border-collapse text-xs">
						<thead>
							<tr class="border-b border-[#16324F]/30 text-left">
								<th class="py-1 pr-2">Proposed deduction</th>
								<th class="w-24 py-1 text-right">Amount</th>
							</tr>
						</thead>
						<tbody>
							{#each data.deductions as d (d.description)}
								<tr class="border-b border-[#16324F]/10 [break-inside:avoid]">
									<td class="py-1.5 pr-2">{d.description}</td>
									<td class="py-1.5 text-right">{formatMoney(d.amount_cents)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
				<p class="text-[#16324F]/70 text-xs italic">
					Proposed deductions are documented separately from recorded damage and are never
					applied to charges automatically.
				</p>
			</section>
		{/if}

		{#if data.isStaff && inspection.manager_notes}
			<section class="mb-5 rounded border border-dashed border-[#F97360] p-3 text-xs [break-inside:avoid] print:hidden">
				<h2 class="mb-1 font-semibold text-[#F97360]">Private manager notes</h2>
				<p class="whitespace-pre-line">{inspection.manager_notes}</p>
			</section>
		{/if}

		<!-- Signature sections: captured signatures (with names, dates, and device
		     context) embed in this record's own section; the other side keeps blank
		     handwritten lines for its own signing. -->
		<section class="mt-8 grid gap-8 sm:grid-cols-2 [break-inside:avoid-page]">
			{#each ['Move-in', 'Move-out'] as side (side)}
				{@const active = side === sigSide && hasSigs}
				<div>
					<h2 class="mb-4 text-sm font-semibold">{side} signatures</h2>
					<div class="mb-6">
						{#if active && data.sigLandlordUrl}
							<img
								src={data.sigLandlordUrl}
								alt="Manager signature"
								class="h-12 w-auto object-contain"
							/>
							<p class="mt-1 text-xs">
								Manager — {inspection.sig_landlord_name} · {formatDateTime(inspection.sig_landlord_at)}
							</p>
							<p class="mt-0.5 text-[0.65rem] leading-snug text-gray-500">
								{inspection.sig_landlord_meta}
							</p>
						{:else}
							<div class="h-12 border-b-2 border-[#16324F]"></div>
							<p class="mt-1 text-xs">Manager signature</p>
							<div class="mt-3 h-5 border-b border-[#16324F]/60"></div>
							<p class="mt-1 text-xs">Date</p>
						{/if}
					</div>
					<div>
						{#if active && data.sigTenantUrl}
							<img
								src={data.sigTenantUrl}
								alt="Tenant signature"
								class="h-12 w-auto object-contain"
							/>
							<p class="mt-1 text-xs">
								Tenant — {inspection.sig_tenant_name} · {formatDateTime(inspection.sig_tenant_at)}
							</p>
							<p class="mt-0.5 text-[0.65rem] leading-snug text-gray-500">
								{inspection.sig_tenant_meta}
							</p>
						{:else}
							<div class="h-12 border-b-2 border-[#16324F]"></div>
							<p class="mt-1 text-xs">Tenant signature</p>
							<div class="mt-3 h-5 border-b border-[#16324F]/60"></div>
							<p class="mt-1 text-xs">Date</p>
						{/if}
					</div>
				</div>
			{/each}
		</section>
	</article>
</div>
