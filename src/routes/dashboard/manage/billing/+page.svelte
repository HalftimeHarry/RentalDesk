<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Separator } from '$lib/components/ui/separator';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { computeRentCharge, daysInclusive, type RentComputation } from '$lib/billing';
	import { formatDate, formatMoney } from '$lib/format';
	import { cn } from '$lib/utils';
	import RecordPaymentDialog from '$lib/components/RecordPaymentDialog.svelte';
	import BillingStatement from '$lib/components/BillingStatement.svelte';
	import {
		ArrowLeft,
		Calculator,
		CalendarDays,
		CircleDollarSign,
		FileText,
		HandCoins,
		Hourglass,
		Receipt,
		ShieldCheck,
		Upload,
		Zap
	} from '@lucide/svelte';
	import type { Charge, Lease, Payment } from '$lib/types';
	import { billStatus } from '$lib/billing';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const typeLabels: Record<string, string> = {
		rent: 'Rent',
		deposit: 'Security deposit',
		late_fee: 'Late fee',
		other: 'Other'
	};

	function leaseLabel(l: Lease | undefined): string {
		if (!l) return 'Select lease…';
		const who = l.expand?.tenant?.name || l.expand?.tenant?.email || 'Tenant';
		return `${who} · ${formatDate(l.start_date)} – ${formatDate(l.end_date)} · ${l.status}`;
	}

	// ---- composer state -------------------------------------------------------
	let kind = $state<'rent_full' | 'rent_partial' | 'utility_att' | 'utility_sdge' | 'deposit' | 'other'>('rent_full');
	let month = $state('');
	let amountOverride = $state('');
	let basis = $state<'30-day' | 'actual'>('30-day');
	let method = $state<'days' | 'range'>('days');
	let days = $state('1');
	let start = $state('');
	let end = $state('');
	let overrideOn = $state(false);
	let overrideAmount = $state('');
	let overrideReason = $state('');

	const kindLabels: Record<string, string> = {
		rent_full: 'Rent — full month',
		rent_partial: 'Rent — partial month (prorated)',
		deposit: 'Security deposit',
		utility_att: 'AT&T reimbursement',
		utility_sdge: 'SDG&E reimbursement',
		other: 'Other charge (credit check, fee, etc.)'
	};

	let defaultRent = $derived(
		(data.lease?.monthly_rent_cents || data.settings?.monthly_rent_cents || 0) / 100
	);

	// Live preview — the server recomputes authoritatively on save.
	let preview = $derived.by((): RentComputation | { error: string } | null => {
		if (kind !== 'rent_partial') return null;
		const monthly = Math.round((Number(amountOverride) || defaultRent) * 100);
		return computeRentCharge({
			monthlyRentCents: monthly,
			basis,
			mode: method,
			days: Number(days) || 0,
			start,
			end
		});
	});

	let rangeDays = $derived(method === 'range' && start && end ? daysInclusive(start, end) : 0);

	// ---- per-charge derived state ----------------------------------------------
	function paidFor(c: Charge): number {
		return data.payments.filter((p) => p.charge === c.id).reduce((s, p) => s + p.amount_cents, 0);
	}
	function statusOf(c: Charge) {
		return billStatus(c, paidFor(c));
	}
	function remainingOf(c: Charge) {
		return Math.max(0, c.amount_cents - paidFor(c));
	}
	function calcSummary(c: Charge): string {
		const calc = c.calc;
		if (!calc) return '';
		const monthly = formatMoney(calc.monthly_rate_cents);
		if (calc.basis === '30-day') {
			return `${monthly}/mo ÷ 30 days × ${calc.billable_days} day${calc.billable_days === 1 ? '' : 's'} = ${formatMoney(calc.amount_cents)}`;
		}
		if (calc.basis === 'actual') {
			return (
				`${monthly}/mo, actual calendar days: ` +
				calc.portions
					.map((p) => `${p.days}d in ${p.month} (${p.days_in_month}-day month)`)
					.join(' + ') +
				` = ${formatMoney(calc.amount_cents)}`
			);
		}
		return `${monthly}/mo · ${calc.billable_days} days`;
	}

	let paying = $state('');
	let payOpen = $state(false);
	let payCharge: Charge | null = $state(null);
	let payMonth: string | null = $state(null);

	const methodLabels: Record<string, string> = {
		zelle: 'Zelle',
		cash: 'Cash',
		check: 'Check',
		venmo: 'Venmo',
		bank_transfer: 'Bank transfer',
		other: 'Other'
	};
