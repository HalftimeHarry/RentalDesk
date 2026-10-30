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
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import MessageThread from '$lib/components/MessageThread.svelte';
	import LeaseDetailsDialog from '$lib/components/LeaseDetailsDialog.svelte';
	import BillingStatement from '$lib/components/BillingStatement.svelte';
	import { docUrl, isImageFile } from '$lib/files';
	import { formatDate, formatMoney } from '$lib/format';
	import { billStatus, monthLabel } from '$lib/billing';
	import type { Charge, DocRecord } from '$lib/types';
	import { Eye, FileText, House, Receipt, Wallet, ClipboardCheck, Wrench, MessageSquare, ShieldCheck, Zap } from '@lucide/svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let lease = $derived(data.lease);
	let leaseOpen = $state(false);

	// Bill attachments keyed by charge for the statement rows.
	const billDocsMap = $derived(
		Object.fromEntries(
			data.documents
				.filter((d) => d.kind === 'bill' && d.charge)
				.map((d) => [d.charge, { url: docUrl(d.id, d.file) }])
		)
	);
	let ledger = $derived(data.ledger);
	let depositRemaining = $derived(Math.max(0, (lease?.deposit_cents ?? 0) - ledger.depositPaid));

	// Itemized account balance: each published charge's remaining balance.
	// Drafts never reach the client (API rules); the filter is belt-and-suspenders.
	function shortLabel(c: Charge): string {
		if (c.type === 'deposit') return 'Security deposit';
		const month = c.period ? monthLabel(c.period).split(' ')[0] : '';
		if (c.type === 'rent') return `${month} ${c.prorated ? 'partial rent' : 'rent'}`;
		if (c.type === 'late_fee') return `${month} late fee`.trim();
		// utilities: "AT&T reimbursement — service Nov 2026" -> "November AT&T"
		const who = c.description.split(' reimbursement')[0].split(' — ')[0].trim();
		return `${month} ${who}`.trim();
	}
	const balanceRows = $derived(
		data.charges
			.filter((c) => c.status === 'published' && c.type !== 'deposit')
			.map((c) => ({ c, remaining: Math.max(0, c.amount_cents - paidFor(c)) }))
			.filter((r) => r.remaining > 0)
			.sort((a, b) => `${a.c.due_date}${a.c.id}`.localeCompare(`${b.c.due_date}${b.c.id}`))
	);
	// Deposit row: from the published deposit charge when billed, otherwise from the
	// lease requirement (tagged "not yet billed" — it is not part of the billed total).
	const depositRow = $derived.by(() => {
		const dc = data.charges.find((c) => c.type === 'deposit' && c.status === 'published');
		if (dc) {
			const remaining = Math.max(0, dc.amount_cents - paidFor(dc));
			return remaining > 0 ? { remaining, billed: true } : null;
		}
		if (lease && lease.deposit_cents > 0 && depositRemaining > 0) {
			return { remaining: depositRemaining, billed: false };
		}
		return null;
	});
	const chargeTypeLabels: Record<string, string> = {
		rent: 'Rent',
		deposit: 'Deposit',
		late_fee: 'Late fee',
		other: 'Other'
	};

	// Per-charge payment allocation and remaining balance.
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
		return '';
	}
	function billDocFor(c: Charge): DocRecord | undefined {
		return data.documents.find((d) => d.charge === c.id && d.kind === 'bill');
	}
	const methodLabels: Record<string, string> = {
		cash: 'Cash',
		check: 'Check',
		zelle: 'Zelle',
		venmo: 'Venmo',
		bank_transfer: 'Bank transfer',
		other: 'Other'
	};
	const inspectionLabels: Record<string, string> = {
		move_in: 'Move-in',
		move_out: 'Move-out',
		periodic: 'Periodic'
	};
</script>

