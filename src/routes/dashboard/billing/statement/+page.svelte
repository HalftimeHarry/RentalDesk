<script lang="ts">
	import type { PageData } from './$types';
	import { billStatus, monthLabel } from '$lib/billing';
	import { Button } from '$lib/components/ui/button';
	import { formatDate, formatMoney } from '$lib/format';
	import { ArrowLeft, Printer } from '@lucide/svelte';

	let { data }: { data: PageData } = $props();

	const statusLabels: Record<string, string> = {
		unpaid: 'Unpaid',
		partially_paid: 'Partially paid',
		paid: 'Paid'
	};
	const methodLabels: Record<string, string> = {
		zelle: 'Zelle',
		cash: 'Cash',
		check: 'Check',
		venmo: 'Venmo',
		bank_transfer: 'Bank transfer',
		other: 'Other'
	};

	function paidFor(chargeId: string): number {
		return data.payments
			.filter((p) => p.charge === chargeId)
			.reduce((s, p) => s + p.amount_cents, 0);
	}
</script>

<svelte:head>
	<title>Statement {monthLabel(data.month)} — RentalDesk</title>
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
	<div class="flex flex-wrap items-center gap-2 print:hidden">
		<Button
			href={data.user.role === 'tenant' ? '/dashboard/tenant' : '/dashboard/manage/billing'}
			variant="outline"
			size="sm"
		>
			<ArrowLeft class="size-4" /> Back
		</Button>
		<Button size="sm" class="min-h-12" onclick={() => window.print()}>
			<Printer class="size-4" /> Print / Save as PDF
		</Button>
	</div>

	<article class="bg-card text-card-foreground rounded-xl border p-6 shadow-lg print:border-0 print:p-0 print:shadow-none">
		<header class="mb-6 flex flex-wrap items-start justify-between gap-2 border-b pb-4">
			<div>
				<h1 class="text-xl font-bold tracking-tight">RentalDesk — Monthly statement</h1>
				<p class="text-muted-foreground text-sm">
					{data.lease.expand?.tenant?.name || 'Tenant'} · lease {formatDate(data.lease.start_date)} –{' '}
					{formatDate(data.lease.end_date)}
				</p>
			</div>
			<p class="text-lg font-semibold">{monthLabel(data.month)}</p>
		</header>

		{#if !data.statement}
			<p class="text-muted-foreground text-sm">No published charges for this billing month.</p>
		{:else}
			{@const st = data.statement}
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b text-left">
						<th class="py-2 pr-3 font-medium">Charge</th>
						<th class="py-2 pr-3 font-medium">Due</th>
						<th class="py-2 pr-3 font-medium">Status</th>
						<th class="py-2 pr-3 text-right font-medium">Amount</th>
						<th class="py-2 pr-3 text-right font-medium">Paid</th>
						<th class="py-2 text-right font-medium">Remaining</th>
					</tr>
				</thead>
				<tbody>
					{#each st.charges as c (c.id)}
						{@const paid = paidFor(c.id)}
						<tr class="border-b align-top">
							<td class="py-2 pr-3">{c.description}</td>
							<td class="py-2 pr-3 whitespace-nowrap">{formatDate(c.due_date)}</td>
							<td class="py-2 pr-3">{statusLabels[billStatus(c, paid)]}</td>
							<td class="py-2 pr-3 text-right">{formatMoney(c.amount_cents)}</td>
							<td class="py-2 pr-3 text-right">{formatMoney(paid)}</td>
							<td class="py-2 text-right">{formatMoney(Math.max(0, c.amount_cents - paid))}</td>
						</tr>
					{/each}
					<tr class="font-medium">
						<td class="py-2 pr-3" colspan="3">Statement total</td>
						<td class="py-2 pr-3 text-right">{formatMoney(st.chargedCents)}</td>
						<td class="py-2 pr-3 text-right">{formatMoney(st.paidCents)}</td>
						<td class="py-2 text-right">{formatMoney(st.remainingCents)}</td>
					</tr>
				</tbody>
			</table>

			{#if st.payments.length > 0}
				<section class="mt-4">
					<h2 class="mb-1 text-sm font-semibold">Payments applied this month</h2>
					<ul class="text-muted-foreground text-sm">
						{#each st.payments as p (p.id)}
							<li>
								{formatDate(p.date)} · {formatMoney(p.amount_cents)} ·{' '}
								{p.method ? (methodLabels[p.method] ?? p.method) : '—'}{#if p.reference} · ref {p.reference}{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}

		{#if data.deposits.length > 0}
			<section class="mt-6 border-t pt-4">
				<h2 class="mb-1 text-sm font-semibold">Security deposit — itemized separately</h2>
				<table class="w-full text-sm">
					<tbody>
						{#each data.deposits as c (c.id)}
							{@const paid = paidFor(c.id)}
							<tr class="border-b align-top">
								<td class="py-2 pr-3">{c.description}</td>
								<td class="py-2 pr-3">{statusLabels[billStatus(c, paid)]}</td>
								<td class="py-2 pr-3 text-right">{formatMoney(c.amount_cents)}</td>
								<td class="py-2 text-right">Remaining {formatMoney(Math.max(0, c.amount_cents - paid))}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="text-muted-foreground mt-1 text-xs">
					The deposit is tracked separately from rent and is not part of the monthly total.
				</p>
			</section>
		{/if}

		<footer class="text-muted-foreground mt-6 border-t pt-3 text-xs">
			Generated {formatDate(new Date().toISOString().slice(0, 10))} · RentalDesk
		</footer>
	</article>
</div>
