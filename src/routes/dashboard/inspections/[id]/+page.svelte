<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { untrack } from 'svelte';
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
	import * as Select from '$lib/components/ui/select';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import {
		CONDITIONS,
		INSPECTION_SECTIONS,
		type ChecklistItem,
		type ConditionCode
	} from '$lib/inspection';
	import { docUrl, isImageFile, signedCopyUrl } from '$lib/files';
	import { formatDate, toDateInput } from '$lib/format';
	import { cn } from '$lib/utils';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import { page } from '$app/state';
	import {
		ArrowLeft,
		Camera,
		ChevronDown,
		ChevronsDownUp,
		ChevronsUpDown,
		Download,
		Flag,
		KeyRound,
		LoaderCircle,
		Mail,
		PenLine,
		Plus,
		Printer,
		Trash2,
		Upload,
		UserRound,
		X
	} from '@lucide/svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Local editable copy of the checklist; re-synced from the server record
	// whenever the record changes (after saves / photo removal).
	// svelte-ignore state_referenced_locally
	let checklist = $state<ChecklistItem[]>(structuredClone(data.checklist));
	// svelte-ignore state_referenced_locally
	let lastUpdated = $state(data.inspection.updated ?? '');
	$effect(() => {
		const updated = data.inspection.updated ?? '';
		if (updated !== lastUpdated) {
			lastUpdated = updated;
			untrack(() => {
				checklist = structuredClone(data.checklist);
				deductions = data.deductions.map((d) => ({
					description: d.description,
					amount: (d.amount_cents / 100).toFixed(2)
				}));
				dirty = false;
			});
		}
	});

	// Proposed deductions (deposit documentation) — dollars in the form, cents on the record.
	// svelte-ignore state_referenced_locally
	let deductions = $state<{ description: string; amount: string }[]>(
		data.deductions.map((d) => ({ description: d.description, amount: (d.amount_cents / 100).toFixed(2) }))
	);

	let finalized = $derived(data.inspection.stage === 'completed');
	let hasAnySignature = $derived(!!(data.inspection.sig_landlord || data.inspection.sig_tenant));
	let fullySigned = $derived(!!(data.inspection.sig_landlord && data.inspection.sig_tenant));
	let forkedParam = $derived(page.url.searchParams.get('forked') === '1');
	let revisedParam = $derived(page.url.searchParams.get('revised') === '1');

	// Signature capture state
	let landlordPad: SignaturePad | undefined = $state(undefined);
	let tenantPad: SignaturePad | undefined = $state(undefined);
	let landlordFile: HTMLInputElement | undefined = $state(undefined);
	let tenantFile: HTMLInputElement | undefined = $state(undefined);
	let dirty = $state(false);
	let sigError = $state('');
	// Which signature is currently being saved ('' = none). Set before the request
	// leaves so the UI shows immediate feedback and repeat taps are ignored.
	let sigPending = $state<'' | 'landlord' | 'tenant'>('');
	let canCompleteInspection = $derived(fullySigned && !finalized && !dirty);

	// Route every submission of the main form; signature posts get pending-state
	// tracking and keep the form un-reset on failure so the drawing and the
	// acknowledgement survive for a safe retry.
	const formEnhance: SubmitFunction = ({ action }) => {
		const signing: '' | 'landlord' | 'tenant' = action.search.includes('signLandlord')
			? 'landlord'
			: action.search.includes('signTenant')
				? 'tenant'
				: '';
		return async ({ result, update }) => {
			if (!signing) {
				await update();
				return;
			}
			if (result.type === 'error') {
				// Network/transport failure — nothing reached the server for sure.
				// Keep the drawing and inputs so the user can simply tap Sign again.
				sigPending = '';
				sigError =
					'Network problem — the signature was not saved. Check the connection and tap Sign again.';
				return;
			}
			// Success re-renders from the fresh record; failure keeps the form
			// (drawing included) intact for a retry with a visible server message.
			// Pending stays on until the reload lands so a tap in between can't
			// fire a duplicate submission.
			await update({ reset: result.type === 'success' });
			sigPending = '';
		};
	};

	function markDirty(e: Event) {
		// Typing in the signature card (names, etc.) must not mark content dirty.
		if ((e.target as HTMLElement).closest('[data-signing]')) return;
		dirty = true;
	}

	async function submitSignature(e: MouseEvent, who: 'landlord' | 'tenant') {
		e.preventDefault();
		if (sigPending) return; // a save is already in flight — ignore repeat taps
		sigError = '';
		const pad = who === 'landlord' ? landlordPad : tenantPad;
		const input = who === 'landlord' ? landlordFile : tenantFile;
		const btn = e.currentTarget as HTMLButtonElement;
		if (!pad || !input || !btn.form) return;
		sigPending = who; // immediate feedback before the (async) canvas export
		const file = await pad.toFile(`${who}-signature.png`);
		if (!file) {
			sigPending = '';
			sigError = 'Draw the signature in the box first.';
			return;
		}
		const dt = new DataTransfer();
		dt.items.add(file);
		input.files = dt.files;
		btn.form.requestSubmit(btn);
	}

	function signedAt(iso: string): string {
		return iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
	}

	const parties = ['landlord', 'tenant'] as const;
	// svelte-ignore state_referenced_locally
	let occupancy = $state(data.inspection.occupancy || 'occupied');

	// Receipt/estimate documents attached to this inspection.
	let receipts = $derived(Object.values(data.documents).filter((d) => d.kind === 'receipt'));

	// Editable side: move-out inspections edit the move-out column while the
	// move-in column stays read-only so the original condition is preserved.
	let editableSide: 'moveIn' | 'moveOut' = $derived(
		data.inspection.type === 'move_out' ? 'moveOut' : 'moveIn'
	);
	let readOnlySide: 'moveIn' | 'moveOut' = $derived(
		editableSide === 'moveIn' ? 'moveOut' : 'moveIn'
	);

	// Global item index aligns with the flattened checklist order.
	const sections = (() => {
		let idx = 0;
		return INSPECTION_SECTIONS.map((s) => ({
			section: s.section,
			items: s.items.map((name) => ({ name, idx: idx++ }))
		}));
	})();

	function setCondition(idx: number, side: 'moveIn' | 'moveOut', code: ConditionCode) {
		checklist[idx][side].condition = code;
	}

	// Sections start collapsed; several may stay open at once. Content is hidden,
	// never unmounted, so collapsing never clears fields or drops photo selections.
	let openSections = $state<boolean[]>(sections.map(() => false));
	function setAllSections(open: boolean) {
		openSections = sections.map(() => open);
	}

	// svelte-ignore state_referenced_locally
	let type = $state(data.inspection.type);

	const typeLabels: Record<string, string> = {
		move_in: 'Move-in',
		move_out: 'Move-out',
		periodic: 'Periodic'
	};
