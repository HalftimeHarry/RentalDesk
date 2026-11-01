<script lang="ts">
	import type { PageData } from './$types';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { monthLabel } from '$lib/billing';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Separator } from '$lib/components/ui/separator';
	import HelpVideoDialog from '$lib/components/HelpVideoDialog.svelte';
	import { formatMoney, parseMoneyToCents } from '$lib/format';
	import type { Charge } from '$lib/types';
	import { ArrowLeft, HandCoins, Play } from '@lucide/svelte';

	let { data }: { data: PageData } = $props();

	const methodLabels: Record<string, string> = {
		zelle: 'Zelle',
		cash: 'Cash',
		check: 'Check',
		venmo: 'Venmo',
		bank_transfer: 'Bank transfer',
		other: 'Other'
	};

	const tenantName = $derived(data.lease.expand?.tenant?.name || 'Tenant');
	const backHref = $derived(`/dashboard/manage/billing?lease=${data.lease.id}`);

	function paidFor(id: string): number {
		return data.payments.filter((p) => p.charge === id).reduce((s, p) => s + p.amount_cents, 0);
	}
	function remainingOf(c: Charge): number {
		return Math.max(0, c.amount_cents - paidFor(c.id));
	}

	// Same targeting as the former dialog's monthly mode: the month's unpaid
	// published charges, oldest due first.
	const monthTargets = $derived(
		data.charges
			.filter(
				(c) =>
					c.period === data.month &&
					c.type !== 'deposit' &&
					c.status === 'published' &&
					remainingOf(c) > 0
			)
			.sort((a, b) => `${a.due_date}${a.created}`.localeCompare(`${b.due_date}${b.created}`))
	);
	const outstandingCents = $derived(monthTargets.reduce((s, c) => s + remainingOf(c), 0));
	const anchorId = $derived(monthTargets[0]?.id ?? '');

	let amount = $state('');
	let alloc = $state<Record<string, string>>({});
	let saving = $state(false);
	let errorMsg = $state('');
	let helpVideoOpen = $state(false);
	// Deep-link / recovery path (same pattern as the manage dashboard):
	// ?watch=<slug> opens the walkthrough on load, independent of the button's
	// client-side handler.
	let autoWatched = $state(false);
	$effect(() => {
		if (autoWatched || !data.helpVideo) return;
		if (page.url.searchParams.get('watch') === data.helpVideo.slug) {
			autoWatched = true;
			helpVideoOpen = true;
		}
	});

	// Default the amount to the full outstanding balance once targets are known.
	let initialized = $state(false);
	$effect(() => {
		if (!initialized && monthTargets.length > 0) {
			initialized = true;
			amount = (outstandingCents / 100).toFixed(2);
		}
	});

	// Propose the allocation (oldest due first, capped at each charge's
	// remaining) whenever the payment amount changes. Editable afterwards.
	$effect(() => {
		let left = parseMoneyToCents(amount) ?? 0;
		const next: Record<string, string> = {};
		for (const c of monthTargets) {
			const take = Math.min(remainingOf(c), Math.max(0, left));
			next[c.id] = (take / 100).toFixed(2);
			left -= take;
		}
		alloc = next;
	});

	const totalCents = $derived(parseMoneyToCents(amount) ?? 0);
	const allocatedCents = $derived(
		Object.values(alloc).reduce((s, v) => s + (parseMoneyToCents(v) ?? 0), 0)
	);
	const allocMismatch = $derived(allocatedCents !== totalCents);

	// Posts to the billing page's existing action — identical validation and
	// duplicate-payment safeguards. Success returns to billing with the lease
	// context preserved.
	const submit: SubmitFunction = () => {
		saving = true;
		errorMsg = '';
		return async ({ result }) => {
			saving = false;
			if (result.type === 'success') {
				await goto(backHref);
			} else if (result.type === 'failure') {
				errorMsg = (result.data as { message?: string })?.message ?? 'Save failed.';
			} else {
				errorMsg = 'Unexpected error while saving.';
			}
		};
	};
</script>

<svelte:head>
	<title>Record monthly payment — RentalDesk</title>
</svelte:head>

<div class="mb-6 flex flex-col gap-6">
	<div class="flex flex-wrap items-center gap-2">
		<Button href={backHref} variant="outline" size="sm" class="min-h-11">
			<ArrowLeft class="size-4" /> Billing
		</Button>
		<h1 class="text-2xl font-bold tracking-tight text-white drop-shadow-sm">
			Record monthly payment
		</h1>
	</div>
	<p class="font-medium text-white drop-shadow-sm">
		{tenantName} · {monthLabel(data.month)}
		{#if monthTargets.length > 0}
			· {monthTargets.length} unpaid charge{monthTargets.length === 1 ? '' : 's'} this month
		{/if}
	</p>

	{#if monthTargets.length === 0}
		<Card>
			<CardContent class="text-muted-foreground py-8 text-center text-sm">
				Nothing is outstanding for {monthLabel(data.month)} — every published charge this month is
				fully paid.
			</CardContent>
			<CardContent class="pt-0 text-center">
				<Button href={backHref} variant="outline" class="min-h-12">Back to billing</Button>
			</CardContent>
		</Card>
	{:else}
		<Card>
			<CardHeader>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<CardTitle class="flex items-center gap-2">
						<HandCoins class="text-turquoise size-5" /> Payment details
					</CardTitle>
					{#if data.helpVideo}
						<!-- type="button": never submits the payment form. -->
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="min-h-11"
							onclick={() => (helpVideoOpen = true)}
						>
							<Play class="size-4" /> Watch payment walkthrough
						</Button>
					{/if}
				</div>
				<CardDescription>
					Month outstanding: <strong>{formatMoney(outstandingCents)}</strong> — a full payment
					settles every listed charge in one action.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					method="POST"
					action="/dashboard/manage/billing?/recordPayment"
					use:enhance={submit}
					class="flex flex-col gap-4"
				>
					<input type="hidden" name="charge" value={anchorId} />

					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-2">
							<Label for="rp-amount">Payment amount (USD)</Label>
							<Input id="rp-amount" name="amount" inputmode="decimal" required bind:value={amount} />
						</div>
						<div class="flex flex-col gap-2">
							<Label for="rp-date">Payment date</Label>
							<Input id="rp-date" name="date" type="date" required value={data.today} />
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

					<div class="flex flex-col gap-2 rounded-lg border p-3">
						<p class="text-sm font-medium">Proposed allocation (confirm or adjust)</p>
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
						<Separator />
						<p class="text-sm {allocMismatch ? 'text-destructive' : 'text-muted-foreground'}">
							Allocated {formatMoney(allocatedCents)} of {formatMoney(totalCents)}
							{allocMismatch ? ' — allocations must add up to the payment amount' : '✓'}
						</p>
						<p class="text-muted-foreground text-xs">
							A partial payment leaves any unallocated amounts outstanding on their original
							charges — nothing is merged or rewritten.
						</p>
					</div>

					{#if errorMsg}
						<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">{errorMsg}</p>
					{/if}

					<div class="flex flex-col gap-2 sm:flex-row">
						<Button type="submit" class="min-h-12 flex-1" disabled={saving || allocMismatch}>
							{#if saving}Saving…{:else}Record payment{/if}
						</Button>
						<Button href={backHref} variant="outline" class="min-h-12 sm:flex-none">Cancel</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{/if}

	{#if data.helpVideo}
		<HelpVideoDialog bind:open={helpVideoOpen} video={data.helpVideo} />
	{/if}
</div>
