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
	import HelpVideoDialog from '$lib/components/HelpVideoDialog.svelte';
	import {
		ArrowLeft,
		Calculator,
		CalendarDays,
		CircleDollarSign,
		Eye,
		FileText,
		HandCoins,
		LayoutList,
		List,
		Play,
		Receipt,
		ShieldCheck,
		Upload,
		Zap
	} from '@lucide/svelte';
	import type { Charge, Lease, Payment } from '$lib/types';
	import { billStatus, monthLabel } from '$lib/billing';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let helpVideoOpen = $state(false);
	let billingOverviewVideo = $derived(data.helpVideos.find((v) => v.placement === 'manage_billing') ?? null);

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

	/** Split a rendered string into plain-text and dollar-figure segments for styling. */
	function splitMoney(text: string): { text: string; money: boolean }[] {
		return text
			.split(/(\$[\d,]+(?:\.\d+)?)/g)
			.filter(Boolean)
			.map((part) => ({ text: part, money: part.startsWith('$') }));
	}

	// ---- charges list view filter (display only — never alters charge data) ----
	let chargeFilter = $state<'all' | 'published' | 'drafts'>('published');
	let chargeFilters = $derived([
		{ value: 'all' as const, label: 'All', count: data.charges.length },
		{
			value: 'published' as const,
			label: 'Published — Tenant sees',
			count: data.charges.filter((c) => c.status === 'published').length
		},
		{
			value: 'drafts' as const,
			label: 'Drafts — Admin only',
			count: data.charges.filter((c) => c.status === 'draft').length
		}
	]);
	let visibleCharges = $derived(
		chargeFilter === 'all'
			? data.charges
			: data.charges.filter((c) =>
					chargeFilter === 'published' ? c.status === 'published' : c.status === 'draft'
				)
	);

	// ---- detailed / simple view toggle (display only) ----
	let chargeView = $state<'detailed' | 'simple'>('simple');
	const chargeViews = [
		{ value: 'detailed' as const, label: 'Detailed', icon: LayoutList },
		{ value: 'simple' as const, label: 'Simple', icon: List }
	];
	// Simple view: same filtered charges, largest remaining first. Drafts are
	// excluded from the published balance and totalled separately below.
	let simpleRows = $derived(
		visibleCharges
			.map((c) => ({ c, remaining: remainingOf(c) }))
			.sort((a, b) => b.remaining - a.remaining)
	);
	let simplePublishedTotal = $derived(
		simpleRows.filter((r) => r.c.status === 'published').reduce((s, r) => s + r.remaining, 0)
	);
	let simpleDraftTotal = $derived(
		simpleRows.filter((r) => r.c.status === 'draft').reduce((s, r) => s + r.remaining, 0)
	);
	let simpleHasPublished = $derived(simpleRows.some((r) => r.c.status === 'published'));
	let simpleHasDrafts = $derived(simpleRows.some((r) => r.c.status === 'draft'));

	// "Display draft bills": view-only — selects the Drafts filter and scrolls the
	// charges list into view. Never publishes or modifies anything.
	function showDraftBills() {
		chargeFilter = 'drafts';
		document.getElementById('charges')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// Security deposit tile: progress state from the lease requirement vs. recorded
	// deposit payments. Color is only a cue — the card spells the state out in words.
	let depositState = $derived.by((): 'none' | 'partial' | 'full' => {
		const required = data.lease?.deposit_cents ?? 0;
		const paid = data.ledger.depositPaid;
		if (required > 0 && paid <= 0) return 'none';
		if (paid >= required) return 'full';
		return 'partial';
	});

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

<div class="manage-panel bg-card text-card-foreground mb-6 flex flex-col rounded-xl border shadow-lg">
	<div class="flex flex-wrap items-center gap-2">
		<Button href="/dashboard/manage" variant="outline" size="sm">
			<ArrowLeft class="size-4" /> Management
		</Button>
		<h1 class="text-navy text-2xl font-bold tracking-tight">Billing</h1>
		{#if billingOverviewVideo}
			<Button variant="outline" size="sm" class="ml-auto min-h-11" onclick={() => (helpVideoOpen = true)}>
				<Play class="size-4" /> Watch Billing overview
			</Button>
		{/if}
	</div>

	{#if billingOverviewVideo}
		<HelpVideoDialog bind:open={helpVideoOpen} video={billingOverviewVideo} />
	{/if}

	{#if data.leasesError}
		<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
			Could not load the lease list: {data.leasesError}
		</p>
	{/if}
	{#if data.leases.length > 1}
		<div class="flex flex-wrap items-center gap-2">
			<Label for="lease-picker" class="text-navy">Lease</Label>
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
			<p class="text-navy font-medium">
				{data.lease.expand?.tenant?.name || 'Tenant'} · {formatDate(data.lease.start_date)} –{' '}
				{formatDate(data.lease.end_date)} · {formatMoney(data.lease.monthly_rent_cents)}/month
			</p>
		</div>

		<!-- Summary -->
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			<Card class="tile bg-sky-100!">
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
						<CircleDollarSign class="text-sky-600 size-4" /> Balance due (published)
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
			<Card
				class={cn(
					'tile',
					depositState === 'none'
						? 'bg-red-100!'
						: depositState === 'partial'
							? 'bg-amber-100!'
							: 'bg-emerald-100!'
				)}
			>
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
						<ShieldCheck
							class={cn(
								'size-4',
								depositState === 'none'
									? 'text-red-700'
									: depositState === 'partial'
										? 'text-amber-600'
										: 'text-emerald-600'
							)}
						/> Security deposit
					</CardDescription>
					<CardTitle class="text-2xl">
						{formatMoney(Math.max(0, data.lease.deposit_cents - data.ledger.depositPaid))}
					</CardTitle>
					<CardDescription>
						<span
							class={cn(
								'font-medium',
								depositState === 'none'
									? 'text-red-700'
									: depositState === 'partial'
										? 'text-amber-700'
										: 'text-emerald-700'
							)}
						>{depositState === 'none'
							? 'No deposit received yet'
							: depositState === 'partial'
								? 'Partially received'
								: 'Received in full'}</span>
						{' '}· remaining of the lease requirement
					</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-1 pt-0 text-sm">
					<div class="flex items-center justify-between gap-2">
						<span class="text-muted-foreground">Required (lease)</span>
						<span class="text-navy font-medium tabular-nums">
							{formatMoney(data.lease.deposit_cents)}
						</span>
					</div>
					<div class="flex items-center justify-between gap-2">
						<span class="text-muted-foreground">Received</span>
						<span class="text-navy font-medium tabular-nums">
							{formatMoney(data.ledger.depositPaid)}
						</span>
					</div>
					<div class="border-navy/10 mt-1 flex items-center justify-between gap-2 border-t pt-1.5">
						<span class="text-navy font-medium">Remaining</span>
						<span class="text-navy font-semibold tabular-nums">
							{formatMoney(Math.max(0, data.lease.deposit_cents - data.ledger.depositPaid))}
						</span>
					</div>
				</CardContent>
			</Card>
			<Card class="tile bg-yellow-100!">
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
						<Receipt class="text-amber-500 size-4" /> Drafts (management-only)
					</CardDescription>
					<CardTitle class="text-2xl">
						{data.charges.filter((c) => c.status === 'draft').length}
					</CardTitle>
				</CardHeader>
				<CardContent class="flex flex-col gap-3 pt-0">
					<p class="text-muted-foreground text-xs">
						draft total{' '}
						{formatMoney(
							data.charges
								.filter((c) => c.status === 'draft')
								.reduce((s, c) => s + c.amount_cents, 0)
						)}
					</p>
					<Button variant="outline" size="sm" class="min-h-12 w-full" onclick={showDraftBills}>
						<Eye class="size-4" /> Display draft bills
					</Button>
				</CardContent>
			</Card>
		</div>

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
				{#if data.lease.deposit_cents > 0 && !data.charges.some((c) => c.type === 'deposit' && c.status === 'published')}
					<p class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
						<ShieldCheck class="mr-1 inline size-4 align-text-bottom" />
						Deposit not yet billed — the lease requires {formatMoney(data.lease.deposit_cents)}. Add it
						from the composer (Security deposit) when you're ready to bill it; nothing is created
						automatically.
					</p>
				{/if}
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
		<Card id="charges">
			<CardHeader class="flex flex-wrap items-center justify-between gap-3">
				<div class="flex flex-col gap-1.5">
					<CardTitle class="flex items-center gap-2">
						<Receipt class="text-ocean size-5" /> Charges
					</CardTitle>
					<CardDescription>Drafts are visible to management only.</CardDescription>
				</div>
				<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
					<div class="flex flex-wrap gap-1" role="group" aria-label="Charge view">
						{#each chargeViews as v (v.value)}
							{@const VIcon = v.icon}
							<button
								type="button"
								onclick={() => (chargeView = v.value)}
								aria-pressed={chargeView === v.value}
								class={cn(
									'flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors',
									chargeView === v.value
										? 'border-ocean bg-ocean text-white shadow-sm'
										: 'border-navy/15 bg-white text-navy hover:bg-seafoam/60'
								)}
							>
								<VIcon class="size-4" />
								{v.label}
							</button>
						{/each}
					</div>
					<div class="flex flex-wrap gap-1" role="group" aria-label="Filter charges">
						{#each chargeFilters as f (f.value)}
						<button
							type="button"
							onclick={() => (chargeFilter = f.value)}
							aria-pressed={chargeFilter === f.value}
							class={cn(
								'flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors',
								chargeFilter === f.value
									? 'border-ocean bg-ocean text-white shadow-sm'
									: 'border-navy/15 bg-white text-navy hover:bg-seafoam/60'
							)}
						>
							{f.label}
							<span
								class={cn(
									'rounded-full px-1.5 py-0.5 text-xs font-semibold',
									chargeFilter === f.value ? 'bg-white/20 text-white' : 'bg-muted text-navy'
								)}
							>
								{f.count}
							</span>
							</button>
						{/each}
					</div>
				</div>
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
				{#if data.charges.length > 0 && visibleCharges.length === 0}
					<p class="text-muted-foreground text-sm">
						No {chargeFilter === 'published' ? 'published' : 'draft'} charges.
					</p>
				{/if}
				{#if visibleCharges.length > 0}
				{#if chargeView === 'detailed'}
				<div class="divide-y overflow-hidden rounded-xl border">
				{#each visibleCharges as c (c.id)}
					{@const st = statusOf(c)}
					{@const paid = paidFor(c)}
					{@const remaining = remainingOf(c)}
					{@const summary = calcSummary(c)}
					<div class="flex flex-col gap-3 p-5 odd:bg-white even:bg-sky-50">
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
								<StatusBadge status={st} />
							</div>
						</div>
						{#if summary}
							<p class="text-muted-foreground bg-muted rounded px-2 py-1 text-xs">
								{#each splitMoney(summary) as seg}{#if seg.money}<span class="text-[#B91C1C]">{seg.text}</span>{:else}{seg.text}{/if}{/each}
							</p>
						{/if}
						{#if c.calc?.override}
							<p class="text-muted-foreground text-xs">
								Manual override: <span class="text-[#B91C1C]">{formatMoney(c.calc.override.amount_cents)}</span> — {c.calc.override.reason}
							</p>
						{/if}
						<p class="text-sm">
							<strong class="text-[#B91C1C]">{formatMoney(c.amount_cents)}</strong>
							<span class="text-muted-foreground">
								· paid <span class="text-[#B91C1C]">{formatMoney(paid)}</span> · remaining <span class="text-[#B91C1C]">{formatMoney(remaining)}</span>
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
				</div>
				{:else}
				<!-- Simple view: itemized like the tenant account balance. -->
				<ul class="flex flex-col">
					{#each simpleRows as r (r.c.id)}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
							<span class="min-w-0 flex-1 text-sm">
								<span class="font-medium">{r.c.description}</span>
								{#if r.c.period}
									<span class="text-muted-foreground"> · {monthLabel(r.c.period)}</span>
								{/if}
								{#if r.c.status === 'draft'}
									<span class="ml-1.5 rounded bg-amber-200 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-amber-900">Draft</span>
								{/if}
							</span>
							<span class="shrink-0 text-sm font-medium tabular-nums text-[#B91C1C]">
								{formatMoney(r.remaining)}
							</span>
							{#if r.c.status === 'draft'}
								<span class="flex gap-1">
									<form method="POST" action="?/publishCharge" use:enhance>
										<input type="hidden" name="id" value={r.c.id} />
										<Button type="submit" size="sm" class="min-h-9">Publish</Button>
									</form>
									<form method="POST" action="?/deleteDraft" use:enhance>
										<input type="hidden" name="id" value={r.c.id} />
										<Button type="submit" size="sm" variant="destructive" class="min-h-9">Delete</Button>
									</form>
								</span>
							{:else if r.remaining > 0}
								<Button
									size="sm"
									variant="outline"
									class="min-h-9"
									onclick={() => {
										payCharge = r.c;
										payMonth = null;
										payOpen = true;
									}}
								>
									Record payment
								</Button>
							{/if}
						</li>
					{/each}
				</ul>
				<hr class="border-border my-3" />
				<div class="flex flex-col gap-1">
					{#if simpleHasPublished}
						<div class="flex items-center justify-between gap-3">
							<span class="text-sm font-semibold">Published balance</span>
							<span class="text-navy text-lg font-bold tabular-nums">
								{formatMoney(simplePublishedTotal)}
							</span>
						</div>
					{/if}
					{#if simpleHasDrafts}
						<div class="flex items-center justify-between gap-3">
							<span class="text-muted-foreground text-sm">Drafts total (not in balance)</span>
							<span class="text-muted-foreground text-sm font-semibold tabular-nums">
								{formatMoney(simpleDraftTotal)}
							</span>
						</div>
					{/if}
				</div>
				{/if}
				{/if}
			</CardContent>
		</Card>

		<!-- Monthly statements -->
		<div class="flex flex-col gap-4">
			<h2 class="text-navy flex items-center gap-2 text-lg font-semibold tracking-tight">
				<CalendarDays class="size-5" />
				Monthly statements
			</h2>				{#if form?.section?.startsWith('sched-') && form.message?.startsWith('Published')}
					<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm">
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