</script>

<svelte:head>
	<title>Inspection {formatDate(data.inspection.date)} — RentalDesk</title>
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
	<div class="flex flex-wrap items-center gap-2">
		<Button href="/dashboard/inspections" variant="outline" size="sm">
			<ArrowLeft class="size-4" /> Inspection history
		</Button>
		<div class="ml-auto flex gap-2">
			<Button href="/dashboard/inspections/{data.inspection.id}/print" variant="outline" size="sm">
				<Printer class="size-4" /> Print
			</Button>
			<Button href="/dashboard/inspections/{data.inspection.id}/print?pdf=1" variant="outline" size="sm">
				<Download class="size-4" /> Download PDF
			</Button>
		</div>
	</div>

	<!-- One continuous solid white surface: Inspection details through Signed copy -->
	<Card class="bg-card border-navy/10 shadow-md">
		<div class="flex flex-col gap-6 px-4 py-6 sm:px-6">
			{#if form?.section === 'inspection' || form?.section === 'signed'}
				<p
					class={cn(
						'rounded-md px-3 py-2 text-sm',
						form.message?.toLowerCase().includes('fail') ||
							form.message?.toLowerCase().includes('invalid') ||
							form.message?.toLowerCase().includes('could not') ||
							form.message?.toLowerCase().includes('not allowed') ||
							form.message?.toLowerCase().includes('required')
							? 'bg-destructive/10 text-destructive'
							: 'bg-turquoise/15 text-navy'
					)}
				>
					{form.message}
				</p>
			{/if}

			{#if finalized}
				<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm">
					This inspection is <strong>finalized</strong> — the record and its signed copy are
					preserved (read-only).{#if data.inspection.type === 'move_in'} Create the linked move-out
						comparison from Inspection history.{/if}
				</p>
			{:else if hasAnySignature}
				<div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
					<p class="text-navy font-medium">This signed inspection is locked for ordinary edits.</p>
					<p class="text-navy/80 mt-1">
						Create a revised inspection to update the content while preserving the signed version.
					</p>
					<form method="POST" action="?/createRevisionInspection" use:enhance class="mt-3">
						<Button type="submit" class="min-h-12">Create revised inspection</Button>
					</form>
				</div>
			{/if}

			<form
				method="POST"
				action="?/saveInspection"
				enctype="multipart/form-data"
				use:enhance={formEnhance}
				oninput={markDirty}
				class="contents"
			>
				<fieldset disabled={finalized || hasAnySignature} class="contents">
					<input type="hidden" name="checklist" value={JSON.stringify(checklist)} />

					<!-- Inspection details -->
					<section class="flex flex-col gap-4">
						<div>
							<h2 class="text-navy text-lg font-semibold">Inspection details</h2>
							<p class="text-muted-foreground text-sm">
								Created by {data.inspection.expand?.created_by?.name || 'management'} · {typeLabels[
									data.inspection.type
								] ?? data.inspection.type}
							</p>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-2 sm:col-span-2">
						<Label for="address">Property address</Label>
						<Input id="address" name="address" required value={data.inspection.address} />
					</div>
					<div class="flex flex-col gap-2">
						<Label for="unit">Unit</Label>
						<Input id="unit" name="unit" required value={data.inspection.unit} />
					</div>
						<div class="flex flex-col gap-2">
							<Label for="tenant_names">Tenant(s)</Label>
						<Input id="tenant_names" name="tenant_names" value={data.inspection.tenant_names} />
					</div>
					<div class="flex flex-col gap-2">
						<Label for="move_in_date">Move-in date (from lease)</Label>
						<Input
							id="move_in_date"
							name="move_in_date"
							type="date"
							value={toDateInput(data.inspection.move_in_date)}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="move_out_date">Move-out date (optional)</Label>
						<Input
							id="move_out_date"
							name="move_out_date"
							type="date"
							value={toDateInput(data.inspection.move_out_date)}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="date">Inspection date</Label>
						<Input id="date" name="date" type="date" required value={toDateInput(data.inspection.date)} />
					</div>
					<div class="flex flex-col gap-2">
						<Label for="type">Inspection type</Label>
						<Select.Root type="single" name="type" bind:value={type}>
							<Select.Trigger id="type" class="min-h-12 w-full">
								{typeLabels[type] ?? type}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="move_in">Move-in</Select.Item>
								<Select.Item value="move_out">Move-out</Select.Item>
								<Select.Item value="periodic">Periodic</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="notes">General notes (on report)</Label>
					<Textarea id="notes" name="notes" rows={2} value={data.inspection.notes} />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="manager_notes">
						Private manager notes <span class="text-coral">(never on tenant reports)</span>
					</Label>
					<Textarea
						id="manager_notes"
						name="manager_notes"
						rows={2}
					value={data.privateNote}
				/>
			</div>
			</section>
				<section class="border-navy/10 flex flex-col gap-4 border-t pt-5">
						<div>
							<h2 class="text-navy text-lg font-semibold">Checklist</h2>
							<p class="text-muted-foreground text-sm">
								Open a section and tap an item to describe a problem. Saved problems are marked O
								(Other condition). Leave other items unmarked.
							</p>
						</div>
						<div class="flex gap-2">
			<Button
				type="button"
				variant="outline"
				class="min-h-12 flex-1"
				onclick={() => setAllSections(true)}
			>
				<ChevronsUpDown class="size-4" /> Expand all
			</Button>
						<Button
							type="button"
							variant="outline"
							class="min-h-12 flex-1"
							onclick={() => setAllSections(false)}
						>
							<ChevronsDownUp class="size-4" /> Collapse all
						</Button>
					</div>
				</section>

						{#each sections as section, sIdx (section.section)}
							{@const oItems = section.items.filter(
								(i) => checklist[i.idx][editableSide].condition === 'other'
							)}
							<section class="border-navy/10 border-t pt-3">
								<button
									type="button"
									class={cn(
									'flex min-h-14 w-full items-center gap-2 rounded-lg px-3 py-3 text-left',
									sIdx % 2 === 0 ? 'bg-white' : 'bg-ocean/5'
								)}
									aria-expanded={openSections[sIdx]}
									aria-controls="insp-section-{sIdx}"
									onclick={() => (openSections[sIdx] = !openSections[sIdx])}
								>
					<ChevronDown
						class={cn(
							'text-navy size-5 shrink-0 transition-transform',
							!openSections[sIdx] && '-rotate-90'
						)}
					/>
					<span class="text-navy text-lg font-semibold">{section.section}</span>
					{#if oItems.length > 0}
						<span class="text-coral ml-1 text-sm font-semibold">
							· {oItems.length} issue{oItems.length === 1 ? '' : 's'}
						</span>
					{/if}
				</button>

								{#if !openSections[sIdx] && oItems.length > 0}
									<ul
										class="text-navy mb-3 flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
									>
						{#each oItems as item (item.idx)}
							<li>
								<span class="text-navy">{item.name}</span>
								<span class="text-red-700 dark:text-red-300"> — {checklist[item.idx][editableSide].comment || 'no comment'}</span>
							</li>
						{/each}
					</ul>
				{/if}

								<div id="insp-section-{sIdx}" hidden={!openSections[sIdx]} class="pb-4">
					<div class="flex flex-col gap-5">
					{#each section.items as item, i2 (item.idx)}
						{@const entry = checklist[item.idx]}
						{@const edit = entry[editableSide]}
						{@const reference = entry[readOnlySide]}
						{@const oChecked = edit.condition === 'other'}
						{@const legacyMark = edit.condition === 'ok' || edit.condition === 'na'}
						<fieldset
											class={cn(
												'flex flex-col gap-2 rounded-lg border p-3',
												i2 % 2 === 0 ? 'bg-white' : 'bg-stone-50'
											)}
										>
							<legend class="px-1 text-sm font-semibold">{item.name}</legend>

							{#if data.inspection.type === 'move_out' && (reference.condition !== 'not_reviewed' || reference.comment)}
								<p class="text-muted-foreground bg-muted rounded px-2 py-1 text-xs">
									Move-in: {CONDITIONS.find((c) => c.code === reference.condition)?.label}
									{#if reference.comment}— “{reference.comment}”{/if}
								</p>
							{/if}

							<label
								class={cn(
									'flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors',
									oChecked
										? 'border-coral bg-coral/10 text-navy shadow-sm'
										: 'border-navy/15 bg-card text-navy hover:border-navy/30 hover:bg-sand'
								)}
							>
								<input
									type="checkbox"
									class="size-5 accent-[#F97360]"
									checked={oChecked}
									onchange={() =>
										setCondition(item.idx, editableSide, oChecked ? 'not_reviewed' : 'other')}
								/>
								O — Other condition
							</label>
							{#if legacyMark}
								<p class="text-muted-foreground text-xs">
									Marked {CONDITIONS.find((c) => c.code === edit.condition)?.label} on an earlier
									version — kept as-is when saved.
								</p>
							{/if}

							{#if oChecked || edit.comment !== ''}
								<Input
									placeholder="Describe the condition (e.g. Hole in dining-room window screen)"
									aria-label="{item.name} comment"
									value={edit.comment}
									oninput={(e) => (edit.comment = e.currentTarget.value)}
								/>
								{#if oChecked}
									<p class="text-coral text-xs">
										O = Other condition requiring explanation.
									</p>
								{/if}
							{/if}

							<button
								type="button"
								aria-pressed={entry.flagged}
								onclick={() => (entry.flagged = !entry.flagged)}
								class={cn(
									'flex min-h-9 w-fit cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
									entry.flagged
										? 'border-coral bg-coral/15 text-navy'
										: 'border-navy/15 bg-card text-muted-foreground hover:border-coral/50'
								)}
							>
								<Flag class="size-3.5" />
								{entry.flagged ? 'Flagged for follow-up' : 'Flag for follow-up'}
							</button>

							<!-- Existing photos -->
							{#if edit.photos.length > 0}
								<div class="flex flex-wrap gap-2">
									{#each edit.photos as photoId (photoId)}
										{@const doc = data.documents[photoId]}
										{#if doc}
											<figure
												class="relative flex items-center gap-2 rounded-md border p-1.5 pr-8 text-xs"
											>
												{#if isImageFile(doc.file)}
													<img
														src="{docUrl(doc.id, doc.file)}?thumb=100x100"
														alt=""
														class="size-10 rounded border object-cover"
													/>
												{/if}
												<a
													href={docUrl(doc.id, doc.file)}
													target="_blank"
													rel="noreferrer"
													class="max-w-36 truncate underline-offset-4 hover:underline"
												>
													{doc.title}
												</a>
												<button
													type="submit"
													formaction="?/removeItemPhoto"
													formnovalidate
													name="document_id"
													value={doc.id}
													aria-label="Remove photo"
													class="text-destructive hover:bg-destructive/10 absolute top-1 right-1 rounded p-1"
												>
													<X class="size-3.5" />
												</button>
											</figure>
										{/if}
									{/each}
								</div>
							{/if}

							<!-- New photo attachments (uploaded on save) -->
							<div class="flex items-center gap-2">
								<Camera class="text-muted-foreground size-4 shrink-0" />
								<Input
									type="file"
									name="photo_{editableSide}_{item.idx}"
									accept="application/pdf,image/jpeg,image/png"
									multiple
									aria-label="{item.name} photos"
									class="text-xs"
								/>
							</div>
										</fieldset>
									{/each}
									</div>
								</div>
							</section>
						{/each}

						{#if !finalized && !hasAnySignature}
							<section class="border-navy/10 flex flex-col gap-2 border-t pt-5">
								<Button type="submit" formaction="?/saveDraft" variant="outline" class="min-h-12 w-full sm:max-w-xs">
									Save draft
								</Button>
							</section>
						{/if}

						<!-- Follow-ups & deposit documentation -->
						<section class="border-navy/10 flex flex-col gap-4 border-t pt-5">
							<div>
								<h2 class="text-navy flex items-center gap-2 text-lg font-semibold">
									<Flag class="text-coral size-5" /> Follow-ups &amp; deposit documentation
								</h2>
								<p class="text-muted-foreground text-sm">
									Flagged items, repair receipts/estimates, and proposed deductions. Proposed
									deductions are kept separate from recorded damage and are never applied to
									charges automatically.
								</p>
							</div>
					<input type="hidden" name="proposed_deductions" value={JSON.stringify(deductions)} />

					<div class="flex flex-col gap-1">
						<p class="text-sm font-medium">Flagged items</p>
						{#if checklist.some((c) => c.flagged)}
							<ul class="list-disc pl-5 text-sm">
								{#each checklist.filter((c) => c.flagged) as c (c.section + c.item)}
									<li>{c.section} → {c.item}</li>
								{/each}
							</ul>
						{:else}
							<p class="text-muted-foreground text-sm">
								No items flagged. Use “Flag for follow-up” on any checklist item.
							</p>
						{/if}
					</div>

					<div class="flex flex-col gap-2">
						<p class="text-sm font-medium">Proposed deductions (not applied automatically)</p>
						{#each deductions as d, di (di)}
							<div class="grid grid-cols-[1fr_auto_auto] items-end gap-2">
								<Input
									placeholder="Description (e.g. screen repair)"
									aria-label="Deduction description"
									value={d.description}
									oninput={(e) => (d.description = e.currentTarget.value)}
								/>
								<Input
									placeholder="0.00"
									inputmode="decimal"
									aria-label="Deduction amount (USD)"
									class="w-28"
									value={d.amount}
									oninput={(e) => (d.amount = e.currentTarget.value)}
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label="Remove deduction"
									onclick={() => deductions.splice(di, 1)}
								>
									<Trash2 class="size-4" />
								</Button>
							</div>
						{/each}
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="w-fit"
							onclick={() => deductions.push({ description: '', amount: '' })}
						>
							<Plus class="size-4" /> Add proposed deduction
						</Button>
					</div>

					<div class="flex flex-col gap-2">
						<p class="text-sm font-medium">Repair receipts / estimates</p>
						{#if receipts.length > 0}
							<div class="flex flex-wrap gap-2">
								{#each receipts as doc (doc.id)}
									<figure class="relative flex items-center gap-2 rounded-md border p-1.5 pr-8 text-xs">
										{#if isImageFile(doc.file)}
											<img
												src="{docUrl(doc.id, doc.file)}?thumb=100x100"
												alt=""
												class="size-10 rounded border object-cover"
											/>
										{/if}
										<a
											href={docUrl(doc.id, doc.file)}
											target="_blank"
											rel="noreferrer"
											class="max-w-36 truncate underline-offset-4 hover:underline"
										>{doc.title}</a
										>
										<button
											type="submit"
											formaction="?/removeItemPhoto"
											formnovalidate
											name="document_id"
											value={doc.id}
											aria-label="Remove receipt"
											class="text-destructive hover:bg-destructive/10 absolute top-1 right-1 rounded p-1"
										>
											<X class="size-3.5" />
										</button>
									</figure>
								{/each}
							</div>
						{/if}
						<Input
							type="file"
							name="receipts"
							accept="application/pdf,image/jpeg,image/png"
							multiple
							aria-label="Receipt or estimate files"
							class="text-xs"
						/>
						<p class="text-muted-foreground text-xs">Receipts upload when you save.</p>
					</div>
						</section>
				</fieldset>
				<!-- Signatures: inside the form but outside the (possibly disabled) content fieldset -->
				{#if !finalized}
				<section class="border-navy/10 flex flex-col gap-4 border-t pt-5" data-signing>
					<div>
						<h2 class="text-navy flex items-center gap-2 text-lg font-semibold">
							<PenLine class="text-ocean size-5" /> Signatures
						</h2>
						<p class="text-muted-foreground text-sm">
							Save the inspection and review the exact report together before signing.
							Signatures tie to this saved version — editing content afterwards creates a new
							unsigned revision while the signed version stays preserved.
						</p>
					</div>
					<div class="flex flex-col gap-6">
				{#if sigPending}
					<p
						class="bg-ocean/10 text-navy flex items-center gap-2 rounded-md px-3 py-2 text-sm"
						role="status"
						aria-live="assertive"
					>
						<LoaderCircle class="size-4 shrink-0 animate-spin" />
						Saving {sigPending} signature… This can take a few seconds — keep this page open and
						don't tap again.
					</p>
				{:else if form?.section === 'signatures'}
					<p
						class={cn(
							'rounded-md px-3 py-2 text-sm',
							page.status >= 400 ? 'bg-destructive/10 text-destructive' : 'bg-turquoise/15 text-navy'
						)}
						role="status"
						aria-live="polite"
					>
						{form.message}
					</p>
				{/if}
				{#if sigError}
					<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">{sigError}</p>
				{/if}
				{#if forkedParam || data.inspection.revision_of}
					<p class="border-ocean/30 bg-ocean/10 text-navy rounded-md border px-3 py-2 text-sm">
						This is a new unsigned revision — the previously signed version is preserved in the
						<a class="underline underline-offset-4" href="/dashboard/inspections/{data.inspection.revision_of}/record">
							inspection history</a
						>.
					</p>
				{/if}
				{#if dirty}
					<p class="text-navy rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
						You have unsaved changes — save the inspection first so both people sign the exact
						reviewed version.
					</p>
				{:else if hasAnySignature && !fullySigned}
					<p class="text-navy rounded-md border border-ocean/30 bg-ocean/10 px-3 py-2 text-sm">
						Waiting for the remaining signer: {data.inspection.sig_landlord ? 'Tenant' : 'Landlord'}.
					</p>
				{/if}

				{#each parties as constWho (constWho)}
					{@const who = constWho}
					{@const sigFile = who === 'landlord' ? data.inspection.sig_landlord : data.inspection.sig_tenant}
					{@const sigName = who === 'landlord' ? data.inspection.sig_landlord_name : data.inspection.sig_tenant_name}
					{@const sigAt = who === 'landlord' ? data.inspection.sig_landlord_at : data.inspection.sig_tenant_at}
					{@const sigMeta = who === 'landlord' ? data.inspection.sig_landlord_meta : data.inspection.sig_tenant_meta}
					<section class="flex flex-col gap-3 rounded-xl border p-4">
								<h3 class="text-navy flex items-center gap-2 font-semibold">
									{#if who === 'landlord'}
										<KeyRound class="text-ocean size-5" />
									{:else}
										<UserRound class="text-ocean size-5" />
									{/if}
									{who === 'landlord' ? 'Landlord' : 'Tenant'} signature
								</h3>
						{#if sigFile}
							<img
								src="/files/inspections/{data.inspection.id}/{sigFile}"
								alt="{who === 'landlord' ? 'Landlord' : 'Tenant'} signature"
								class="h-24 w-auto rounded-lg border bg-white object-contain"
							/>
							<p class="text-sm">
								Signed by <strong>{sigName}</strong> on {signedAt(sigAt)}
							</p>
							<p class="text-muted-foreground text-xs">{sigMeta}</p>
						{:else}
							<div class="flex flex-col gap-2">
								<Label for="{who}_name">Printed name</Label>
								<Input
									id="{who}_name"
									name="{who}_name"
									value={who === 'tenant' ? data.inspection.tenant_names : (data.inspection.expand?.created_by?.name ?? '')}
								/>
							</div>
							<label class="flex items-start gap-2 text-sm">
								<input
										type="checkbox"
										name="{who}_ack"
										class="mt-1 size-4 accent-[#075985]"
									/>
								<span>
									I acknowledge that I have reviewed this inspection record and agree with its
									contents.
								</span>
							</label>
							{#if who === 'landlord'}
								<SignaturePad label="Landlord signature" bind:this={landlordPad} disabled={dirty} />
								<input type="file" name="landlord_file" class="hidden" bind:this={landlordFile} tabindex="-1" aria-hidden="true" />
							{:else}
								<SignaturePad label="Tenant signature" bind:this={tenantPad} disabled={dirty} />
								<input type="file" name="tenant_file" class="hidden" bind:this={tenantFile} tabindex="-1" aria-hidden="true" />
								<p class="text-muted-foreground text-xs">
									Tenant signs in person on this device — no tenant login required.
								</p>
							{/if}
							<Button
								type="submit"
								formaction={who === 'landlord' ? '?/signLandlord' : '?/signTenant'}
								class="min-h-12"
								disabled={dirty || finalized || !!sigPending}
								aria-busy={sigPending === who}
								onclick={(e) => submitSignature(e, constWho)}
							>
								{#if sigPending === who}
									<LoaderCircle class="size-4 animate-spin" />
									Saving {who} signature…
								{:else}
									Sign as {who === 'landlord' ? 'Landlord' : 'Tenant'}
								{/if}
							</Button>
						{/if}
					</section>
				{/each}

						{#if fullySigned}
							<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm font-medium">
								Both signatures captured — this report is fully signed. Its content snapshot is
								preserved; further edits will create a new unsigned revision.
							</p>
						{/if}
					</div>
				</section>
				{/if}

				<!-- Actions: below the tenant signature section, above Signed Copy -->
				{#if !finalized}
					<section class="border-navy/10 flex flex-col gap-2 border-t pt-5 sm:flex-row">
						{#if !hasAnySignature}
							<Button type="submit" class="min-h-12 flex-1">Save inspection</Button>
						{/if}
						<Button
							type="submit"
							formaction="?/finalizeInspection"
							variant="secondary"
							class="min-h-12 flex-1"
							disabled={!canCompleteInspection}
							title={
								canCompleteInspection
									? 'Save and make this inspection read-only'
									: 'Both signatures must be saved before completion.'
							}
						>
							Complete inspection
						</Button>
					</section>
				{/if}
			</form>

			<!-- Signed copy -->
			<section class="border-navy/10 flex flex-col gap-4 border-t pt-5">
				<div>
					<h2 class="text-navy flex items-center gap-2 text-lg font-semibold">
						<Upload class="text-ocean size-5" /> Signed copy
					</h2>
					<p class="text-muted-foreground text-sm">
						Upload the signed paper inspection (PDF, JPEG, or PNG). Stored privately.
					</p>
				</div>
				<div class="flex flex-col gap-3">
			{#if data.inspection.signed_copy}
				<a
					class="text-ocean text-sm underline-offset-4 hover:underline"
					href={signedCopyUrl(data.inspection)}
					target="_blank"
					rel="noreferrer"
				>
					View current signed copy
				</a>
			{/if}
			{#if finalized}
				<p class="text-muted-foreground text-sm">
					Finalized — the signed copy is preserved and cannot be replaced.
				</p>
			{:else}
				<form
					method="POST"
					action="?/uploadSignedCopy"
					enctype="multipart/form-data"
					use:enhance
					class="flex flex-col gap-2 sm:flex-row sm:items-end"
				>
					<Input
						type="file"
						name="signed_copy"
						accept="application/pdf,image/jpeg,image/png"
						required
						class="flex-1"
						aria-label="Signed copy file"
					/>
					<Button type="submit" variant="outline" class="min-h-12">Upload signed copy</Button>
				</form>
			{/if}
				</div>
			</section>

			<!-- Email confirmation delivery -->
			<section class="border-navy/10 flex flex-col gap-4 border-t pt-5">
				<div>
					<h2 class="text-navy flex items-center gap-2 text-lg font-semibold">
						<Mail class="text-ocean size-5" /> Email confirmation
					</h2>
					<p class="text-muted-foreground text-sm">
						After the report is fully signed, a branded confirmation goes to the landlord and the
						tenant account linked through the lease. File tokens and private manager notes are
						never emailed.
					</p>
				</div>
				{#if form?.section === 'notify'}
					<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm">{form.message}</p>
				{/if}
				<div class="flex flex-col gap-1 text-sm">
					<p class="font-medium">Intended recipients</p>
					{#each data.recipientsPreview.recipients as r (r.role)}
						<p class="text-muted-foreground">
							{r.role === 'landlord' ? 'Landlord' : 'Tenant'} — {r.name}
						</p>
					{/each}
					{#each data.recipientsPreview.limitations as lim (lim)}
						<p class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">{lim}</p>
					{/each}
				</div>
				{#if data.notifications.length > 0}
					<ul class="divide-y rounded-md border text-sm">
						{#each data.notifications as n (n.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 p-3">
								<span>{n.name || (n.role === 'landlord' ? 'Landlord' : 'Tenant')} <span class="text-muted-foreground">({n.role})</span></span>
								<span class="flex items-center gap-2">
									<span class="text-muted-foreground text-xs">
										{n.status === 'sent' && n.sent_at ? `sent ${formatDate(n.sent_at)}` : n.attempts > 0 ? `${n.attempts} attempt(s)` : 'not attempted'}
									</span>
									<Badge variant={n.status === 'sent' ? 'success' : n.status === 'failed' ? 'destructive' : 'warning'}>{n.status}</Badge>
								</span>
							</li>
						{/each}
					</ul>
					{#if data.notifications.some((n) => n.status !== 'sent')}
						<form method="POST" action="?/resendInspectionNotice" use:enhance class="self-start">
							<Button type="submit" variant="outline" class="min-h-12">Retry pending/failed deliveries</Button>
						</form>
					{/if}
				{/if}
			</section>
		</div>
	</Card>
</div>
