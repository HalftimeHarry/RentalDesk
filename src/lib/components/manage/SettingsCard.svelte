<script lang="ts">
	import type { HelpVideo, PropertyAccess, UnitSettings } from '$lib/types';
	import type { FormFeedback } from './ApplicantsCard.svelte';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { fileUrl } from '$lib/files';
	import HelpVideoDialog from '$lib/components/HelpVideoDialog.svelte';
	import { Check, ChevronDown, Copy, Eye, EyeOff, KeyRound, Settings, Trash2 } from '@lucide/svelte';

	let {
		settings,
		form,
		propertyAccess = [],
		helpVideos = []
	}: {
		settings: UnitSettings;
		form: FormFeedback;
		propertyAccess?: PropertyAccess[];
		helpVideos?: HelpVideo[];
	} = $props();

	let propertyAccessVideo = $derived(
		helpVideos.find(
			(v) =>
				v.slug === 'property-access-setup' &&
				v.active &&
				v.audience === 'admin' &&
				v.placement === 'manage_dashboard'
		) ?? null
	);
	let propertyAccessVideoOpen = $state(false);

	let accessDraft = $state({
		id: '',
		label: '',
		type: 'gate' as 'gate' | 'door_lockbox',
		property: '',
		unit: '',
		code: '',
		instructions: '',
		active: true
	});
	let hiddenAccess = $state<Record<string, boolean>>({});
	let copiedAccess = $state<Record<string, boolean>>({});

	function clearAccessDraft() {
		accessDraft = { id: '', label: '', type: 'gate', property: '', unit: '', code: '', instructions: '', active: true };
	}

	function startEditAccess(entry: PropertyAccess) {
		accessDraft = {
			id: entry.id,
			label: entry.label,
			type: entry.type,
			property: entry.property,
			unit: entry.unit,
			code: entry.code,
			instructions: entry.instructions,
			active: entry.active
		};
	}

	async function copyAccessValue(entry: PropertyAccess) {
		const text = `${entry.label}\nCode: ${entry.code}\n${entry.instructions ? `Instructions: ${entry.instructions}\n` : ''}${entry.type === 'gate' ? `Property: ${entry.property || 'All gated access'}` : `Unit: ${entry.unit || 'Not specified'}`}`;
		try {
			await navigator.clipboard.writeText(text);
			copiedAccess[entry.id] = true;
			window.setTimeout(() => {
				copiedAccess[entry.id] = false;
			}, 1800);
		} catch {
			copiedAccess[entry.id] = false;
		}
	}
</script>

