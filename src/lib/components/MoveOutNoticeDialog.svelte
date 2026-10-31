<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { daysBetween } from '$lib/files';
	import { formatDate } from '$lib/format';
	import { earliestMoveOutDate, MIN_NOTICE_DAYS, pacificToday } from '$lib/move-out-notice';
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

	// Pacific time, matching the server's authoritative validation.
	const today = pacificToday();
	const minDate = earliestMoveOutDate();

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
						min={minDate}
						required
						bind:value={requestedDate}
					/>
					<p class="text-muted-foreground text-xs">
						At least {MIN_NOTICE_DAYS} days' notice is required (Pacific time). Earliest selectable
						date: <span class="font-medium">{formatDate(minDate)}</span>.
					</p>
					{#if requestedDate}
						<p class={requestedDate < minDate ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
							{#if requestedDate < minDate}
								That's only {days} day{days === 1 ? '' : 's'} from today — choose {formatDate(minDate)} or later.
							{:else}
								That's {days} days' notice.
							{/if}
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
					<strong>Submitting this form is a request</strong> — it informs the management team of
					your intent. It does not approve early termination and does not change your lease
					automatically. Submitting in the app may not by itself satisfy California or San Diego
					legal notice or delivery requirements, and the date you choose does not override the
					fixed lease term or other notice requirements.
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
						disabled={submitting || !confirmed || !requestedDate || requestedDate < minDate || !signer.trim()}
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
