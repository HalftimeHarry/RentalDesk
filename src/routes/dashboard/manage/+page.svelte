<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import ApplicantsCard from '$lib/components/manage/ApplicantsCard.svelte';
	import LeaseCard from '$lib/components/manage/LeaseCard.svelte';
	import PendingLeaseCard from '$lib/components/manage/PendingLeaseCard.svelte';
	import WorkflowGuideCard from '$lib/components/manage/WorkflowGuideCard.svelte';
	import HelpVideosCard from '$lib/components/manage/HelpVideosCard.svelte';
	import MaintenanceCard from '$lib/components/manage/MaintenanceCard.svelte';
	import SettingsCard from '$lib/components/manage/SettingsCard.svelte';
	import TeamCard from '$lib/components/manage/TeamCard.svelte';
	import UpcomingCard from '$lib/components/manage/UpcomingCard.svelte';
	import MessageThread from '$lib/components/MessageThread.svelte';
	import { formatMoney, formatDate } from '$lib/format';
	import { noticePdfUrl, daysBetween } from '$lib/files';
	import { signedInspectionCandidates, unfinishedInspectionCandidates } from '$lib/inspection';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import { buttonVariants } from '$lib/components/ui/button';
	import {
		CalendarClock,
		ClipboardList,
		LayoutDashboard,
		LogOut,
		MessageSquare,
		Receipt,
		Users,
		Wallet,
		Wrench
	} from '@lucide/svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let isOwner = $derived(data.user.role === 'owner');
	let pendingApplications = $derived(
		data.applications.filter((a) => a.status === 'submitted' || a.status === 'under_review').length
	);
	let openMaintenance = $derived(
		data.maintenance.filter((m) => m.status !== 'resolved').length
	);
	let approvedApplications = $derived(
		data.applications.filter((a) => a.status === 'approved')
	);
	let messageRecipients = $derived(
		data.allUsers
			.filter((u) => u.role === 'applicant' || u.role === 'tenant')
			.map((u) => ({
				id: u.id,
				label: `${u.name || u.email} (${u.role === 'tenant' ? 'Tenant' : 'Applicant'})`
			}))
	);

	// Inspection workflow: the card must continue the actual unfinished record for the
	// matching type, not merely the latest record by type. Signed records are for
	// review/completion, while completed/archived records are never treated as drafts.
	let unfinishedMoveIns = $derived(
		unfinishedInspectionCandidates(data.inspections, 'move_in')
	);
	let unfinishedMoveOuts = $derived(
		unfinishedInspectionCandidates(data.inspections, 'move_out')
	);
	let signedMoveIns = $derived(
		signedInspectionCandidates(data.inspections, 'move_in')
	);
	let signedMoveOuts = $derived(
		signedInspectionCandidates(data.inspections, 'move_out')
	);
	let moveIn = $derived(unfinishedMoveIns[0] ?? signedMoveIns[0] ?? null);
	let moveOut = $derived(unfinishedMoveOuts[0] ?? signedMoveOuts[0] ?? null);

	// Move-out notices: a notice is superseded when a newer version links to it;
	// originals are never edited.
	const supersededNoticeIds = $derived(
		new Set(data.moveOutNotices.map((n) => n.supersedes).filter(Boolean))
	);
	const activeNotices = $derived(data.moveOutNotices.filter((n) => !supersededNoticeIds.has(n.id)));
	const pendingNotices = $derived(activeNotices.filter((n) => n.status === 'submitted'));
	const latestNotice = $derived(activeNotices[0]);

</script>

<svelte:head>
	<title>Management dashboard — RentalDesk</title>
</svelte:head>

