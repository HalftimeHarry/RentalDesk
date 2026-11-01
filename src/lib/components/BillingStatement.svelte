<script lang="ts">
	import { enhance } from '$app/forms';
	import { billStatus, depositCharges, groupChargesByMonth, monthLabel } from '$lib/billing';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { formatLaDateTime, publishWindow } from '$lib/schedule';
	import { formatDate, formatMoney } from '$lib/format';
	import type { Charge, Payment } from '$lib/types';
	import { CalendarDays, FileText, HandCoins, Printer, Receipt, ShieldCheck } from '@lucide/svelte';

	let {
		charges,
		payments,
		billDocs = {},
		canManage = false,
		leaseId = '',
		form = null,
		printHref,
		onMonthPay,
		monthPayHref
	}: {
		charges: Charge[];
		payments: Payment[];
		billDocs?: Record<string, { url: string; title?: string }>;
		canManage?: boolean;
		leaseId?: string;
		form?: { section?: string; message?: string } | null;
		printHref?: (month: string) => string;
		onMonthPay?: (month: string) => void;
		/** When provided, "Record monthly payment" navigates to a dedicated page
		 * instead of invoking the onMonthPay dialog callback. */
		monthPayHref?: (month: string) => string;
	} = $props();

	const statements = $derived(
		[...groupChargesByMonth(charges, payments)].sort((a, b) => b.month.localeCompare(a.month))
	);
	const deposits = $derived(depositCharges(charges));
	let statementDialogOpen = $state(false);
	let statementDialogMonth = $state('');
	const activeStatement = $derived(
		statementDialogMonth ? statements.find((s) => s.month === statementDialogMonth) ?? null : null
	);
	$effect(() => {
		if (!statementDialogOpen) statementDialogMonth = '';
	});
	function openStatementDialog(month: string) {
		statementDialogMonth = month;
		statementDialogOpen = true;
	}

	// Draft bills: draft charges grouped by billing month (deposits excluded —
	// they publish individually from the charges list).
	const draftMonths = $derived.by(() => {
		const map = new Map<string, Charge[]>();
		for (const c of charges) {
			if (c.status !== 'draft' || c.type === 'deposit' || !c.period) continue;
			const list = map.get(c.period) ?? [];
			list.push(c);
			map.set(c.period, list);
		}
		return [...map.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([month, list]) => ({
				month,
				label: monthLabel(month),
				charges: list,
				totalCents: list.reduce((s, c) => s + c.amount_cents, 0),
				publishAt: list.find((c) => c.publish_at)?.publish_at || ''
			}));
	});
	const statementMonths = $derived(new Set(statements.map((s) => s.month)));

	const typeLabels: Record<string, string> = {
		rent: 'Rent',
		deposit: 'Deposit',
		late_fee: 'Late fee',
		other: 'Utility'
	};
	const statusLabels: Record<string, string> = {
		draft: 'Draft',
		unpaid: 'Unpaid',
		partially_paid: 'Partially paid',
		paid: 'Paid'
	};

	function paidFor(id: string): number {
		return payments.filter((p) => p.charge === id).reduce((s, p) => s + p.amount_cents, 0);
	}
	const methodLabels: Record<string, string> = {
		zelle: 'Zelle',
		cash: 'Cash',
		check: 'Check',
		venmo: 'Venmo',
		bank_transfer: 'Bank transfer',
		other: 'Other'
	};
</script>

