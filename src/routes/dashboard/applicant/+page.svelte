<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardFooter,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import MessageThread from '$lib/components/MessageThread.svelte';
	import { docUrl, isImageFile } from '$lib/files';
	import { formatDate, toDateInput } from '$lib/format';
	import { FileText, Trash2, User, ClipboardList, MessageSquare } from '@lucide/svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let application = $derived(data.application);
	let editable = $derived(!application || application.status === 'draft');

	const kindLabels: Record<string, string> = {
		identification: 'Identification',
		income: 'Proof of income',
		application: 'Application',
		lease: 'Lease',
		inspection: 'Inspection',
		other: 'Other'
	};
</script>

<svelte:head>
	<title>Applicant dashboard — RentalDesk</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight text-white drop-shadow-sm">Applicant dashboard</h1>
		<p class="text-white/85 drop-shadow-sm">Welcome, {data.user.name || data.user.email}.</p>
	</div>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Contact details -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<User class="text-ocean size-5" /> Contact details
				</CardTitle>
				<CardDescription>How the management team can reach you.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if form?.section === 'contact'}
					<p class="bg-muted mb-3 rounded-md px-3 py-2 text-sm">{form.message}</p>
				{/if}
				<form method="POST" action="?/updateContact" use:enhance class="flex flex-col gap-4">
					<div class="flex flex-col gap-2">
						<Label for="c-name">Full name</Label>
						<Input id="c-name" name="name" required value={data.user.name} />
					</div>
					<div class="flex flex-col gap-2">
						<Label for="c-email">Email</Label>
						<Input id="c-email" value={data.user.email} disabled />
					</div>
					<div class="flex flex-col gap-2">
						<Label for="c-phone">Phone</Label>
						<Input id="c-phone" name="phone" type="tel" value={data.user.phone} />
					</div>
					<Button type="submit" size="sm" class="self-end">Save</Button>
				</form>
			</CardContent>
		</Card>

		<!-- Application -->
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between gap-2">
					<CardTitle class="flex items-center gap-2">
						<ClipboardList class="text-turquoise size-5" /> Application
					</CardTitle>
					{#if application}
						<StatusBadge status={application.status} />
					{/if}
				</div>
				<CardDescription>
					{#if !application}
						Fill out the form below to apply. You can save a draft first.
					{:else if application.status === 'draft'}
						Your draft is saved. Submit it when you're ready.
					{:else if application.submitted}
						Submitted {formatDate(application.submitted)}.
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{#if form?.section === 'application'}
					<p class="bg-muted mb-3 rounded-md px-3 py-2 text-sm">{form.message}</p>
				{/if}
				<form method="POST" action="?/saveApplication" use:enhance class="flex flex-col gap-4">
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-2">
							<Label for="full_name">Full name</Label>
							<Input
								id="full_name"
								name="full_name"
								required
								disabled={!editable}
								value={application?.full_name ?? data.user.name}
							/>
						</div>
						<div class="flex flex-col gap-2">
							<Label for="phone">Phone</Label>
							<Input
								id="phone"
								name="phone"
								type="tel"
								required
								disabled={!editable}
								value={application?.phone ?? data.user.phone}
							/>
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="current_address">Current address</Label>
						<Input
							id="current_address"
							name="current_address"
							disabled={!editable}
							value={application?.current_address ?? ''}
						/>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-2">
							<Label for="employer">Employer</Label>
							<Input
								id="employer"
								name="employer"
								disabled={!editable}
								value={application?.employer ?? ''}
							/>
						</div>
						<div class="flex flex-col gap-2">
							<Label for="monthly_income">Monthly income (USD)</Label>
							<Input
								id="monthly_income"
								name="monthly_income"
								inputmode="decimal"
								disabled={!editable}
								value={application ? (application.monthly_income_cents / 100).toString() : ''}
							/>
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="move_in_date">Desired move-in date</Label>
						<Input
							id="move_in_date"
							name="move_in_date"
							type="date"
							disabled={!editable}
							value={application?.move_in_date ?? ''}
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="notes">Notes for the landlord</Label>
						<Textarea
							id="notes"
							name="notes"
							rows={3}
							disabled={!editable}
							value={application?.notes ?? ''}
						/>
					</div>
					{#if editable}
						<div class="flex flex-wrap gap-2">
							<Button type="submit" variant="outline" size="sm">Save draft</Button>
						</div>
					{/if}
				</form>
			</CardContent>
			{#if editable && application}
				<CardFooter class="justify-between gap-2 border-t pt-4">
					<span class="text-muted-foreground text-sm">Ready? Submit for review.</span>
					<form method="POST" action="?/submitApplication" use:enhance>
						<Button type="submit" size="sm">Submit application</Button>
					</form>
				</CardFooter>
			{/if}
			{#if application?.status === 'denied' && application.review_notes}
				<CardFooter class="border-t pt-4">
					<p class="text-destructive text-sm">Review notes: {application.review_notes}</p>
				</CardFooter>
			{/if}
		</Card>
	</div>

	<!-- Documents -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<FileText class="text-gold size-5" /> Documents
			</CardTitle>
			<CardDescription>
				Upload identification, proof of income, or anything else requested. Multiple files are
				supported.
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			{#if form?.section === 'documents'}
				<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
			{/if}
			<form
				method="POST"
				action="?/uploadDocument"
				enctype="multipart/form-data"
				use:enhance
				class="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
			>
				<div class="flex flex-col gap-2">
					<Label for="doc-title">Title</Label>
					<Input id="doc-title" name="title" placeholder="e.g. Driver's license" required />
				</div>
				<div class="flex flex-col gap-2">
					<Label id="doc-kind-label">Type</Label>
					<Select.Root type="single" name="kind" value="identification">
						<Select.Trigger class="w-full" aria-labelledby="doc-kind-label">
							<Select.Value />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="identification">Identification</Select.Item>
							<Select.Item value="income">Proof of income</Select.Item>
							<Select.Item value="other">Other</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-2 sm:col-span-3">
					<Label for="doc-files">Files (PDF, JPEG, or PNG)</Label>
					<Input
						id="doc-files"
						name="files"
						type="file"
						accept="application/pdf,image/jpeg,image/png"
						multiple
						required
					/>
				</div>
				<Button type="submit" size="sm" class="sm:col-span-3 sm:w-fit">Upload</Button>
			</form>

			{#if data.documents.length > 0}
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
							<div class="min-w-0 flex-1">
								<a
									class="font-medium underline-offset-4 hover:underline"
									href={docUrl(doc.id, doc.file)}
									target="_blank"
									rel="noreferrer">{doc.title}</a
								>
								<p class="text-muted-foreground">
									{kindLabels[doc.kind] ?? doc.kind} · {formatDate(doc.created)}
								</p>
							</div>
							<form method="POST" action="?/deleteDocument" use:enhance>
								<input type="hidden" name="id" value={doc.id} />
								<Button type="submit" variant="ghost" size="icon" aria-label="Delete document">
									<Trash2 class="size-4" />
								</Button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</CardContent>
	</Card>

	<!-- Messages -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<MessageSquare class="text-turquoise size-5" /> Messages
			</CardTitle>
			<CardDescription>Chat with the management team about your application.</CardDescription>
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
