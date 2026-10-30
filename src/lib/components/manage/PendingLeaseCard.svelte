<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import LeaseDetailsDialog from '$lib/components/LeaseDetailsDialog.svelte';
	import { formatDate, formatMoney } from '$lib/format';
	import type { Application, DocRecord, Lease } from '$lib/types';
	import type { PlannedCharge } from '$lib/server/billing';
	import { Check, Circle, Eye, FileSignature, House } from '@lucide/svelte';

	/**
	 * Pending lease panel: review the signed DocuSign packet and proposed move-in
	 * charges, then explicitly activate. Nothing here grants access, creates
	 * charges, or delists the unit until "Activate tenancy" is confirmed.
	 */
	let {
		lease,
		documents,
		application,
		proposedCharges,
		form
	}: {
		lease: Lease;
		documents: DocRecord[];
		application: Application | null;
		proposedCharges: PlannedCharge[];
		form: { section?: string; message?: string } | null | undefined;
	} = $props();

	const approved = $derived(application?.status === 'approved');
	const signedUploaded = $derived(documents.some((d) => d.kind === 'signed_lease'));
	const canActivate = $derived(approved && signedUploaded);
	const totalCents = $derived(proposedCharges.reduce((s, c) => s + c.amount_cents, 0));

	let leaseOpen = $state(false);
	let confirmOpen = $state(false);
</script>

<Card>
	<CardHeader>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<CardTitle class="flex items-center gap-2">
				<House class="text-ocean size-5" />
				Pending lease: {lease.expand?.tenant?.name || lease.expand?.tenant?.email || 'Applicant'}
			</CardTitle>
			<StatusBadge status="pending" />
		</div>
		<CardDescription>
			Created from the approved application — no Tenant access, charges, or listing change until
			activation.
		</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col gap-4">
		{#if form?.section === 'pending-lease'}
			<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
		{/if}

		<div class="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
			<span><strong> Tenant:</strong> {lease.expand?.tenant?.name || lease.expand?.tenant?.email}</span>
			<span>
				<strong>Dates:</strong> {formatDate(lease.start_date)} – {formatDate(lease.end_date)}
			</span>
			<span><strong>Rent:</strong> {formatMoney(lease.monthly_rent_cents)}/month</span>
			<span><strong>Deposit:</strong> {formatMoney(lease.deposit_cents)}</span>
		</div>

		<ul class="flex flex-col gap-2 text-sm">
			<li class="flex items-center gap-2">
				{#if approved}<Check class="size-4 text-emerald-600" />{:else}<Circle class="text-muted-foreground size-4" />{/if}
				Approved application{application ? ` (${application.status.replace('_', ' ')})` : ' (none found)'}
			</li>
			<li class="flex flex-wrap items-center gap-2">
				{#if signedUploaded}<Check class="size-4 text-emerald-600" />{:else}<Circle class="text-muted-foreground size-4" />{/if}
				Signed DocuSign packet uploaded
				<Button variant="outline" size="sm" class="min-h-12" onclick={() => (leaseOpen = true)}>
					<Eye class="size-4" /> Review / upload signed lease
				</Button>
			</li>
		</ul>

		<div class="rounded-lg border p-4">
			<p class="mb-2 text-sm font-medium">Proposed move-in charges (created as drafts at activation)</p>
			<ul class="flex flex-col gap-1 text-sm">
				{#each proposedCharges as c (c.due_date + c.description)}
					<li class="flex items-center justify-between gap-2">
						<span class="text-muted-foreground">{c.description} · due {formatDate(c.due_date)}</span>
						<span class="font-medium tabular-nums">{formatMoney(c.amount_cents)}</span>
					</li>
				{/each}
				<li class="mt-1 flex items-center justify-between gap-2 border-t pt-2 text-sm">
					<span class="font-medium">Total</span>
					<span class="font-semibold tabular-nums">{formatMoney(totalCents)}</span>
				</li>
			</ul>
		</div>

		<Button class="min-h-12 w-fit" disabled={!canActivate} onclick={() => (confirmOpen = true)}>
			<FileSignature class="size-4" /> Activate tenancy
		</Button>
		{#if !canActivate}
			<p class="text-muted-foreground -mt-2 text-xs">
				Activation requires an approved application and an uploaded signed lease.
			</p>
		{/if}
	</CardContent>
</Card>

<LeaseDetailsDialog bind:open={leaseOpen} {lease} {documents} canManage />

<Dialog.Root bind:open={confirmOpen}>
	<Dialog.Portal>
		<Dialog.Overlay />
		<Dialog.Content
			class="bg-card text-card-foreground max-h-[85dvh] w-full max-w-[calc(100%-2rem)] overflow-y-auto rounded-xl border p-6 shadow-lg sm:max-w-lg"
		>
			<Dialog.Header>
				<Dialog.Title>Activate tenancy?</Dialog.Title>
				<Dialog.Description>Confirm the details before granting access.</Dialog.Description>
			</Dialog.Header>
			<div class="mt-2 flex flex-col gap-3 text-sm">
				<ul class="flex flex-col gap-1 rounded-lg border p-3">
					<li><strong>Tenant:</strong> {lease.expand?.tenant?.name || lease.expand?.tenant?.email}</li>
					<li><strong>Dates:</strong> {formatDate(lease.start_date)} – {formatDate(lease.end_date)}</li>
					<li><strong>Rent:</strong> {formatMoney(lease.monthly_rent_cents)}/month</li>
					<li><strong>Deposit:</strong> {formatMoney(lease.deposit_cents)}</li>
					<li><strong>Move-in charges:</strong> {proposedCharges.length} draft charge(s), {formatMoney(totalCents)} total</li>
				</ul>
				<p class="text-muted-foreground">
					This activates the lease, grants Tenant access to
					{lease.expand?.tenant?.email || 'the applicant'}, creates the draft charges (publish them
					from Billing), and removes the listing. Safe to retry — existing charges are never
					duplicated.
				</p>
			</div>
			<Dialog.Footer class="mt-4 flex-col gap-2 sm:flex-row">
				<form
					method="POST"
					action="?/activateLease"
					use:enhance={() =>
						async ({ result, update }) => {
							await update();
							if (result.type === 'success') confirmOpen = false;
						}}
				>
					<input type="hidden" name="lease" value={lease.id} />
					<Button type="submit" class="min-h-12 w-full sm:w-auto">Confirm activation</Button>
				</form>
				<Dialog.Close class="min-h-12 rounded-md border px-4 text-sm font-medium">Cancel</Dialog.Close>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
