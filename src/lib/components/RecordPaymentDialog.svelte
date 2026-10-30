<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { monthLabel } from '$lib/billing';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import * as Select from '$lib/components/ui/select';
	import { formatDate, formatMoney, parseMoneyToCents } from '$lib/format';
	import type { Charge, Payment } from '$lib/types';
	import { HandCoins } from '@lucide/svelte';

	let {
		open = $bindable(false),
		charge,
		month = null,
		charges,
		payments,
		tenantName,
		today
	}: {
		open: boolean;
		charge: Charge | null;
		/** Billing month (YYYY-MM) for monthly-payment mode; null for single-charge mode. */
		month?: string | null;
		charges: Charge[];
		payments: Payment[];
		tenantName: string;
		today: string;
	} = $props();

	const methodLabels: Record<string, string> = {
		zelle: 'Zelle',
		cash: 'Cash',
		check: 'Check',
		venmo: 'Venmo',
		bank_transfer: 'Bank transfer',
		other: 'Other'
	};

	function paidFor(id: string): number {
		return payments.filter((p) => p.charge === id).reduce((s, p) => s + p.amount_cents, 0);
	}
	function remainingOf(c: Charge): number {
		return Math.max(0, c.amount_cents - paidFor(c.id));
	}

	const monthMode = $derived(!!month);
	// Monthly mode targets: that month's unpaid published charges, oldest due first.
	const monthTargets = $derived(
		month
			? charges
					.filter(
						(c) =>
							c.period === month &&
							c.type !== 'deposit' &&
							c.status === 'published' &&
							remainingOf(c) > 0
					)
					.sort((a, b) =>
						`${a.due_date}${a.created}`.localeCompare(`${b.due_date}${b.created}`)
					)
			: []
	);

	let amount = $state('');
	let splitOn = $state(false);
	let selected = $state<Record<string, boolean>>({});
	let alloc = $state<Record<string, string>>({});
	let saving = $state(false);
	let error = $state('');

	// Reset the form whenever the dialog is opened for a different charge/month.
	let openedFor = $state('');
	$effect(() => {
		const key = month ? `m:${month}` : charge ? `c:${charge.id}` : '';
		if (open && key && key !== openedFor) {
			openedFor = key;
			error = '';
			splitOn = false;
			selected = {};
			if (month) {
				const total = monthTargets.reduce((s, c) => s + remainingOf(c), 0);
				amount = (total / 100).toFixed(2);
			} else if (charge) {
				const rem = (remainingOf(charge) / 100).toFixed(2);
				amount = rem;
				alloc = { [charge.id]: rem };
			}
		}
		if (!open) openedFor = '';
	});

	// Monthly mode: propose the allocation (oldest due first, capped at each
	// charge's remaining) whenever the payment amount changes. Editable after.
	$effect(() => {
		if (!open || !monthMode) return;
		let left = parseMoneyToCents(amount) ?? 0;
		const next: Record<string, string> = {};
		for (const c of monthTargets) {
			const take = Math.min(remainingOf(c), Math.max(0, left));
			next[c.id] = (take / 100).toFixed(2);
			left -= take;
		}
		alloc = next;
	});

	const splitCandidates = $derived(
		!monthMode && charge
			? charges.filter((c) => c.id !== charge.id && c.status === 'published' && remainingOf(c) > 0)
			: []
	);
	const totalCents = $derived(parseMoneyToCents(amount) ?? 0);
	const allocatedCents = $derived(
		Object.values(alloc).reduce((s, v) => s + (parseMoneyToCents(v) ?? 0), 0)
	);
	const showAllocation = $derived(monthMode || splitOn);
	const allocMismatch = $derived(showAllocation && allocatedCents !== totalCents);
	const anchorId = $derived(charge?.id ?? monthTargets[0]?.id ?? '');

	const submit: SubmitFunction = () => {
		saving = true;
		error = '';
		return async ({ result, update }) => {
			saving = false;
			if (result.type === 'success') {
				await update();
				open = false;
			} else if (result.type === 'failure') {
				error = (result.data as { message?: string })?.message ?? 'Save failed.';
			} else {
				error = 'Unexpected error while saving.';
			}
		};
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay />
		<Dialog.Content
			class="bg-card text-card-foreground max-h-[85dvh] w-full max-w-[calc(100%-2rem)] overflow-y-auto rounded-xl border p-6 shadow-lg sm:max-w-lg"
		>
			{#if charge || (month && monthTargets.length > 0)}
				<Dialog.Header>
					<Dialog.Title class="flex items-center gap-2">
						<HandCoins class="text-turquoise size-5" />
						{monthMode ? `Record monthly payment — ${monthLabel(month!)}` : 'Record payment'}
					</Dialog.Title>
					<Dialog.Description>
						{#if monthMode}
							{tenantName} · {monthTargets.length} unpaid charge{monthTargets.length === 1 ? '' : 's'} this
							month
						{:else if charge}
							{tenantName} · {charge.description}
							{#if charge.period_start}
								· period {formatDate(charge.period_start)} → {formatDate(charge.period_end)}
							{:else if charge.period}
								· {charge.period}
							{/if}
						{/if}
					</Dialog.Description>
				</Dialog.Header>

				{#if monthMode}
					<p class="mt-3 rounded-lg border p-3 text-sm">
						Month outstanding: <strong>{formatMoney(monthTargets.reduce((s, c) => s + remainingOf(c), 0))}</strong>
						<span class="text-muted-foreground">
							— a full payment settles every listed charge in one action</span
						>
					</p>
				{:else if charge}
					<p class="mt-3 rounded-lg border p-3 text-sm">
						Remaining on this charge: <strong>{formatMoney(remainingOf(charge))}</strong>
						<span class="text-muted-foreground"> of {formatMoney(charge.amount_cents)}</span>
					</p>
				{/if}

				<form method="POST" action="?/recordPayment" use:enhance={submit} class="mt-4 flex flex-col gap-4">
					<input type="hidden" name="charge" value={anchorId} />

					<div class="grid grid-cols-2 gap-3 sm:gap-4">
						<div class="flex flex-col gap-2">
							<Label for="rp-amount">Payment amount (USD)</Label>
							<Input id="rp-amount" name="amount" inputmode="decimal" required bind:value={amount} />
						</div>
						<div class="flex flex-col gap-2">
							<Label for="rp-date">Payment date</Label>
							<Input id="rp-date" name="date" type="date" required value={today} />
						</div>
						<div class="flex flex-col gap-2">
							<Label for="rp-method">Method</Label>
							<Select.Root type="single" name="method" value="zelle">
								<Select.Trigger id="rp-method" class="min-h-12 w-full">Zelle</Select.Trigger>
								<Select.Content>
									{#each Object.entries(methodLabels) as [value, label] (value)}
										<Select.Item {value}>{label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex flex-col gap-2">
							<Label for="rp-reference">Reference (optional)</Label>
							<Input id="rp-reference" name="reference" placeholder="Zelle confirmation #" />
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="rp-note">Note (optional)</Label>
						<Input id="rp-note" name="note" placeholder="e.g. received via Zelle, confirmed in bank" />
					</div>

					{#if !monthMode && splitCandidates.length > 0}
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" class="size-4 accent-[#075985]" bind:checked={splitOn} />
							This payment also covers other unpaid charges
						</label>
					{/if}

					{#if showAllocation}
						<div class="flex flex-col gap-2 rounded-lg border p-3">
							<p class="text-sm font-medium">
								{monthMode ? 'Proposed allocation (confirm or adjust)' : 'Allocation across charges'}
							</p>
							{#if monthMode}
								{#each monthTargets as c (c.id)}
									<div class="flex items-center justify-between gap-2 text-sm">
										<span class="min-w-0 flex-1 truncate">{c.description}</span>
										<span class="text-muted-foreground shrink-0 text-xs">
											≤ {formatMoney(remainingOf(c))}
										</span>
										<Input
											class="w-28"
											name="alloc-{c.id}"
											inputmode="decimal"
											required
											bind:value={alloc[c.id]}
										/>
									</div>
								{/each}
							{:else if charge}
								<div class="flex items-center justify-between gap-2 text-sm">
									<span class="min-w-0 flex-1 truncate">{charge.description}</span>
									<span class="text-muted-foreground shrink-0 text-xs">
										≤ {formatMoney(remainingOf(charge))}
									</span>
									<Input
										class="w-28"
										name="alloc-{charge.id}"
										inputmode="decimal"
										required
										bind:value={alloc[charge.id]}
									/>
								</div>
								{#each splitCandidates as c (c.id)}
									<div class="flex items-center justify-between gap-2 text-sm">
										<label class="flex min-w-0 flex-1 items-center gap-2">
											<input
												type="checkbox"
												class="size-4 shrink-0 accent-[#075985]"
												onchange={(e) => {
													selected[c.id] = e.currentTarget.checked;
													if (e.currentTarget.checked && !alloc[c.id])
														alloc[c.id] = (remainingOf(c) / 100).toFixed(2);
												}}
											/>
											<span class="truncate">{c.description}</span>
										</label>
										<span class="text-muted-foreground shrink-0 text-xs">
											≤ {formatMoney(remainingOf(c))}
										</span>
										{#if selected[c.id]}
											<Input
												class="w-28"
												name="alloc-{c.id}"
												inputmode="decimal"
												required
												bind:value={alloc[c.id]}
											/>
										{:else}
											<span class="text-muted-foreground w-28 text-right text-xs">—</span>
										{/if}
									</div>
								{/each}
							{/if}
							<Separator />
							<p class="text-sm {allocMismatch ? 'text-destructive' : 'text-muted-foreground'}">
								Allocated {formatMoney(allocatedCents)} of {formatMoney(totalCents)}
								{allocMismatch ? ' — allocations must add up to the payment amount' : '✓'}
							</p>
							{#if monthMode}
								<p class="text-muted-foreground text-xs">
									A partial payment leaves any unallocated amounts outstanding on their original
									charges — nothing is merged or rewritten.
								</p>
							{/if}
						</div>
					{/if}

					{#if error}
						<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">{error}</p>
					{/if}

					<Dialog.Footer class="flex-col gap-2 sm:flex-row">
						<Button type="submit" class="min-h-12 flex-1" disabled={saving || allocMismatch}>
							{#if saving}Saving…{:else}Record payment{/if}
						</Button>
						<Dialog.Close
							class="min-h-12 rounded-md border px-4 text-sm font-medium sm:flex-none"
						>
							Cancel
						</Dialog.Close>
					</Dialog.Footer>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
