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
	import MaintenanceCard from '$lib/components/manage/MaintenanceCard.svelte';
	import SettingsCard from '$lib/components/manage/SettingsCard.svelte';
	import TeamCard from '$lib/components/manage/TeamCard.svelte';
	import UpcomingCard from '$lib/components/manage/UpcomingCard.svelte';
	import MessageThread from '$lib/components/MessageThread.svelte';
	import { formatMoney, formatDate } from '$lib/format';
	import * as Dialog from '$lib/components/ui/dialog';
	import { buttonVariants } from '$lib/components/ui/button';
	import {
		CalendarClock,
		ClipboardList,
		LayoutDashboard,
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

	<!-- Summary cards -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
		<Card>
			<CardHeader class="pb-2">
				<CardDescription class="flex items-center gap-1.5">
					<Users class="text-ocean size-4" /> Pending applications
				</CardDescription>
				<CardTitle class="text-2xl">{pendingApplications}</CardTitle>
			</CardHeader>
			<CardContent class="text-muted-foreground text-sm">
				{data.applications.length} total
			</CardContent>
		</Card>
		<Card>
			<CardHeader class="pb-2">
				<CardDescription class="flex items-center gap-1.5">
					<Wrench class="text-coral size-4" /> Open maintenance
				</CardDescription>
				<CardTitle class="text-2xl">{openMaintenance}</CardTitle>
			</CardHeader>
			<CardContent class="text-muted-foreground text-sm">
				{data.maintenance.length} total requests
			</CardContent>
		</Card>
		<Card>
			<CardHeader class="pb-2">
				<CardDescription class="flex items-center gap-1.5">
					<CalendarClock class="text-gold size-4" /> Upcoming dates
				</CardDescription>
				<CardTitle class="text-2xl">{data.upcoming.length}</CardTitle>
			</CardHeader>
			<CardContent class="text-muted-foreground text-sm">Next 60 days</CardContent>
		</Card>
	</div>

	<!-- Prominent inspection report entry point -->
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
		<CardContent>
			<Button href="/dashboard/inspections" size="lg" class="min-h-12 w-full sm:w-auto">
				<ClipboardList class="size-5" /> Open inspection report
			</Button>
		</CardContent>
	</Card>

	<div class="grid gap-6 lg:grid-cols-2">
		<ApplicantsCard applications={data.applications} {form} />
		<div class="flex flex-col gap-6">
			<UpcomingCard upcoming={data.upcoming} />
			<MaintenanceCard maintenance={data.maintenance} {form} />
		</div>
	</div>

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
	/>

	<SettingsCard settings={data.settings} {form} />

	{#if isOwner}
		<TeamCard users={data.allUsers} currentUserId={data.user.id} {form} />
	{/if}

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
