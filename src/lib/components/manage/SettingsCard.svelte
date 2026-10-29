<script lang="ts">
	import type { UnitSettings } from '$lib/types';
	import type { FormFeedback } from './ApplicantsCard.svelte';
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
	import { fileUrl } from '$lib/files';
	import { Settings, Trash2 } from '@lucide/svelte';

	let { settings, form }: { settings: UnitSettings; form: FormFeedback } = $props();
</script>

<Card>
	<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Settings class="text-turquoise size-5" /> Unit settings
			</CardTitle>
		<CardDescription>
			Shown on the public landing page. Rent and deposit set the defaults for new leases.
		</CardDescription>
	</CardHeader>
	<CardContent>
		{#if form?.section === 'settings'}
			<p class="bg-muted mb-3 rounded-md px-3 py-2 text-sm">{form.message}</p>
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
					<Label for="s-avail">Available from</Label>
					<Input id="s-avail" name="available_date" type="date" value={settings.available_date} />
				</div>
				<label class="flex items-center gap-2 self-end pb-2 text-sm">
					<input
						type="checkbox"
						name="is_available"
						class="size-4 accent-current"
						checked={settings.is_available}
					/>
					Listed as available
				</label>
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
</Card>
