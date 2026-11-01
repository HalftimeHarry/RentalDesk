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

	const statements = $derived(groupChargesByMonth(charges, payments));
	const deposits = $derived(depositCharges(charges));

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

{#each statements as st (st.month)}
	<Card>
		<CardHeader>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle class="flex items-center gap-2">
					<CalendarDays class="text-ocean size-5" /> {st.label} statement
				</CardTitle>
				<div class="flex flex-wrap gap-2">
					{#if printHref}
						<Button href={printHref(st.month)} target="_blank" variant="outline" size="sm">
							<Printer class="size-4" /> Print / PDF
						</Button>
					{/if}
					{#if canManage && st.remainingCents > 0}
						<!-- Styled to match the dashboard's "Manage bills" button. -->
						{#if monthPayHref}
							<Button
								href={monthPayHref(st.month)}
								variant="outline"
								class="min-h-12 w-full border-orange-200 bg-orange-100 text-orange-900 shadow-sm hover:bg-orange-200 sm:w-auto"
							>
								<Receipt class="size-4" /> Record monthly payment
							</Button>
						{:else}
							<Button
								variant="outline"
								class="min-h-12 w-full border-orange-200 bg-orange-100 text-orange-900 shadow-sm hover:bg-orange-200 sm:w-auto"
								onclick={() => onMonthPay?.(st.month)}
							>
								<Receipt class="size-4" /> Record monthly payment
							</Button>
						{/if}
					{/if}
				</div>
			</div>
			<CardDescription>
				Charged {formatMoney(st.chargedCents)} · paid {formatMoney(st.paidCents)} · remaining{' '}
				{formatMoney(st.remainingCents)}
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			<ul class="divide-y rounded-md border text-sm">
				{#each st.charges as c (c.id)}
					{@const paid = paidFor(c.id)}
					<li class="flex flex-col gap-1 p-3">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<p class="font-medium">
								<span class="bg-muted text-muted-foreground mr-1.5 inline-block rounded px-1.5 py-0.5 align-middle text-[11px]">
									{typeLabels[c.type] ?? c.type}
								</span>
								{c.description}
							</p>
							<span class="text-muted-foreground text-xs">
								{statusLabels[billStatus(c, paid)]}
							</span>
						</div>
						<div class="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
							<span>Due {formatDate(c.due_date)}</span>
							<span>Amount {formatMoney(c.amount_cents)}</span>
							<span>Paid {formatMoney(paid)}</span>
							<span>Remaining {formatMoney(Math.max(0, c.amount_cents - paid))}</span>
							{#if billDocs[c.id]}
								<a
									class="text-ocean flex items-center gap-1 underline-offset-4 hover:underline"
									href={billDocs[c.id].url}
									target="_blank"
									rel="noreferrer"
								>
									<FileText class="size-3" /> Bill attachment
								</a>
							{/if}
						</div>
					</li>
				{/each}
				<li class="bg-muted/50 flex items-center justify-between gap-2 p-3 text-sm font-medium">
					<span>Statement total</span>
					<span>
						{formatMoney(st.chargedCents)} · remaining {formatMoney(st.remainingCents)}
					</span>
				</li>
			</ul>
			{#if st.payments.length > 0}
				<p class="text-muted-foreground text-xs">
					Payments applied:{' '}
					{st.payments
						.map(
							(p) =>
								`${formatMoney(p.amount_cents)} ${p.date ? formatDate(p.date) : ''}${p.method ? ` (${methodLabels[p.method] ?? p.method})` : ''}`
						)
						.join(' · ')}
				</p>
			{/if}
			{@const dm = draftMonths.find((d) => d.month === st.month)}
			{#if dm}
				<div class="rounded-lg border border-dashed border-amber-300 p-3 text-sm">
					<p class="font-medium">
						<span class="rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
							Draft
						</span>
						{dm.charges.length} draft charge{dm.charges.length === 1 ? '' : 's'} ({formatMoney(dm.totalCents)})
						not visible to the tenant
					</p>
					<ul class="text-muted-foreground mt-1 text-xs">
						{#each dm.charges as d (d.id)}
							<li>{d.description} — {formatMoney(d.amount_cents)}</li>
						{/each}
					</ul>
				</div>
				{@render scheduleControls(dm.month, dm.publishAt)}
			{/if}
		</CardContent>
	</Card>
{/each}

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
