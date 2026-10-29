<script lang="ts">
	import type {
		Application,
		DocRecord,
		Inspection,
		Lease,
		Ledger,
		Payment,
		UnitSettings
	} from '$lib/types';
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
	import * as Select from '$lib/components/ui/select';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { docUrl, isImageFile } from '$lib/files';
	import { formatDate, formatMoney } from '$lib/format';
	import { FileText, ClipboardCheck, House } from '@lucide/svelte';

	let {
		lease,
		ledger,
		inspections,
		leaseDocuments,
		approvedApplications,
		settings,
		today,
		form
	}: {
		lease: Lease | null;
		ledger: Ledger;
		inspections: Inspection[];
		leaseDocuments: DocRecord[];
		approvedApplications: Application[];
		settings: UnitSettings;
		today: string;
		form: FormFeedback;
	} = $props();
</script>

{#if !lease}
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<House class="text-ocean size-5" /> Create lease
			</CardTitle>
			<CardDescription>
				No active lease. Pick an approved applicant — the charge schedule (deposit + calendar-month
				rent with proration) is generated automatically, and the applicant becomes the Tenant.
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.section === 'lease'}
				<p class="bg-muted mb-3 rounded-md px-3 py-2 text-sm">{form.message}</p>
			{/if}
			{#if approvedApplications.length === 0}
				<p class="text-muted-foreground text-sm">
					No approved applications yet. Approve an application first.
				</p>
			{:else}
				<form method="POST" action="?/createLease" use:enhance class="flex flex-col gap-4">
					<div class="flex flex-col gap-2">
						<Label for="applicant">Approved applicant</Label>
						<Select.Root type="single" name="applicant" required>
							<Select.Trigger id="applicant" class="w-full">
								<Select.Value placeholder="Select applicant…" />
							</Select.Trigger>
							<Select.Content>
								{#each approvedApplications as app (app.id)}
									<Select.Item value={app.applicant}>
										{app.full_name || app.expand?.applicant?.name} ({app.expand?.applicant?.email})
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-2">
							<Label for="start_date">Start date</Label>
							<Input id="start_date" name="start_date" type="date" required />
						</div>
						<div class="flex flex-col gap-2">
							<Label for="end_date">End date</Label>
							<Input id="end_date" name="end_date" type="date" required />
						</div>
						<div class="flex flex-col gap-2">
							<Label for="monthly_rent">Monthly rent (USD)</Label>
							<Input
								id="monthly_rent"
								name="monthly_rent"
								inputmode="decimal"
								required
								value={(settings.monthly_rent_cents / 100).toFixed(2)}
							/>
						</div>
						<div class="flex flex-col gap-2">
							<Label for="deposit">Security deposit (USD)</Label>
							<Input
								id="deposit"
								name="deposit"
								inputmode="decimal"
								required
								value={(settings.deposit_cents / 100).toFixed(2)}
							/>
						</div>
					</div>
					<p class="text-muted-foreground text-sm">
						Minimum term: {settings.min_lease_months} months. First/last partial months are prorated
						by calendar day.
					</p>
					<Button type="submit" class="w-fit">Create lease &amp; generate charges</Button>
				</form>
			{/if}
		</CardContent>
	</Card>
{:else}
	<Card>
		<CardHeader>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle class="flex items-center gap-2">
					<House class="text-ocean size-5" />
					Current tenant: {lease.expand?.tenant?.name || lease.expand?.tenant?.email || 'Tenant'}
				</CardTitle>
				<StatusBadge status={lease.status} />
			</div>
			<CardDescription>
				{formatDate(lease.start_date)} – {formatDate(lease.end_date)} · {formatMoney(
					lease.monthly_rent_cents
				)}/month · deposit {formatMoney(lease.deposit_cents)}
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-6">
			<div class="grid gap-4 sm:grid-cols-3">
				<div class="rounded-lg border p-3">
					<p class="text-muted-foreground text-sm">Rent balance</p>
					<p class="text-xl font-semibold">{formatMoney(ledger.rentBalance)}</p>
					<p class="text-muted-foreground text-xs">
						Charged {formatMoney(ledger.rentCharged)} · Paid {formatMoney(ledger.rentPaid)}
					</p>
				</div>
				<div class="rounded-lg border p-3">
					<p class="text-muted-foreground text-sm">Deposit held</p>
					<p class="text-xl font-semibold">{formatMoney(ledger.depositPaid)}</p>
					<p class="text-muted-foreground text-xs">
						of {formatMoney(ledger.depositCharged)} required
					</p>
				</div>
				<div class="rounded-lg border p-3">
					<p class="text-muted-foreground text-sm">Total due</p>
					<p class="text-xl font-semibold">{formatMoney(ledger.totalBalance)}</p>
				</div>
			</div>

			{#if form?.section === 'payments'}
				<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
			{/if}
			<form
				method="POST"
				action="?/recordPayment"
				use:enhance
				class="grid items-end gap-3 rounded-lg border p-4 sm:grid-cols-5"
			>
				<input type="hidden" name="lease" value={lease.id} />
				<div class="flex flex-col gap-2">
					<Label for="p-amount">Amount (USD)</Label>
					<Input id="p-amount" name="amount" inputmode="decimal" required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="p-date">Date</Label>
					<Input id="p-date" name="date" type="date" value={today} required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="p-method">Method</Label>
					<Select.Root type="single" name="method" value="cash">
						<Select.Trigger id="p-method" class="w-full"><Select.Value /></Select.Trigger>
						<Select.Content>
							<Select.Item value="cash">Cash</Select.Item>
							<Select.Item value="check">Check</Select.Item>
							<Select.Item value="zelle">Zelle</Select.Item>
							<Select.Item value="venmo">Venmo</Select.Item>
							<Select.Item value="bank_transfer">Bank transfer</Select.Item>
							<Select.Item value="other">Other</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="p-applies">Applies to</Label>
					<Select.Root type="single" name="applies_to" value="rent">
						<Select.Trigger id="p-applies" class="w-full"><Select.Value /></Select.Trigger>
						<Select.Content>
							<Select.Item value="rent">Rent</Select.Item>
							<Select.Item value="deposit">Deposit</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="p-note">Note</Label>
					<Input id="p-note" name="note" placeholder="Optional" />
				</div>
				<Button type="submit" size="sm" class="sm:col-span-5 sm:w-fit">Record payment</Button>
			</form>

			{#if form?.section === 'charges'}
				<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
			{/if}
			<form
				method="POST"
				action="?/addCharge"
				use:enhance
				class="grid items-end gap-3 rounded-lg border p-4 sm:grid-cols-5"
			>
				<input type="hidden" name="lease" value={lease.id} />
				<div class="flex flex-col gap-2">
					<Label for="c-type">Type</Label>
					<Select.Root type="single" name="type" value="late_fee">
						<Select.Trigger id="c-type" class="w-full"><Select.Value /></Select.Trigger>
						<Select.Content>
							<Select.Item value="late_fee">Late fee</Select.Item>
							<Select.Item value="other">Other</Select.Item>
							<Select.Item value="rent">Rent (manual)</Select.Item>
							<Select.Item value="deposit">Deposit (manual)</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-2 sm:col-span-2">
					<Label for="c-desc">Description</Label>
					<Input id="c-desc" name="description" required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="c-amount">Amount (USD)</Label>
					<Input id="c-amount" name="amount" inputmode="decimal" required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="c-due">Due date</Label>
					<Input id="c-due" name="due_date" type="date" value={today} required />
				</div>
				<Button type="submit" size="sm" variant="outline" class="sm:col-span-5 sm:w-fit">
					Add charge
				</Button>
			</form>
		</CardContent>
	</Card>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Inspections -->
		<Card>
			<CardHeader>
			<div class="flex flex-wrap items-center justify-between gap-2">
					<CardTitle class="flex items-center gap-2">
						<ClipboardCheck class="text-ocean size-5" /> Inspections
					</CardTitle>
				<Button href="/dashboard/inspections" variant="outline" size="sm">
					Inspection history
				</Button>
			</div>
			<CardDescription>
				Schedule move-in, move-out, or periodic inspections — open one to fill the full
				nine-section form.
			</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-4">
				{#if form?.section === 'inspections'}
					<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
				{/if}
				<form
					method="POST"
					action="?/scheduleInspection"
					use:enhance
					class="grid items-end gap-3 sm:grid-cols-3"
				>
					<input type="hidden" name="lease" value={lease.id} />
					<div class="flex flex-col gap-2">
						<Label for="i-date">Date</Label>
						<Input id="i-date" name="date" type="date" required />
					</div>
					<div class="flex flex-col gap-2">
						<Label for="i-type">Type</Label>
						<Select.Root type="single" name="type" value="move_in">
							<Select.Trigger id="i-type" class="w-full"><Select.Value /></Select.Trigger>
							<Select.Content>
								<Select.Item value="move_in">Move-in</Select.Item>
								<Select.Item value="periodic">Periodic</Select.Item>
								<Select.Item value="move_out">Move-out</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="i-notes">Notes</Label>
						<Input id="i-notes" name="notes" placeholder="Optional" />
					</div>
					<Button type="submit" size="sm" variant="outline" class="sm:col-span-3 sm:w-fit">
						Schedule
					</Button>
				</form>
				{#if inspections.length > 0}
					<ul class="divide-y rounded-md border text-sm">
						{#each inspections as i (i.id)}
							<li class="flex items-center justify-between gap-2 p-3">
								<a
									href="/dashboard/inspections/{i.id}"
									class="font-medium capitalize underline-offset-4 hover:underline"
								>
									{i.type.replace('_', '-')}
								</a>
								<span class="text-muted-foreground">{formatDate(i.date)}</span>
							</li>
							{#if i.notes}
								<li class="text-muted-foreground px-3 pb-3 text-sm">{i.notes}</li>
							{/if}
						{/each}
					</ul>
				{/if}
			</CardContent>
		</Card>

		<!-- Lease documents -->
		<Card>
			<CardHeader>
					<CardTitle class="flex items-center gap-2">
						<FileText class="text-gold size-5" /> Lease documents
					</CardTitle>
				<CardDescription>Signed lease, addenda, and inspection reports.</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col gap-4">
				{#if form?.section === 'documents'}
					<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
				{/if}
				<form
					method="POST"
					action="?/uploadLeaseDocument"
					enctype="multipart/form-data"
					use:enhance
					class="grid items-end gap-3 sm:grid-cols-3"
				>
					<input type="hidden" name="lease" value={lease.id} />
					<div class="flex flex-col gap-2">
						<Label for="d-title">Title</Label>
						<Input id="d-title" name="title" required placeholder="e.g. Signed lease" />
					</div>
					<div class="flex flex-col gap-2">
						<Label for="d-kind">Type</Label>
						<Select.Root type="single" name="kind" value="lease">
							<Select.Trigger id="d-kind" class="w-full"><Select.Value /></Select.Trigger>
							<Select.Content>
								<Select.Item value="lease">Lease</Select.Item>
								<Select.Item value="inspection">Inspection</Select.Item>
								<Select.Item value="other">Other</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="d-files">Files (PDF, JPEG, or PNG)</Label>
						<Input
							id="d-files"
							name="files"
							type="file"
							accept="application/pdf,image/jpeg,image/png"
							multiple
							required
						/>
					</div>
					<Button type="submit" size="sm" variant="outline" class="sm:col-span-3 sm:w-fit">
						Upload
					</Button>
				</form>
				{#if leaseDocuments.length > 0}
					<ul class="divide-y rounded-md border text-sm">
						{#each leaseDocuments as doc (doc.id)}
							<li class="flex items-center gap-3 p-3">
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
				{/if}
			</CardContent>
		</Card>
	</div>

	<form method="POST" action="?/endLease" use:enhance class="self-start">
		<input type="hidden" name="id" value={lease.id} />
		{#if form?.section === 'lease'}
			<p class="bg-muted mb-2 rounded-md px-3 py-2 text-sm">{form.message}</p>
		{/if}
		<Button type="submit" variant="destructive" size="sm">
			End lease &amp; mark unit available
		</Button>
	</form>
{/if}