<svelte:head>
	<title>Tenant dashboard — RentalDesk</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight text-white drop-shadow-sm">Tenant dashboard</h1>
		<p class="text-white/85 drop-shadow-sm">Welcome, {data.user.name || data.user.email}.</p>
	</div>

	{#if !lease}
		<Card>
			<CardContent class="text-muted-foreground py-8 text-center text-sm">
				No lease is linked to your account yet. Contact the management team if you believe this
				is a mistake.
			</CardContent>
		</Card>
	{:else}
		<!-- Account balance -->
		<Card>
			<CardHeader class="pb-2">
				<CardTitle class="flex items-center gap-2">
					<Wallet class="text-ocean size-5" /> Account balance
				</CardTitle>
				<CardDescription>Itemized by billing month.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if balanceRows.length === 0 && !depositRow}
					<p class="text-muted-foreground text-sm">
						Nothing due — all published charges are settled.
					</p>
				{:else}
					<ul class="flex flex-col">
						{#each balanceRows as r (r.c.id)}
							{@const Icon = r.c.type === 'rent' ? House : r.c.type === 'late_fee' ? Receipt : Zap}
							<li class="flex items-center gap-3 py-2.5">
								<Icon class="text-ocean size-4 shrink-0" />
								<span class="min-w-0 flex-1 truncate text-sm">{shortLabel(r.c)}</span>
								<span class="shrink-0 text-sm font-medium tabular-nums">
									{formatMoney(r.remaining)}
								</span>
							</li>
						{/each}
						{#if depositRow}
							<li class="bg-sand/70 -mx-2 mt-1 flex items-center gap-3 rounded-lg px-2 py-2.5">
								<ShieldCheck class="text-turquoise size-4 shrink-0" />
								<span class="min-w-0 flex-1 text-sm">
									Security deposit
									<span class="text-muted-foreground block text-xs">
										Required: {formatMoney(lease.deposit_cents)} · {depositRow.billed
											? 'held separately'
											: 'not yet billed — not in the total below'}
									</span>
								</span>
								<span class="shrink-0 text-sm font-medium tabular-nums">
									{formatMoney(depositRow.remaining)}
								</span>
							</li>
						{/if}
					</ul>
					<hr class="border-border my-3" />
					<div class="flex items-center justify-between gap-3">
						<span class="text-sm font-semibold">Total balance due</span>
						<span class="text-navy text-xl font-bold tabular-nums">
							{formatMoney(ledger.totalBalance)}
						</span>
					</div>
				{/if}
			</CardContent>
		</Card>

		<!-- Lease -->
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between gap-2">
					<CardTitle class="flex items-center gap-2">
						<House class="text-ocean size-5" /> Lease
					</CardTitle>
					<div class="flex items-center gap-2">
						<StatusBadge status={lease.status} />
						<Button variant="outline" size="sm" class="min-h-12" onclick={() => (leaseOpen = true)}>
							<Eye class="size-4" /> View lease
						</Button>
						<LeaseDetailsDialog bind:open={leaseOpen} {lease} documents={data.documents} canManage={false} />
					</div>
				</div>
				<CardDescription>
					{formatDate(lease.start_date)} – {formatDate(lease.end_date)} · {formatMoney(
						lease.monthly_rent_cents
					)}/month · deposit {formatMoney(lease.deposit_cents)}
				</CardDescription>
			</CardHeader>
			{#if data.documents.length > 0}
				<CardContent>
					<p class="mb-2 text-sm font-medium">Lease documents</p>
					<ul class="divide-y rounded-md border">
						{#each data.documents as doc (doc.id)}
							<li class="flex items-center gap-3 p-3 text-sm">
								{#if isImageFile(doc.file)}
									<img
										src="{docUrl(doc.id, doc.file)}?thumb=100x100"
										alt=""
										class="size-10 shrink-0 rounded border object-cover"
									/>
								{:else}
									<FileText class="text-muted-foreground size-4 shrink-0" />
								{/if}
								<a
									class="font-medium underline-offset-4 hover:underline"
									href={docUrl(doc.id, doc.file)}
									target="_blank"
									rel="noreferrer">{doc.title}</a
								>
								<span class="text-muted-foreground ml-auto">{formatDate(doc.created)}</span>
							</li>
						{/each}
					</ul>
				</CardContent>
			{/if}
		</Card>

		<!-- Monthly statements -->
		<div class="flex flex-col gap-4">
			<h2 class="text-lg font-semibold tracking-tight text-white drop-shadow-sm">
				Monthly statements
			</h2>
			<BillingStatement
				charges={data.charges}
				payments={data.payments}
				billDocs={billDocsMap}
				printHref={(m) => `/dashboard/billing/statement?month=${m}`}
			/>
		</div>

		<!-- Payments -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Wallet class="text-turquoise size-5" /> Payments
				</CardTitle>
				<CardDescription>
					Payments are made outside the app and recorded by the management team once received.
					Message them if something looks off.
				</CardDescription>
				{#if data.settings?.zelle_instructions}
					<p class="bg-ocean/10 text-navy mx-6 rounded-md px-3 py-2 text-sm">
						<strong>Pay with Zelle:</strong> {data.settings.zelle_instructions}
					</p>
				{/if}
			</CardHeader>
			<CardContent>
				{#if data.payments.length === 0}
					<p class="text-muted-foreground text-sm">No payments recorded yet.</p>
				{:else}
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Date</TableHead>
								<TableHead>Method</TableHead>
								<TableHead>Applies to</TableHead>
								<TableHead>Note</TableHead>
								<TableHead class="text-right">Amount</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each data.payments as p (p.id)}
								<TableRow>
									<TableCell>{formatDate(p.date)}</TableCell>
									<TableCell>{methodLabels[p.method] ?? p.method}</TableCell>
									<TableCell>{p.applies_to === 'deposit' ? 'Deposit' : 'Rent'}</TableCell>
									<TableCell class="text-muted-foreground">{p.note}</TableCell>
									<TableCell class="text-right font-medium">{formatMoney(p.amount_cents)}</TableCell
									>
								</TableRow>
							{/each}
						</TableBody>
					</Table>
				{/if}
			</CardContent>
		</Card>

		<div class="grid gap-6 lg:grid-cols-2">
			<!-- Inspections -->
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2">
						<ClipboardCheck class="text-ocean size-5" /> Inspections
					</CardTitle>
					<CardDescription>Scheduled and completed inspections for your lease.</CardDescription>
				</CardHeader>
				<CardContent>
					{#if data.inspections.length === 0}
						<p class="text-muted-foreground text-sm">No inspections scheduled.</p>
					{:else}
						<ul class="divide-y rounded-md border">
							{#each data.inspections as i (i.id)}
								<li class="p-3 text-sm">
								<div class="flex items-center justify-between gap-2">
									<span class="font-medium">{inspectionLabels[i.type] ?? i.type}</span>
									<span class="text-muted-foreground">{formatDate(i.date)}</span>
								</div>
								{#if i.notes}
									<p class="text-muted-foreground mt-1">{i.notes}</p>
								{/if}
								<a
									href="/dashboard/inspections/{i.id}/print"
									class="text-ocean text-xs underline-offset-4 hover:underline"
								>
									View inspection report
								</a>
								</li>
							{/each}
						</ul>
					{/if}
				</CardContent>
			</Card>

			<!-- Maintenance -->
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2">
						<Wrench class="text-coral size-5" /> Maintenance requests
					</CardTitle>
					<CardDescription>Report an issue and track its status.</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-4">
					{#if form?.section === 'maintenance'}
						<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
					{/if}
					<form method="POST" action="?/createMaintenance" use:enhance class="flex flex-col gap-3">
						<div class="flex flex-col gap-2">
							<Label for="m-title">Title</Label>
							<Input id="m-title" name="title" placeholder="e.g. Kitchen faucet leaks" required />
						</div>
						<div class="flex flex-col gap-2">
							<Label for="m-desc">Description</Label>
							<Textarea id="m-desc" name="description" rows={2} required />
						</div>
						<Button type="submit" size="sm" class="self-end">Submit request</Button>
					</form>
					{#if data.maintenance.length > 0}
						<ul class="divide-y rounded-md border">
							{#each data.maintenance as m (m.id)}
								<li class="p-3 text-sm">
									<div class="flex items-center justify-between gap-2">
										<span class="font-medium">{m.title}</span>
										<StatusBadge status={m.status} />
									</div>
									<p class="text-muted-foreground mt-1">{m.description}</p>
								</li>
							{/each}
						</ul>
					{/if}
				</CardContent>
			</Card>
		</div>
	{/if}

	<!-- Messages -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<MessageSquare class="text-turquoise size-5" /> Messages
			</CardTitle>
			<CardDescription>Chat with the management team.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.section === 'messages'}
				<p class="bg-muted mb-3 rounded-md px-3 py-2 text-sm">{form.message}</p>
			{/if}
			<MessageThread
				messages={data.messages}
				currentUserId={data.user.id}
				recipientLabel={data.contact?.name || 'Management'}
			/>
		</CardContent>
	</Card>
</div>