{#snippet scheduleControls(month: string, publishAt: string)}
	{#if canManage}
		<div class="flex flex-col gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-3 dark:bg-transparent">
			{#if form?.section === `sched-${month}`}
				<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
			{/if}
			{#if publishAt}
				<p class="text-sm">
					Scheduled to publish <strong>{formatLaDateTime(publishAt)}</strong>.
				</p>
				<div class="flex flex-wrap gap-2">
					<form method="POST" action="?/cancelScheduleMonth" use:enhance>
						<input type="hidden" name="lease" value={leaseId} />
						<input type="hidden" name="month" value={month} />
						<Button type="submit" variant="outline" size="sm" class="min-h-12">
							Cancel scheduled publication
						</Button>
					</form>
					<form method="POST" action="?/publishMonth" use:enhance>
						<input type="hidden" name="lease" value={leaseId} />
						<input type="hidden" name="month" value={month} />
						<Button type="submit" size="sm" class="min-h-12">Publish now</Button>
					</form>
				</div>
			{:else}
				<form method="POST" action="?/scheduleMonth" use:enhance class="flex flex-wrap items-end gap-2">
					<input type="hidden" name="lease" value={leaseId} />
					<input type="hidden" name="month" value={month} />
					<label class="flex flex-col gap-1 text-xs">
						Publish at (Pacific; {publishWindow(month).label})
						<Input
							type="datetime-local"
							name="publish_at"
							min={publishWindow(month).startWall}
							max={publishWindow(month).endWall}
							required
							class="w-56"
						/>
					</label>
					<Button type="submit" variant="outline" size="sm" class="min-h-12">
						Schedule publication
					</Button>
				</form>
				<form method="POST" action="?/publishMonth" use:enhance>
					<input type="hidden" name="lease" value={leaseId} />
					<input type="hidden" name="month" value={month} />
					<Button type="submit" size="sm" class="min-h-12">Publish now</Button>
				</form>
			{/if}
		</div>
	{/if}
{/snippet}

{#if statements.length === 0 && deposits.length === 0 && draftMonths.length === 0}
	<Card>
		<CardContent class="text-muted-foreground py-8 text-center text-sm">
			No published charges yet — monthly statements appear here.
		</CardContent>
	</Card>
{/if}

{#if statements.length > 0}
	<Card>
		<CardHeader class="pb-0">
			<div class="flex items-center justify-between gap-2">
				<CardTitle class="flex items-center gap-2">
					<CalendarDays class="text-ocean size-5" /> Monthly statements
				</CardTitle>
			</div>
		</CardHeader>
		<CardContent class="p-0 sm:p-0">
			<div class="overflow-x-auto">
				<table class="min-w-full text-left text-sm">
					<thead class="bg-muted/60 text-muted-foreground text-xs uppercase tracking-wide">
						<tr>
							<th class="px-3 py-2.5 font-medium">Month</th>
							<th class="px-3 py-2.5 font-medium">Charged</th>
							<th class="px-3 py-2.5 font-medium">Paid</th>
							<th class="px-3 py-2.5 font-medium">Remaining</th>
							<th class="px-3 py-2.5 font-medium text-right">Action</th>
						</tr>
					</thead>
					<tbody>
						{#each statements as st (st.month)}
							<tr class="border-t align-top">
								<td class="px-3 py-3">
									<button
										type="button"
										class="text-left font-medium text-navy underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/60 focus-visible:ring-offset-2"
										aria-haspopup="dialog"
										aria-expanded={statementDialogOpen && statementDialogMonth === st.month}
										onclick={() => openStatementDialog(st.month)}
									>
										{st.label}
									</button>
									{#if canManage && st.remainingCents > 0}
										<div class="mt-1 text-[11px] text-muted-foreground">
											{formatMoney(st.remainingCents)} still due
										</div>
									{/if}
								</td>
								<td class="px-3 py-3 tabular-nums">{formatMoney(st.chargedCents)}</td>
								<td class="px-3 py-3 tabular-nums">{formatMoney(st.paidCents)}</td>
								<td class="px-3 py-3 tabular-nums">{formatMoney(st.remainingCents)}</td>
								<td class="px-3 py-3 text-right">
									<div class="flex flex-col items-stretch gap-2 sm:items-end">
										{#if printHref}
											<Button href={printHref(st.month)} target="_blank" variant="outline" size="sm" class="min-h-10 whitespace-nowrap">
												<FileText class="size-4" /> Download statement
											</Button>
										{/if}
										{#if canManage && st.remainingCents > 0}
											{#if monthPayHref}
												<Button href={monthPayHref(st.month)} variant="outline" class="min-h-10 border-orange-200 bg-orange-100 text-orange-900 shadow-sm hover:bg-orange-200 whitespace-nowrap">
													<Receipt class="size-4" /> Record payment
												</Button>
											{:else}
												<Button variant="outline" class="min-h-10 border-orange-200 bg-orange-100 text-orange-900 shadow-sm hover:bg-orange-200 whitespace-nowrap" onclick={() => onMonthPay?.(st.month)}>
													<Receipt class="size-4" /> Record payment
												</Button>
											{/if}
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</CardContent>
	</Card>
{/if}

<Dialog.Root bind:open={statementDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="bg-slate-950/60" />
		<Dialog.Content class="max-h-[85dvh] w-[min(92vw,42rem)] overflow-y-auto rounded-xl border bg-white p-0 text-slate-900 shadow-lg dark:bg-slate-900 dark:text-slate-100">
			{#if activeStatement}
				<div class="p-4 sm:p-6">
					<Dialog.Header class="mb-4 text-left">
						<Dialog.Title class="flex items-center gap-2 text-lg font-semibold">
							<FileText class="text-ocean size-5" /> {activeStatement.label} statement
						</Dialog.Title>
						<Dialog.Description class="mt-1 text-sm text-muted-foreground">
							Preview of the charges, payments, and totals for this billing month.
						</Dialog.Description>
					</Dialog.Header>

					<div class="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
						<div class="rounded-md border bg-slate-50 p-3 dark:bg-slate-800/60">
							<p class="text-muted-foreground text-[11px] uppercase tracking-wide">Charged</p>
							<p class="mt-1 font-semibold tabular-nums">{formatMoney(activeStatement.chargedCents)}</p>
						</div>
						<div class="rounded-md border bg-slate-50 p-3 dark:bg-slate-800/60">
							<p class="text-muted-foreground text-[11px] uppercase tracking-wide">Paid</p>
							<p class="mt-1 font-semibold tabular-nums">{formatMoney(activeStatement.paidCents)}</p>
						</div>
						<div class="rounded-md border bg-slate-50 p-3 dark:bg-slate-800/60 sm:col-span-1">
							<p class="text-muted-foreground text-[11px] uppercase tracking-wide">Remaining</p>
							<p class="mt-1 font-semibold tabular-nums">{formatMoney(activeStatement.remainingCents)}</p>
						</div>
					</div>

					{#if activeStatement.charges.length > 0}
						<div class="overflow-x-auto rounded-md border">
							<table class="min-w-full text-left text-sm">
								<thead class="bg-muted/60 text-muted-foreground text-xs uppercase tracking-wide">
									<tr>
										<th class="px-3 py-2 font-medium">Charge</th>
										<th class="px-3 py-2 font-medium">Due</th>
										<th class="px-3 py-2 font-medium text-right">Amount</th>
										<th class="px-3 py-2 font-medium text-right">Paid</th>
										<th class="px-3 py-2 font-medium text-right">Left</th>
									</tr>
								</thead>
								<tbody>
									{#each activeStatement.charges as c (c.id)}
										{@const paid = paidFor(c.id)}
										<tr class="border-t align-top">
											<td class="px-3 py-2">{c.description}</td>
											<td class="px-3 py-2 whitespace-nowrap">{c.due_date ? formatDate(c.due_date) : '—'}</td>
											<td class="px-3 py-2 text-right tabular-nums">{formatMoney(c.amount_cents)}</td>
											<td class="px-3 py-2 text-right tabular-nums">{formatMoney(paid)}</td>
											<td class="px-3 py-2 text-right tabular-nums">{formatMoney(Math.max(0, c.amount_cents - paid))}</td>
										</tr>
									{/each}
									<tr class="border-t bg-slate-50 font-medium dark:bg-slate-800/60">
										<td class="px-3 py-2" colspan="2">Statement total</td>
										<td class="px-3 py-2 text-right tabular-nums">{formatMoney(activeStatement.chargedCents)}</td>
										<td class="px-3 py-2 text-right tabular-nums">{formatMoney(activeStatement.paidCents)}</td>
										<td class="px-3 py-2 text-right tabular-nums">{formatMoney(activeStatement.remainingCents)}</td>
									</tr>
								</tbody>
							</table>
						</div>
					{/if}

					{#if activeStatement.payments.length > 0}
						<section class="mt-4">
							<h3 class="mb-2 text-sm font-semibold">Payments applied</h3>
							<ul class="space-y-2 text-sm">
								{#each activeStatement.payments as p (p.id)}
									<li class="rounded-md border px-3 py-2">
										<div class="flex items-center justify-between gap-2">
											<span>{p.date ? formatDate(p.date) : '—'}</span>
											<strong class="tabular-nums">{formatMoney(p.amount_cents)}</strong>
										</div>
										<div class="text-muted-foreground mt-1 text-xs">
											{p.method ? (methodLabels[p.method] ?? p.method) : '—'}
											{#if p.reference} · ref {p.reference}{/if}
										</div>
									</li>
								{/each}
							</ul>
						</section>
					{:else}
						<p class="text-muted-foreground mt-4 text-sm">No payments were recorded for this month.</p>
					{/if}

					<Dialog.Footer class="mt-6 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						{#if printHref}
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="min-h-10"
								onclick={() => {
									const url = printHref(activeStatement.month);
									window.open(url, '_blank', 'noopener,noreferrer');
								}}
							>
								<Printer class="size-4" /> Print
							</Button>
						{/if}
						{#if printHref}
							<Button href={printHref(activeStatement.month)} target="_blank" variant="outline" size="sm" class="min-h-10">
								<FileText class="size-4" /> Download PDF
							</Button>
						{/if}
						<Dialog.Close class="min-h-10 rounded-md border px-4 text-sm font-medium">Close</Dialog.Close>
					</Dialog.Footer>
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

	{#each draftMonths.filter((dm) => !statementMonths.has(dm.month)) as dm (dm.month)}
		<Card class="border-amber-300">
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<CalendarDays class="text-gold size-5" /> {dm.label} bill
					<span class="rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
						Draft — management only
					</span>
				</CardTitle>
				<CardDescription>
					{dm.charges.length} item{dm.charges.length === 1 ? '' : 's'} · draft total{' '}
					{formatMoney(dm.totalCents)} · nothing visible to the tenant until published
				</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-3">
				<ul class="divide-y rounded-md border text-sm">
					{#each dm.charges as d (d.id)}
						<li class="flex items-center justify-between gap-2 p-3">
							<span>{d.description}</span>
							<span class="font-medium">{formatMoney(d.amount_cents)}</span>
						</li>
					{/each}
				</ul>
				{@render scheduleControls(dm.month, dm.publishAt)}
			</CardContent>
		</Card>
	{/each}

{#if deposits.length > 0}
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<ShieldCheck class="text-ocean size-5" /> Security deposit — itemized separately
			</CardTitle>
			<CardDescription>Not part of any monthly rent statement.</CardDescription>
		</CardHeader>
		<CardContent>
			<ul class="divide-y rounded-md border text-sm">
				{#each deposits as c (c.id)}
					{@const paid = paidFor(c.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 p-3">
						<div>
							<p class="font-medium">{c.description}</p>
							<p class="text-muted-foreground text-xs">
								Due {formatDate(c.due_date)} · {statusLabels[billStatus(c, paid)]} · paid{' '}
								{formatMoney(paid)} of {formatMoney(c.amount_cents)}
							</p>
						</div>
						<span class="font-medium">
							Remaining {formatMoney(Math.max(0, c.amount_cents - paid))}
						</span>
					</li>
				{/each}
			</ul>
		</CardContent>
	</Card>
{/if}