<Card class="border-slate-200 bg-slate-50 shadow-sm">
	<details class="group block" open={false}>
		<summary class="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
			<div class="flex items-center justify-between gap-3 px-4 pt-4 text-left">
				<div class="flex items-center gap-2 font-semibold text-slate-900">
					<Settings class="text-turquoise size-5" /> Unit settings
				</div>
				<ChevronDown class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
			</div>
		</summary>
		<div class="px-4 pt-3">
			<p class="text-sm text-slate-600">
				Shown on the public landing page. Rent and deposit set the defaults for new leases.
			</p>
		</div>
		<CardContent class="px-4 pb-4">
			{#if form?.section === 'settings'}
				<p
					class={form.message?.toLowerCase().includes('error') || form.message?.toLowerCase().includes('failed') || form.message?.toLowerCase().includes('could not')
						? 'mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700'
						: 'mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'}
					aria-live="polite"
				>
					{form.message}
				</p>
			{/if}
			<form
				method="POST"
				action="?/updateSettings"
				enctype="multipart/form-data"
				use:enhance
				class="flex flex-col gap-4"
			>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-2">
						<Label for="s-name">Unit name</Label>
						<Input id="s-name" name="unit_name" required value={settings.unit_name} />
					</div>
					<div class="flex flex-col gap-2">
						<Label for="s-address">Address</Label>
						<Input id="s-address" name="address" value={settings.address} />
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="s-desc">Description</Label>
					<Textarea id="s-desc" name="description" rows={4} value={settings.description} />
				</div>
				<div class="grid gap-4 sm:grid-cols-3">
					<div class="flex flex-col gap-2">
						<Label for="s-rent">Monthly rent (USD)</Label>
						<Input
							id="s-rent"
							name="monthly_rent"
							inputmode="decimal"
							required
							value={(settings.monthly_rent_cents / 100).toFixed(2)}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="s-deposit">Security deposit (USD)</Label>
						<Input
							id="s-deposit"
							name="deposit"
							inputmode="decimal"
							required
							value={(settings.deposit_cents / 100).toFixed(2)}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="s-fee">Credit-check fee (USD)</Label>
						<Input
							id="s-fee"
							name="screening_fee"
							inputmode="decimal"
							required
							value={((settings.screening_fee_cents > 0 ? settings.screening_fee_cents : 3500) / 100).toFixed(2)}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="s-min">Minimum lease (months)</Label>
						<Input
							id="s-min"
							name="min_lease_months"
							type="number"
							min="1"
							required
							value={settings.min_lease_months}
						/>
					</div>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-2">
						<Label for="s-avail">Available after</Label>
						<Input id="s-avail" name="available_date" type="date" value={settings.available_date} />
					</div>
					<div class="flex flex-col self-end pb-2">
						<label class="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								name="is_available"
								value="true"
								class="size-4 accent-current"
								checked={settings.is_available}
							/>
							Listed as available
						</label>
						<p class="text-muted-foreground mt-1 text-[11px]">Click Save Settings to apply changes</p>
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="s-photos">Add listing photos (public on the landing page)</Label>
					<Input id="s-photos" name="photos" type="file" accept="image/jpeg,image/png" multiple />
					<p class="text-muted-foreground text-xs">
						New photos are appended to the current set. Only photos uploaded here are public —
						applicant and tenant documents always stay private.
					</p>
				</div>
				<Button type="submit" size="sm" class="w-fit">Save settings</Button>
			</form>

			{#if settings.photos.length > 0}
				<div class="mt-4 flex flex-col gap-2 border-t pt-4">
					<p class="text-sm font-medium">Current listing photos ({settings.photos.length})</p>
					<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
						{#each settings.photos as photo (photo)}
							<figure class="relative">
								<img
									src={fileUrl('settings', settings.id, photo)}
									alt=""
									class="aspect-square w-full rounded-md border object-cover"
								/>
								<form
									method="POST"
									action="?/deleteSettingPhoto"
									use:enhance
									class="absolute top-1 right-1"
								>
									<input type="hidden" name="filename" value={photo} />
									<Button
										type="submit"
										variant="destructive"
										size="icon"
										class="size-7"
										aria-label="Remove photo"
									>
										<Trash2 class="size-3.5" />
									</Button>
								</form>
							</figure>
						{/each}
					</div>
				</div>
			{/if}
		</CardContent>
	</details>

	<details class="group block" open={false}>
		<summary class="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
			<div class="flex items-center justify-between gap-3 px-4 pb-4 text-left">
				<div class="flex items-center gap-2 font-semibold text-slate-900">
					<KeyRound class="text-ocean size-5" /> Property access
				</div>
				<ChevronDown class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
			</div>
		</summary>
		<CardContent class="px-4 pb-4">
			<div class="mb-4 flex items-center gap-2">
				<KeyRound class="text-ocean size-5" />
				<p class="text-muted-foreground text-xs">Gate codes and lockbox entries for this property.</p>
			</div>
			{#if propertyAccessVideo}
				<div class="mb-4">
					<Button type="button" variant="outline" size="sm" class="min-h-9" onclick={() => (propertyAccessVideoOpen = true)}>
						Watch setup example
					</Button>
				</div>
				<HelpVideoDialog bind:open={propertyAccessVideoOpen} video={propertyAccessVideo} />
			{/if}
			{#if form?.section === 'property_access'}
				<p class="mb-3 rounded-md bg-emerald-100 px-3 py-2 text-sm text-emerald-900">{form.message}</p>
			{/if}

			<form method="POST" action="?/savePropertyAccess" class="grid gap-3 md:grid-cols-2">
				{#if accessDraft.id}
					<input type="hidden" name="id" value={accessDraft.id} />
				{/if}
				<label class="flex flex-col gap-1 text-sm">
					<span>Label</span>
					<Input name="label" value={accessDraft.label} required />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span>Type</span>
					<select name="type" bind:value={accessDraft.type} class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
						<option value="gate">Gate</option>
						<option value="door_lockbox">Door lockbox</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span>Property{accessDraft.type === 'gate' ? ' (required — exact listing address)' : ''}</span>
					<Input
						name="property"
						value={accessDraft.property}
						placeholder="Property address (as on the listing)"
						required={accessDraft.type === 'gate'}
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span>Unit{accessDraft.type === 'door_lockbox' ? ' (required — exact listing unit name)' : ''}</span>
					<Input
						name="unit"
						value={accessDraft.unit}
						placeholder="Unit / lockbox location"
						required={accessDraft.type === 'door_lockbox'}
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm md:col-span-2">
					<span>Code</span>
					<Input name="code" value={accessDraft.code} required />
				</label>
				<label class="flex flex-col gap-1 text-sm md:col-span-2">
					<span>Instructions</span>
					<Textarea name="instructions" rows={3} value={accessDraft.instructions} />
				</label>
				<label class="flex items-center gap-2 text-sm md:col-span-2">
					<input type="checkbox" name="active" checked={accessDraft.active} class="size-4 accent-current" />
					Active
				</label>
				<div class="flex flex-wrap items-center gap-2 md:col-span-2">
					<Button type="submit" class="min-h-11">{accessDraft.id ? 'Save entry' : 'Create entry'}</Button>
					{#if accessDraft.id}
						<Button type="button" variant="outline" class="min-h-11" onclick={clearAccessDraft}>Cancel</Button>
					{/if}
				</div>
			</form>

			<div class="mt-4 space-y-3">
				{#if propertyAccess.length === 0}
					<p class="text-muted-foreground text-sm">No property access entries yet.</p>
				{:else}
					{#each propertyAccess as entry (entry.id)}
						<div class="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div>
									<p class="font-semibold text-slate-900">{entry.label}</p>
									<p class="text-xs text-slate-500">{entry.type === 'gate' ? 'Gate access' : 'Door lockbox'}</p>
								</div>
								<div class="flex items-center gap-2">
									<Button type="button" variant="outline" size="sm" class="min-h-9" onclick={() => startEditAccess(entry)}>Edit</Button>
									<form method="POST" action="?/deletePropertyAccess" class="inline">
										<input type="hidden" name="id" value={entry.id} />
										<Button type="submit" variant="outline" size="sm" class="min-h-9 border-red-200 text-red-700 hover:bg-red-50">Delete</Button>
									</form>
								</div>
							</div>
							<div class="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
								{#if entry.property}<span class="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Property: {entry.property}</span>{/if}
								{#if entry.unit}<span class="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Unit: {entry.unit}</span>{/if}
								<span class="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{entry.active ? 'Active' : 'Inactive'}</span>
							</div>
							<div class="mt-3 flex items-center gap-2">
								<span class="text-sm font-medium text-slate-700">Code:</span>
								<span class="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-sm">
									{hiddenAccess[entry.id] ? '••••' : entry.code}
								</span>
								<Button type="button" variant="ghost" size="sm" class="min-h-9 px-2" onclick={() => (hiddenAccess[entry.id] = !hiddenAccess[entry.id])}>
									{#if hiddenAccess[entry.id]}
										<Eye class="size-4" />
									{:else}
										<EyeOff class="size-4" />
									{/if}
								</Button>
								<Button type="button" variant="ghost" size="sm" class="min-h-9 px-2" onclick={() => copyAccessValue(entry)}>
									{#if copiedAccess[entry.id]}
										<Check class="size-4" />
									{:else}
										<Copy class="size-4" />
									{/if}
								</Button>
							</div>
							{#if entry.instructions}
								<p class="mt-3 text-sm text-slate-600">{entry.instructions}</p>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</CardContent>
	</details>
</Card>