<div class="manage-panel bg-card text-card-foreground flex flex-col rounded-xl border shadow-lg">
        <div>
				<h1 class="text-navy flex items-center gap-2 text-2xl font-bold tracking-tight">
					<LayoutDashboard class="text-ocean size-6" />
                </h1>
                <p class="text-muted-foreground">
			{data.settings.unit_name} — management overview.
		</p>
	</div>

	{#if pendingNotices.length > 0}
		<p class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
			<LogOut class="mr-1 inline size-4 align-text-bottom" />
			Move-out notice received: {pendingNotices[0].tenant_names} requested{' '}
			{formatDate(pendingNotices[0].requested_date)} ({daysBetween(
				pendingNotices[0].submitted_at,
				pendingNotices[0].requested_date
			)} days' notice).{' '}
			<a href="#move-out-notice" class="font-medium underline-offset-4 hover:underline">
				Review the move-out notice below
			</a>.
		</p>
	{/if}

	<!-- Summary cards -->
	<div class="grid gap-4 lg:grid-cols-3">
		<Card>
			<CardHeader class="pb-2">
				<CardDescription class="flex items-center gap-1.5">
					<Wallet class="text-turquoise size-4" /> Balance due
				</CardDescription>
				<CardTitle class="text-2xl">{formatMoney(data.ledger.totalBalance)}</CardTitle>
			</CardHeader>
			<CardContent class="flex flex-col gap-3 text-sm">
				<span class={data.leaseError ? 'text-destructive' : 'text-muted-foreground'}>
					{data.leaseError
						? `Lease load failed: ${data.leaseError}`
						: data.activeLease
							? 'Active lease'
							: 'No active lease'} · {data.unpaidCharges.length} unpaid
				</span>
				<Dialog.Root>
					<Dialog.Trigger class={buttonVariants({ variant: 'outline', className: 'min-h-12 w-full' })}>
						Manage bills
					</Dialog.Trigger>
					<Dialog.Portal>
						<Dialog.Overlay />
						<Dialog.Content class="bg-card text-card-foreground mx-4 max-w-md rounded-xl border p-6 shadow-lg">
							<Dialog.Header>
								<Dialog.Title>Manage bills</Dialog.Title>
								<Dialog.Description>
									{data.activeLease?.expand?.tenant?.name || 'No tenant'} ·{' '}
									{#if data.activeLease}
										{formatDate(data.activeLease.start_date)} – {formatDate(data.activeLease.end_date)}
									{/if}
								</Dialog.Description>
							</Dialog.Header>
							{#if data.unpaidCharges.length === 0}
								<p class="text-muted-foreground py-2 text-sm">No unpaid published charges.</p>
							{:else}
								<ul class="flex max-h-64 flex-col gap-2 overflow-y-auto py-2">
									{#each data.unpaidCharges as c (c.id)}
										<li class="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
											<div>
												<p class="font-medium">{c.description}</p>
												<p class="text-muted-foreground text-xs">
													due {formatDate(c.due_date)} · remaining{' '}
													{formatMoney(c.amount_cents - c.paid_cents)}
												</p>
											</div>
											<span class="font-medium">{formatMoney(c.amount_cents)}</span>
										</li>
									{/each}
								</ul>
							{/if}
							<Dialog.Footer class="flex-col items-center gap-2">
								<Button href="/dashboard/manage/billing" class="min-h-12 w-full sm:w-auto">
									<Receipt class="size-4" /> Open billing workspace
								</Button>
								<Dialog.Close class={buttonVariants({ variant: 'outline', className: 'min-h-12 w-full sm:w-auto' })}>
									Close
								</Dialog.Close>
							</Dialog.Footer>
						</Dialog.Content>
					</Dialog.Portal>
				</Dialog.Root>
			</CardContent>
		</Card>
		<Card class="tile bg-seafoam/50! lg:col-span-2">
			<CardHeader class="pb-2">
				<CardTitle class="flex items-center gap-2">
					<LayoutDashboard class="text-ocean size-5" /> Overview
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div class="grid sm:grid-cols-3">
					<div class="pb-4 sm:pr-5 sm:pb-0">
						<p class="text-muted-foreground flex items-center gap-1.5 text-sm">
							<Users class="text-ocean size-4" /> Pending applications
						</p>
						<p class="mt-1 text-2xl leading-none font-semibold">{pendingApplications}</p>
						<p class="text-muted-foreground mt-1 text-sm">{data.applications.length} total</p>
					</div>
					<div class="border-border border-y py-4 sm:border-x sm:border-y-0 sm:px-5 sm:py-0">
						<p class="text-muted-foreground flex items-center gap-1.5 text-sm">
							<Wrench class="text-coral size-4" /> Open maintenance
						</p>
						<p class="mt-1 text-2xl leading-none font-semibold">{openMaintenance}</p>
						<p class="text-muted-foreground mt-1 text-sm">
							{data.maintenance.length} total requests
						</p>
					</div>
					<div class="pt-4 sm:pl-5 sm:pt-0">
						<p class="text-muted-foreground flex items-center gap-1.5 text-sm">
							<CalendarClock class="text-gold size-4" /> Upcoming dates
						</p>
						<p class="mt-1 text-2xl leading-none font-semibold">{data.upcoming.length}</p>
						<p class="text-muted-foreground mt-1 text-sm">Next 60 days</p>
					</div>
				</div>
			</CardContent>
		</Card>
	</div>

	<!-- Inspection report: the primary action follows the saved workflow stage.
		The stage field stays internal — no selector on this card. -->
	<Card class="border-ocean/30">
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<ClipboardList class="text-ocean size-5" /> Inspection Report
			</CardTitle>
			<CardDescription>
				Property-condition record with the nine-section checklist — move-in, move-out, and
				vacant-unit inspections.
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-3">
			{#if unfinishedMoveIns.length > 0}
				{#if unfinishedMoveIns.length === 1}
					<p class="text-muted-foreground text-sm">
						The move-in inspection is saved and awaiting {unfinishedMoveIns[0].sig_landlord || unfinishedMoveIns[0].sig_tenant
							? 'one more signature'
							: 'landlord and tenant signatures'}.
					</p>
					<div>
						<Button
							href="/dashboard/inspections/{unfinishedMoveIns[0].id}"
							size="lg"
							class="min-h-12 w-full sm:w-auto"
						>
							<ClipboardList class="size-5" /> Continue move-in inspection
						</Button>
					</div>
				{:else}
					<p class="text-muted-foreground text-sm">
						Multiple unfinished move-in inspections exist for this lease. Choose the draft to continue.
					</p>
					<div class="flex flex-col gap-2">
						{#each unfinishedMoveIns as inspection (inspection.id)}
							<Button
								href="/dashboard/inspections/{inspection.id}"
								variant="outline"
								class="min-h-12 w-full justify-start text-left sm:w-auto"
							>
								<ClipboardList class="size-5" />
								Continue move-in inspection — {inspection.tenant_names || 'Tenant'} · Unit {inspection.unit || '—'} · {formatDate(
									inspection.date
								)}
							</Button>
						{/each}
					</div>
				{/if}
			{:else if signedMoveIns.length > 0 && !unfinishedMoveIns.length}
				<p class="text-muted-foreground text-sm">
					The move-in inspection is fully signed and preserved. Starting move-out creates a
					separate draft with blank signatures and the move-in conditions attached for
					comparison.
				</p>
				<form method="POST" action="/dashboard/inspections?/createInspection">
					<input type="hidden" name="lease" value={data.activeLease?.id ?? ''} />
					<input type="hidden" name="type" value="move_out" />
					<Button
						type="submit"
						size="lg"
						class="min-h-12 w-full border-transparent bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
					>
						<ClipboardList class="size-5" /> Start move-out inspection
					</Button>
				</form>
			{:else if unfinishedMoveOuts.length > 0}
				{#if unfinishedMoveOuts.length === 1}
					<p class="text-muted-foreground text-sm">
						The move-out inspection is saved and awaiting {unfinishedMoveOuts[0].sig_landlord || unfinishedMoveOuts[0].sig_tenant
							? 'one more signature'
							: 'landlord and tenant signatures'}.
					</p>
					<div>
						<Button
							href="/dashboard/inspections/{unfinishedMoveOuts[0].id}"
							size="lg"
							class="min-h-12 w-full sm:w-auto"
						>
							<ClipboardList class="size-5" /> Continue move-out inspection
						</Button>
					</div>
				{:else}
					<p class="text-muted-foreground text-sm">
						Multiple unfinished move-out inspections exist for this lease. Choose the draft to continue.
					</p>
					<div class="flex flex-col gap-2">
						{#each unfinishedMoveOuts as inspection (inspection.id)}
							<Button
								href="/dashboard/inspections/{inspection.id}"
								variant="outline"
								class="min-h-12 w-full justify-start text-left sm:w-auto"
							>
								<ClipboardList class="size-5" />
								Continue move-out inspection — {inspection.tenant_names || 'Tenant'} · Unit {inspection.unit || '—'} · {formatDate(
									inspection.date
								)}
							</Button>
						{/each}
					</div>
				{/if}
			{:else if signedMoveOuts.length > 0 && !unfinishedMoveOuts.length}
				<p class="text-muted-foreground text-sm">
					The move-out inspection is fully signed and preserved.
				</p>
				<div>
					<Button
						href="/dashboard/inspections/{signedMoveOuts[0].id}"
						size="lg"
						class="min-h-12 w-full sm:w-auto"
					>
						<ClipboardList class="size-5" /> Review signed move-out report
					</Button>
				</div>
			{:else if signedMoveIns.length > 0 && signedMoveOuts.length > 0}
				<p class="text-muted-foreground text-sm">
					The move-in and move-out reports are both fully signed and preserved.
				</p>
			{:else}
				<div>
					<Button
						href="/dashboard/inspections"
						size="lg"
						class="min-h-12 w-full border-transparent bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
					>
						<ClipboardList class="size-5" /> Open inspection report
					</Button>
				</div>
			{/if}
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
				{#if moveIn?.stage === 'signed'}
					<a
						href="/dashboard/inspections/{moveIn.id}"
						class="text-ocean font-medium underline-offset-4 hover:underline"
					>
						View signed move-in report
					</a>
				{/if}
				{#if moveOut?.stage === 'signed'}
					<a
						href="/dashboard/inspections/{moveOut.id}"
						class="text-ocean font-medium underline-offset-4 hover:underline"
					>
						View signed move-out report
					</a>
				{/if}
				<a
					href="/dashboard/inspections"
					class="text-ocean font-medium underline-offset-4 hover:underline"
				>
					Inspection history
				</a>
			</div>
		</CardContent>
	</Card>

	<!-- Move-out notice: tenant-submitted intent to end the tenancy. The requested
		date is never treated as approved; lease, rent, and deductions are unchanged. -->
	<Card id="move-out-notice">
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<LogOut class="text-coral size-5" /> Move-out notice
			</CardTitle>
			<CardDescription>
				The tenant's requested date is not approved until you record an agreed termination
				date — the notice itself does not end the lease, stop rent, or set deductions.
			</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			{#if form?.section === 'notice'}
				<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm">{form.message}</p>
			{/if}
			{#if !latestNotice}
				<p class="text-muted-foreground text-sm">No move-out notice received.</p>
			{:else}
				{@const n = latestNotice}
				<div class="flex flex-col gap-2">
					<p class="text-navy text-lg font-semibold">
						Requested move-out: {formatDate(n.requested_date)}
					</p>
					<p class="text-muted-foreground text-sm">
						{n.tenant_names} · submitted {formatDate(n.submitted_at)} ·{' '}
						{daysBetween(n.submitted_at, n.requested_date)} days' notice
					</p>
					<p class="text-sm">Forwarding address: {n.forwarding_address || 'Not provided'}</p>
					{#if n.notes}
						<p class="text-muted-foreground text-sm">Notes: {n.notes}</p>
					{/if}
					<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
						{#if n.notice_pdf}
							<a
								href={noticePdfUrl(n.id, n.notice_pdf)}
								target="_blank"
								rel="noreferrer"
								class="text-ocean font-medium underline-offset-4 hover:underline">View notice PDF</a
							>
							<a
								href="{noticePdfUrl(n.id, n.notice_pdf)}?download=1"
								class="text-ocean font-medium underline-offset-4 hover:underline">Download</a
							>
						{/if}
					</div>
					{#if n.status === 'submitted'}
						<form method="POST" action="?/acknowledgeNotice">
							<input type="hidden" name="id" value={n.id} />
							<Button type="submit" variant="outline" class="min-h-12">Acknowledge receipt</Button>
						</form>
					{:else}
						<p class="text-sm">
							<span class="rounded bg-emerald-200 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-900">
								Acknowledged
							</span>
							<span class="text-muted-foreground text-xs"> on {formatDate(n.acknowledged_at)}</span>
						</p>
					{/if}
					<form method="POST" action="?/recordTerminationDate" class="flex flex-wrap items-end gap-2">
						<input type="hidden" name="id" value={n.id} />
						<label class="flex flex-col gap-1 text-xs">
							Agreed termination date (recorded separately)
							<Input
								type="date"
								name="agreed_termination_date"
								value={n.agreed_termination_date?.slice(0, 10) ?? ''}
								class="w-48"
							/>
						</label>
						<Button type="submit" variant="outline" size="sm" class="min-h-12">Save date</Button>
					</form>
					<!-- Same linked-inspection workflow as the Inspection Report card. -->
					<form method="POST" action="/dashboard/inspections?/createInspection">
						<input type="hidden" name="lease" value={data.activeLease?.id ?? ''} />
						<input type="hidden" name="type" value="move_out" />
						<Button
							type="submit"
							size="lg"
							class="min-h-12 w-full border-transparent bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
						>
							<ClipboardList class="size-5" /> Start move-out inspection
						</Button>
					</form>
				</div>
				{#if data.moveOutNotices.length > 1}
					<details class="text-sm">
						<summary class="text-muted-foreground cursor-pointer">
							Version history ({data.moveOutNotices.length})
						</summary>
						<ul class="mt-1 divide-y rounded-md border">
							{#each data.moveOutNotices as v (v.id)}
								<li class="flex flex-wrap items-center justify-between gap-2 p-2">
									<span>
										Move-out {formatDate(v.requested_date)} · submitted{' '}
										{formatDate(v.submitted_at)}
										{#if supersededNoticeIds.has(v.id)}
											<span class="text-muted-foreground"> · superseded</span>
										{/if}
									</span>
									{#if v.notice_pdf}
										<a
											href={noticePdfUrl(v.id, v.notice_pdf)}
											target="_blank"
											rel="noreferrer"
											class="text-ocean text-xs underline-offset-4 hover:underline">View</a
										>
									{/if}
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			{/if}
		</CardContent>
	</Card>

	<div class="grid gap-6 lg:grid-cols-2">
		<ApplicantsCard applications={data.applications} {form} />
		<WorkflowGuideCard
			applications={data.applications}
			lease={data.activeLease ?? data.pendingLease}
			leaseDocuments={data.activeLease ? data.leaseDocuments : data.pendingLeaseDocuments}
			charges={data.charges}
			inspections={data.inspections}
		/>
		<div class="flex flex-col gap-6">
			<UpcomingCard upcoming={data.upcoming} />
			<MaintenanceCard maintenance={data.maintenance} {form} />
			<HelpVideosCard videos={data.helpVideos} />
		</div>
	</div>

	{#if data.pendingLease}
		<PendingLeaseCard
			lease={data.pendingLease}
			documents={data.pendingLeaseDocuments}
			application={data.pendingApplication}
			proposedCharges={data.proposedCharges}
			{form}
		/>
	{/if}

	<LeaseCard
		lease={data.activeLease}
		ledger={data.ledger}
		inspections={data.inspections}
		leaseDocuments={data.leaseDocuments}
		{approvedApplications}
		settings={data.settings}
		today={data.today}
		{form}
		depositBilled={data.charges.some((c) => c.type === 'deposit' && c.status === 'published')}
		hasPending={!!data.pendingLease}
	/>

	<SettingsCard settings={data.settings} propertyAccess={data.propertyAccess} {form} />

	<!-- Team & roles for all staff: invitations are Owner+Admin; role dropdowns
	     stay Owner-only inside the card (and server/PocketBase-enforced). -->
	<TeamCard
		users={data.allUsers}
		invitations={data.invitations}
		currentUserId={data.user.id}
		isOwner={data.user.role === 'owner'}
		{form}
	/>

	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<MessageSquare class="text-turquoise size-5" /> Messages
			</CardTitle>
			<CardDescription>Conversations with applicants and tenants.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.section === 'messages'}
				<p class="bg-muted mb-3 rounded-md px-3 py-2 text-sm">{form.message}</p>
			{/if}
			<MessageThread
				messages={data.messages.slice().reverse()}
				currentUserId={data.user.id}
				recipients={messageRecipients}
			/>
		</CardContent>
	</Card>
</div>
