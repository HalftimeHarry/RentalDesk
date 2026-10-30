<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { daysBetween } from '$lib/files';
	import { formatDate } from '$lib/format';
	import type { MoveOutNotice } from '$lib/types';
	import { LogOut, ShieldCheck } from '@lucide/svelte';

	/**
	 * "Give move-out notice" — short mobile-friendly form: prefilled tenant /
	 * property / unit, intended move-out date, optional forwarding address and
	 * notes, a live preview, and an explicit typed-name + checkbox confirmation.
	 * A fresh idempotency token per opening makes repeat clicks harmless.
	 * A correction (correctFrom) submits a NEW version; the original is preserved.
	 */
	let {
		open = $bindable(false),
		tenantName,
		address,
		unit,
		form = null,
		correctFrom = null
	}: {
		open: boolean;
		tenantName: string;
		address: string;
		unit: string;
		form?: { section?: string; message?: string } | null;
		correctFrom?: MoveOutNotice | null;
	} = $props();

	const today = new Date().toISOString().slice(0, 10);

	let requestedDate = $state('');
	let forwarding = $state('');
	let notes = $state('');
	let signer = $state('');
	let confirmed = $state(false);
	let clientToken = $state('');
	let submitting = $state(false);

	// (Re)initialize each time the dialog opens — blank for a new notice,
	// prefilled from the prior version for a correction.
	$effect(() => {
		if (!open) return;
		requestedDate = correctFrom?.requested_date?.slice(0, 10) ?? '';
		forwarding = correctFrom?.forwarding_address ?? '';
		notes = correctFrom?.notes ?? '';
		signer = tenantName;
		confirmed = false;
		clientToken = crypto.randomUUID();
	});

	let days = $derived(requestedDate ? daysBetween(today, requestedDate) : 0);

	let preview = $derived(
		[
			`Tenant(s): ${tenantName}`,
			`Property: ${address || '—'}${unit ? `, Unit ${unit}` : ''}`,
			'',
			`I intend to end my tenancy at the above unit on ${requestedDate ? formatDate(requestedDate) : '—'}.`,
			`Forwarding address: ${forwarding.trim() || 'Not provided'}`,
			notes.trim() ? `Notes: ${notes.trim()}` : ''
		]
			.filter((l) => l !== '')
			.join('\n')
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay />
		<Dialog.Content
			class="bg-card text-card-foreground mx-4 max-h-[85dvh] max-w-lg overflow-y-auto rounded-xl border p-6 shadow-lg"
		>
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					<LogOut class="text-coral size-5" /> Give move-out notice
				</Dialog.Title>
				<Dialog.Description>
					Tell the management team you intend to end your tenancy.{correctFrom
						? ' This correction is saved as a new version — the earlier notice stays on file unchanged.'
						: ''}
				</Dialog.Description>
			</Dialog.Header>

			<form
				method="POST"
				action="?/submitMoveOutNotice"
				use:enhance={() => {
					submitting = true;
					return async ({ result, update }) => {
						submitting = false;
						if (result.type === 'success') open = false;
						await update();
					};
				}}
				class="mt-4 flex flex-col gap-4"
			>
				<input type="hidden" name="client_token" value={clientToken} />
				{#if correctFrom}
					<input type="hidden" name="supersedes" value={correctFrom.id} />
				{/if}

				<dl class="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
					<div>
						<dt class="text-muted-foreground text-xs">Tenant(s)</dt>
						<dd class="font-medium">{tenantName}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground text-xs">Property</dt>
						<dd class="font-medium">{address || '—'}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground text-xs">Unit</dt>
						<dd class="font-medium">{unit || '—'}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground text-xs">Submitted</dt>
						<dd class="font-medium">{formatDate(today)}</dd>
					</div>
				</dl>

				<div class="flex flex-col gap-2">
					<Label for="mo-date">Intended move-out date</Label>
					<Input
						id="mo-date"
						name="requested_date"
						type="date"
						min={today}
						required
						bind:value={requestedDate}
					/>
					{#if requestedDate}
						<p class="text-muted-foreground text-xs">
							That's {days} day{days === 1 ? '' : 's'} from today{days >= 30
								? " — at least 30 days' notice."
								: ' — fewer than 30 days; your lease or local rules may require more notice.'}
						</p>
					{/if}
				</div>
				<div class="flex flex-col gap-2">
					<Label for="mo-forward">Forwarding address (if known)</Label>
					<Input
						id="mo-forward"
						name="forwarding_address"
						bind:value={forwarding}
						placeholder="Optional"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="mo-notes">Notes (optional)</Label>
					<Textarea id="mo-notes" name="notes" rows={2} bind:value={notes} />
				</div>

				<div class="bg-muted/60 flex flex-col gap-1 rounded-lg border p-3">
					<p class="text-muted-foreground text-xs font-medium">Notice preview</p>
					<p class="text-sm whitespace-pre-line">{preview}</p>
				</div>

				<p class="text-muted-foreground text-xs">
					Submitting in the app informs the management team; it may not by itself satisfy
					California or San Diego legal notice or delivery requirements. The date you choose
					does not override the fixed lease term or other notice requirements.
				</p>

				<div class="flex flex-col gap-2">
					<Label for="mo-signer">Type your full name to sign</Label>
					<Input id="mo-signer" name="signer_name" required bind:value={signer} />
				</div>
				<label class="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						name="confirm"
						required
						class="mt-0.5 size-4 accent-[#075985]"
						bind:checked={confirmed}
					/>
					I confirm this notice states my intention to end my tenancy on the date above.
				</label>

				{#if form?.section === 'notice'}
					<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
						{form.message}
					</p>
				{/if}

				<Dialog.Footer class="flex-col gap-2 sm:flex-row">
					<Button
						type="submit"
						class="min-h-12 w-full sm:w-auto"
						disabled={submitting || !confirmed || !requestedDate || !signer.trim()}
					>
						<ShieldCheck class="size-4" />
						{submitting ? 'Submitting…' : correctFrom ? 'Submit correction' : 'Submit notice'}
					</Button>
					<Dialog.Close
						class="min-h-12 w-full rounded-md border px-4 text-sm font-medium sm:w-auto"
					>
						Cancel
					</Dialog.Close>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