</script>

<svelte:head>
	<title>Billing — RentalDesk</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div class="flex flex-wrap items-center gap-2">
		<Button href="/dashboard/manage" variant="outline" size="sm">
			<ArrowLeft class="size-4" /> Management
		</Button>
		<h1 class="text-2xl font-bold tracking-tight text-white drop-shadow-sm">Billing</h1>
	</div>

	{#if data.leasesError}
		<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
			Could not load the lease list: {data.leasesError}
		</p>
	{/if}
	{#if data.leases.length > 1}
		<div class="flex flex-wrap items-center gap-2">
			<Label for="lease-picker" class="text-white/85 drop-shadow-sm">Lease</Label>
			<Select.Root
				type="single"
				value={data.lease?.id ?? ''}
				onValueChange={(v) => v && goto(`?lease=${v}`)}
			>
				<Select.Trigger id="lease-picker" class="bg-card min-h-12 w-full sm:w-[26rem]">
					{leaseLabel(data.leases.find((l) => l.id === data.lease?.id))}
				</Select.Trigger>
				<Select.Content>
					{#each data.leases as l (l.id)}
						<Select.Item value={l.id}>{leaseLabel(l)}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	{#if !data.lease}
		<Card>
			<CardContent class="py-8 text-center text-sm {data.leaseError ? 'text-destructive' : 'text-muted-foreground'}">
				{#if data.leaseError}
					Could not load the active lease: {data.leaseError}
				{:else}
					No active lease. Create one from the management dashboard first.
				{/if}
			</CardContent>
		</Card>
	{:else}
		<div>
			<p class="text-white/85 drop-shadow-sm">
				{data.lease.expand?.tenant?.name || 'Tenant'} · {formatDate(data.lease.start_date)} –{' '}
				{formatDate(data.lease.end_date)} · {formatMoney(data.lease.monthly_rent_cents)}/month
			</p>
		</div>

		<!-- Summary -->
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
			<Card>
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
						<CircleDollarSign class="text-turquoise size-4" /> Balance due (published)
					</CardDescription>
					<CardTitle class="text-2xl">{formatMoney(data.ledger.totalBalance)}</CardTitle>
				</CardHeader>
				<CardContent class="text-muted-foreground pt-0 text-xs">
					{#if data.ledger.depositBalance > 0}
						Includes {formatMoney(data.ledger.depositBalance)} unpaid deposit
					{:else if data.ledger.depositCharged > 0}
						Deposit fully received
					{:else}
						No deposit charged yet
					{/if}
				</CardContent>
			</Card>
			<Card>
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
						<ShieldCheck class="text-ocean size-4" /> Deposit required (lease)
					</CardDescription>
					<CardTitle class="text-2xl">{formatMoney(data.lease.deposit_cents)}</CardTitle>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
						<HandCoins class="text-turquoise size-4" /> Deposit received
					</CardDescription>
					<CardTitle class="text-2xl">{formatMoney(data.ledger.depositPaid)}</CardTitle>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
						<Hourglass class="text-coral size-4" /> Deposit remaining
					</CardDescription>
					<CardTitle class="text-2xl">
						{formatMoney(Math.max(0, data.lease.deposit_cents - data.ledger.depositPaid))}
					</CardTitle>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
						<Receipt class="text-coral size-4" /> Drafts (management-only)
					</CardDescription>
					<CardTitle class="text-2xl">
						{data.charges.filter((c) => c.status === 'draft').length}
					</CardTitle>
				</CardHeader>
				<CardContent class="text-muted-foreground pt-0 text-xs">
					draft total{' '}
					{formatMoney(
						data.charges
							.filter((c) => c.status === 'draft')
							.reduce((s, c) => s + c.amount_cents, 0)
					)}
				</CardContent>
			</Card>
		</div>

		{#if data.lease.deposit_cents > 0 && !data.charges.some((c) => c.type === 'deposit' && c.status === 'published')}
			<p class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
				<ShieldCheck class="mr-1 inline size-4 align-text-bottom" />
				Deposit not yet billed — the lease requires {formatMoney(data.lease.deposit_cents)}. Add it
				from the composer (Security deposit) when you're ready to bill it; nothing is created
				automatically.
			</p>
		{/if}

		<!-- New charge -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Calculator class="text-ocean size-5" /> New charge
				</CardTitle>
				<CardDescription>
					Rent (full or prorated) and utility reimbursements. Drafts stay management-only until
					published.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{#if form?.section === 'composer'}
					<p
						class={cn(
							'mb-3 rounded-md px-3 py-2 text-sm',
							form.message?.includes('fail') || form.message?.includes('duplicate')
								? 'bg-destructive/10 text-destructive'
								: form.warning
									? 'border border-amber-200 bg-amber-50 text-navy'
									: 'bg-turquoise/15 text-navy'
						)}
					>
						{form.message}
					</p>
				{/if}
				<form method="POST" enctype="multipart/form-data" use:enhance class="flex flex-col gap-4">
					<input type="hidden" name="lease" value={data.lease.id} />

					<div class="grid gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-2">
							<Label for="kind">Charge type</Label>
							<Select.Root type="single" name="kind" bind:value={kind}>
								<Select.Trigger id="kind" class="min-h-12 w-full">
									{kindLabels[kind]}
								</Select.Trigger>
								<Select.Content>
									{#each Object.entries(kindLabels) as [value, label] (value)}
										<Select.Item {value}>{label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex flex-col gap-2">
							<Label for="due_date">Due date</Label>
							<Input id="due_date" name="due_date" type="date" required value={data.today} />
						</div>
					</div>

					{#if kind === 'rent_full'}
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="flex flex-col gap-2">
								<Label for="month">Rental month</Label>
								<Input id="month" name="month" type="month" required bind:value={month} />
							</div>
							<div class="flex flex-col gap-2">
								<Label for="amount_override">
									Monthly rent (USD) — lease default {formatMoney(data.lease.monthly_rent_cents)}
								</Label>
								<Input
									id="amount_override"
									name="amount_override"
									inputmode="decimal"
									bind:value={amountOverride}
									placeholder={defaultRent.toFixed(2)}
								/>
							</div>
						</div>
						<p class="text-muted-foreground text-xs">
							Full-month charge. Overriding the amount here never changes the lease or unit
							settings.
						</p>
					{:else if kind === 'rent_partial'}
						<!-- calculation basis -->
						<fieldset class="flex flex-col gap-2">
							<legend class="text-sm font-medium">Calculation basis</legend>
							<div class="grid gap-2 sm:grid-cols-2">
								<label
									class={cn(
										'flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm',
										basis === '30-day' ? 'border-ocean bg-ocean/10 text-navy' : 'border-navy/15 bg-card text-navy'
									)}
								>
									<input type="radio" name="basis" value="30-day" class="size-4 accent-[#075985]" bind:group={basis} />
									30-day month (default for this rental)
								</label>
								<label
									class={cn(
										'flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm',
										basis === 'actual' ? 'border-ocean bg-ocean/10 text-navy' : 'border-navy/15 bg-card text-navy'
									)}
								>
									<input type="radio" name="basis" value="actual" class="size-4 accent-[#075985]" bind:group={basis} />
									Actual calendar days (split across months)
								</label>
							</div>
						</fieldset>

						<!-- partial method -->
						<fieldset class="flex flex-col gap-2">
							<legend class="text-sm font-medium">Partial-period method</legend>
							<div class="grid gap-2 sm:grid-cols-2">
								<label
									class={cn(
										'flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm',
										method === 'days' ? 'border-ocean bg-ocean/10 text-navy' : 'border-navy/15 bg-card text-navy'
									)}
								>
									<input type="radio" name="method" value="days" class="size-4 accent-[#075985]" bind:group={method} />
									Enter billable days (e.g. landlord adjustment)
								</label>
								<label
									class={cn(
										'flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm',
										method === 'range' ? 'border-ocean bg-ocean/10 text-navy' : 'border-navy/15 bg-card text-navy'
									)}
								>
									<input type="radio" name="method" value="range" class="size-4 accent-[#075985]" bind:group={method} />
									Select start / end dates (both days count)
								</label>
							</div>
						</fieldset>

						{#if method === 'days'}
							<div class="grid gap-4 sm:grid-cols-3">
								<div class="flex flex-col gap-2">
									<Label for="days">Billable days</Label>
									<Input id="days" name="days" type="number" min="1" step="1" required bind:value={days} />
								</div>
								<div class="flex flex-col gap-2">
									<Label for="start">Period start (optional)</Label>
									<Input id="start" name="start" type="date" bind:value={start} />
								</div>
								<div class="flex flex-col gap-2">
									<Label for="end">Period end (optional)</Label>
									<Input id="end" name="end" type="date" bind:value={end} />
								</div>
							</div>
						{:else}
							<div class="grid gap-4 sm:grid-cols-3">
								<div class="flex flex-col gap-2">
									<Label for="start">Start date</Label>
									<Input id="start" name="start" type="date" required bind:value={start} />
								</div>
								<div class="flex flex-col gap-2">
									<Label for="end">End date</Label>
									<Input id="end" name="end" type="date" required bind:value={end} />
								</div>
								<div class="flex flex-col gap-2">
									<Label>Billable days (start and end both count)</Label>
									<p class="bg-muted flex h-9 items-center rounded-md px-3 text-sm font-medium">
										{rangeDays || '—'}
									</p>
								</div>
							</div>
						{/if}

						<div class="flex flex-col gap-2">
							<Label for="amount_override_p">
								Monthly rent (USD) — default {formatMoney(data.lease.monthly_rent_cents)}
							</Label>
							<Input
								id="amount_override_p"
								name="amount_override"
								inputmode="decimal"
								bind:value={amountOverride}
								placeholder={defaultRent.toFixed(2)}
							/>
						</div>

						<!-- live preview -->
						{#if preview && !('error' in preview)}
							<div class="bg-ocean/5 border-ocean/20 rounded-lg border p-3 text-sm">
								<p class="text-navy font-medium">Preview</p>
								<dl class="text-navy mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
									<div><dt class="text-muted-foreground text-xs">Monthly rate</dt><dd>{formatMoney(preview.monthly_rate_cents)}</dd></div>
									<div><dt class="text-muted-foreground text-xs">Basis</dt><dd>{basis === '30-day' ? '30-day month' : 'Actual calendar days'}</dd></div>
									<div><dt class="text-muted-foreground text-xs">Daily rate</dt><dd>${(preview.daily_rate_cents / 100).toFixed(4)}</dd></div>
									<div><dt class="text-muted-foreground text-xs">Billable days</dt><dd>{preview.billable_days}</dd></div>
									<div><dt class="text-muted-foreground text-xs">Final charge</dt><dd class="font-semibold">{formatMoney(preview.amount_cents)}</dd></div>
								</dl>
								{#if preview.portions.length > 1}
									<p class="text-muted-foreground mt-1 text-xs">
										{preview.portions.map((p) => `${p.days}d in ${p.month}`).join(' + ')}
									</p>
								{/if}
							</div>
						{:else if preview && 'error' in preview}
							<p class="text-muted-foreground text-xs">{preview.error}</p>
						{/if}

						<!-- manual override -->
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" class="size-4 accent-[#075985]" bind:checked={overrideOn} />
							Manual amount override
						</label>
						{#if overrideOn}
							<div class="grid gap-4 sm:grid-cols-2">
								<div class="flex flex-col gap-2">
									<Label for="override_amount">Override amount (USD)</Label>
									<Input id="override_amount" name="override_amount" inputmode="decimal" bind:value={overrideAmount} />
								</div>
								<div class="flex flex-col gap-2">
									<Label for="override_reason">Explanation (required)</Label>
									<Input id="override_reason" name="override_reason" required={overrideOn} bind:value={overrideReason} placeholder="e.g. landlord adjustment" />
								</div>
							</div>
						{/if}
					{:else if kind === 'deposit'}
						<!-- security deposit -->
						<div class="flex flex-col gap-2">
							<Label for="deposit_amount">
								Deposit amount (USD) — leave blank to use the lease requirement of
								{formatMoney(data.lease.deposit_cents)}
							</Label>
							<Input
								id="deposit_amount"
								name="amount"
								inputmode="decimal"
								placeholder={(data.lease.deposit_cents / 100).toFixed(2)}
							/>
						</div>
						<p class="text-muted-foreground text-xs">
							One deposit charge per lease — a second one is blocked automatically. Editing the amount
							here never changes the lease requirement.
						</p>
					{:else if kind === 'other'}
						<!-- other one-off charge -->
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="flex flex-col gap-2 sm:col-span-2">
								<Label for="other_description">Description</Label>
								<Input
									id="other_description"
									name="description"
									required
									placeholder="e.g. Credit-check reimbursement"
								/>
							</div>
							<div class="flex flex-col gap-2">
								<Label for="other_amount">Amount (USD)</Label>
								<Input id="other_amount" name="amount" inputmode="decimal" required placeholder="0.00" />
							</div>
							<div class="flex flex-col gap-2">
								<Label for="other_billing_month">Billing month</Label>
								<Input id="other_billing_month" name="billing_month" type="month" required />
							</div>
						</div>
					{:else}
						<!-- utilities -->
						<div class="grid gap-4 sm:grid-cols-3">
							<div class="flex flex-col gap-2">
								<Label for="billing_month">Billing month</Label>
								<Input id="billing_month" name="billing_month" type="month" required />
							</div>
							<div class="flex flex-col gap-2">
								<Label for="amount">Reimbursement amount (USD)</Label>
								<Input id="amount" name="amount" inputmode="decimal" required placeholder="0.00" />
							</div>
							<div class="flex flex-col gap-2">
								<Label for="service_period">Service period (stays on the bill text)</Label>
								<Input id="service_period" name="service_period" required placeholder="e.g. Oct 2026" />
							</div>
						</div>
						<div class="flex flex-col gap-2">
							<Label for="bill_file">Bill attachment (PDF/JPEG/PNG, optional)</Label>
							<Input id="bill_file" name="bill_file" type="file" accept="application/pdf,image/jpeg,image/png" />
						</div>
					{/if}

					<div class="flex flex-col gap-2">
						<Label for="note">Note (optional)</Label>
						<Input id="note" name="note" placeholder="Shown on the charge" />
					</div>

					<div class="flex flex-col gap-2 sm:flex-row">
						<Button type="submit" formaction="?/createCharge" variant="outline" class="min-h-12 flex-1">
							Save draft
						</Button>
						<Button type="submit" formaction="?/createCharge" name="publish" value="1" class="min-h-12 flex-1">
							Publish charge
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>

		<!-- Charges -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Receipt class="text-ocean size-5" /> Charges
				</CardTitle>
				<CardDescription>Drafts are visible to management only.</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-4">
				{#if form?.section === 'charges'}
					<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm">{form.message}</p>
				{/if}
				{#if data.chargesError}
					<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
						Could not load charges: {data.chargesError}
					</p>
				{:else if data.charges.length === 0}
					<p class="text-muted-foreground text-sm">No charges yet.</p>
				{/if}
				{#each data.charges as c (c.id)}
					{@const st = statusOf(c)}
					{@const paid = paidFor(c)}
					{@const remaining = remainingOf(c)}
					<div class="flex flex-col gap-3 rounded-xl border p-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div>
								<p class="font-medium">
									<span class="bg-muted text-muted-foreground mr-1.5 inline-block rounded px-1.5 py-0.5 align-middle text-[11px]">
										{typeLabels[c.type] ?? c.type}
									</span>
									{c.description}
								</p>
								<p class="text-muted-foreground text-sm">
									Due {formatDate(c.due_date)}
								{#if c.period_start} · period {formatDate(c.period_start)} → {formatDate(c.period_end)}{/if}
								</p>
							</div>
							<div class="flex items-center gap-2">
								<StatusBadge status={st === 'partially_paid' ? 'in_progress' : st === 'paid' ? 'resolved' : st === 'draft' ? 'draft' : 'open'} />
								<span class="text-muted-foreground text-xs">
									{st === 'draft' ? 'Draft' : st === 'paid' ? 'Paid' : st === 'partially_paid' ? 'Partially paid' : 'Unpaid'}
								</span>
							</div>
						</div>
						{#if calcSummary(c)}
							<p class="text-muted-foreground bg-muted rounded px-2 py-1 text-xs">{calcSummary(c)}</p>
						{/if}
						{#if c.calc?.override}
							<p class="text-muted-foreground text-xs">
								Manual override: {formatMoney(c.calc.override.amount_cents)} — {c.calc.override.reason}
							</p>
						{/if}
						<p class="text-sm">
							<strong>{formatMoney(c.amount_cents)}</strong>
							<span class="text-muted-foreground">
								· paid {formatMoney(paid)} · remaining {formatMoney(remaining)}
							</span>
						</p>
						{#if data.billDocs[c.id]}
							<a
								class="text-ocean flex w-fit items-center gap-1 text-sm underline-offset-4 hover:underline"
								href={data.billDocs[c.id].url}
								target="_blank"
								rel="noreferrer"
							>
								<FileText class="size-4" /> View bill attachment
							</a>
						{/if}

						<div class="flex flex-wrap items-center gap-2">
							{#if c.status === 'draft'}
								<form method="POST" action="?/publishCharge" use:enhance>
									<input type="hidden" name="id" value={c.id} />
									<Button type="submit" size="sm" class="min-h-12">Publish</Button>
								</form>
								<form method="POST" action="?/deleteDraft" use:enhance>
									<input type="hidden" name="id" value={c.id} />
									<Button type="submit" size="sm" variant="destructive" class="min-h-12">Delete draft</Button>
								</form>
							{/if}
						</div>

						{#if c.status === 'published' && remaining > 0}
							<Separator />
							<Button
								size="sm"
								variant="outline"
								class="min-h-12 w-fit"
								onclick={() => {
									payCharge = c;
									payMonth = null;
									payOpen = true;
								}}
							>
								<HandCoins class="size-4" /> Record payment
							</Button>
						{/if}
					</div>
				{/each}
			</CardContent>
		</Card>

		<!-- Monthly statements -->
		<div class="flex flex-col gap-4">
			<h2 class="flex items-center gap-2 text-lg font-semibold tracking-tight text-white drop-shadow-sm">
				<CalendarDays class="size-5" />
				Monthly statements
			</h2>				{#if form?.section?.startsWith('sched-') && form.message?.startsWith('Published')}
					<p class="bg-turquoise/15 rounded-md px-3 py-2 text-sm text-white drop-shadow-sm">
						{form.message}
					</p>
				{/if}			<BillingStatement
				charges={data.charges}
				payments={data.payments}
				billDocs={data.billDocs}
				canManage
				leaseId={data.lease.id}
				{form}
				printHref={(m) => `/dashboard/billing/statement?month=${m}&lease=${data.lease.id}`}
				onMonthPay={(m) => {
					payMonth = m;
					payCharge = null;
					payOpen = true;
				}}
			/>
		</div>

		<!-- Payments -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Upload class="text-turquoise size-5 rotate-180" /> Payments recorded
				</CardTitle>
				<CardDescription>Money arrives outside the app; management records confirmed receipt.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if data.paymentsError}
					<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
						Could not load payments: {data.paymentsError}
					</p>
				{:else if data.payments.length === 0}
					<p class="text-muted-foreground text-sm">No payments yet.</p>
				{:else}
					<ul class="divide-y rounded-md border text-sm">
						{#each data.payments as p (p.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 p-3">
								<span>{formatDate(p.date)} · {methodLabels[p.method] ?? p.method}{#if p.reference} · ref {p.reference}{/if}</span>
								<span class="font-medium">{formatMoney(p.amount_cents)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</CardContent>
		</Card>

			<RecordPaymentDialog
				bind:open={payOpen}
				charge={payCharge}
				month={payMonth}
				charges={data.charges}
				payments={data.payments}
				tenantName={data.lease.expand?.tenant?.name || 'Tenant'}
				today={data.today}
			/>
	{/if}
</div>
