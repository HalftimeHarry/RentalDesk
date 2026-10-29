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
	import { docUrl, isImageFile } from '$lib/files';
	import { formatDate, formatMoney } from '$lib/format';
	import { billStatus } from '$lib/billing';
	import type { Charge, DocRecord } from '$lib/types';
	import { FileText, House, Receipt, Wallet, ClipboardCheck, Wrench, MessageSquare, ShieldCheck } from '@lucide/svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let lease = $derived(data.lease);
	let ledger = $derived(data.ledger);

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
		<!-- Balance summary -->
		<div class="grid gap-4 sm:grid-cols-3">
			<Card>
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
					<Receipt class="text-coral size-4" /> Rent balance
				</CardDescription>
					<CardTitle class="text-2xl">{formatMoney(ledger.rentBalance)}</CardTitle>
				</CardHeader>
				<CardContent class="text-muted-foreground text-sm">
					Charged {formatMoney(ledger.rentCharged)} · Paid {formatMoney(ledger.rentPaid)}
				</CardContent>
			</Card>
			<Card>
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
					<ShieldCheck class="text-turquoise size-4" /> Security deposit (tracked separately)
				</CardDescription>
					<CardTitle class="text-2xl">{formatMoney(ledger.depositPaid)}</CardTitle>
				</CardHeader>
				<CardContent class="text-muted-foreground text-sm">
					of {formatMoney(ledger.depositCharged)} required
				</CardContent>
			</Card>
			<Card>
				<CardHeader class="pb-2">
					<CardDescription class="flex items-center gap-1.5">
					<Wallet class="text-ocean size-4" /> Total balance due
				</CardDescription>
					<CardTitle class="text-2xl">{formatMoney(ledger.totalBalance)}</CardTitle>
				</CardHeader>
				<CardContent class="text-muted-foreground text-sm">Rent + deposit outstanding</CardContent>
			</Card>
		</div>

		<!-- Lease -->
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between gap-2">
					<CardTitle class="flex items-center gap-2">
						<House class="text-ocean size-5" /> Lease
					</CardTitle>
					<StatusBadge status={lease.status} />
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

		<!-- Charges -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Receipt class="text-coral size-5" /> Charges
				</CardTitle>
				<CardDescription>Itemized by calendar month. Partial months are prorated.</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Period</TableHead>
							<TableHead>Description</TableHead>
							<TableHead>Due</TableHead>
							<TableHead>Status</TableHead>
							<TableHead class="text-right">Amount</TableHead>
							<TableHead class="text-right">Remaining</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each data.charges as c (c.id)}
							{@const calcText = calcSummary(c)}
							{@const billDoc = billDocFor(c)}
							<TableRow>
								<TableCell>
									{#if c.period_start && c.period_end}
										{formatDate(c.period_start)} – {formatDate(c.period_end)}
									{:else}
										{c.period || '—'}
									{/if}
								</TableCell>
								<TableCell>
									{c.description}
									{#if calcText}
										<span class="text-muted-foreground block text-xs">{calcText}</span>
									{/if}
									{#if billDoc}
										<a
											href={docUrl(billDoc.id, billDoc.file)}
											target="_blank"
											rel="noreferrer"
											class="text-ocean flex items-center gap-1 text-xs underline-offset-4 hover:underline"
										>
											<FileText class="size-3" /> Bill attachment
										</a>
									{/if}
								</TableCell>
								<TableCell>{formatDate(c.due_date)}</TableCell>
								<TableCell><StatusBadge status={statusOf(c)} /></TableCell>
								<TableCell class="text-right font-medium">{formatMoney(c.amount_cents)}</TableCell>
								<TableCell class="text-right">{formatMoney(remainingOf(c))}</TableCell>
							</TableRow>
						{/each}
					</TableBody>
				</Table>
			</CardContent>
		</Card>

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
