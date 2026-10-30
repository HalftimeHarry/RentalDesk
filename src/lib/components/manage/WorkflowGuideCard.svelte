<script lang="ts">
	import type { Application, Charge, DocRecord, Inspection, Lease } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { AlertTriangle, Check, Circle, Clock, ListChecks } from '@lucide/svelte';

	/**
	 * Compact "Applicant → Tenant workflow" checklist for management.
	 * Completion indicators read SAVED records only — screening completion and
	 * signatures are never inferred without a supporting record (e.g. an
	 * uploaded signed-lease document).
	 */
	let {
		applications,
		lease,
		leaseDocuments,
		charges,
		inspections
	}: {
		applications: Application[];
		lease: Lease | null;
		leaseDocuments: DocRecord[];
		charges: Charge[];
		inspections: Inspection[];
	} = $props();

	const hasSubmitted = $derived(applications.some((a) => a.status !== 'draft'));
	const hasReviewed = $derived(
		applications.some((a) => ['under_review', 'approved', 'denied'].includes(a.status))
	);
	const signedLeaseUploaded = $derived(leaseDocuments.some((d) => d.kind === 'signed_lease'));
	const leaseCreated = $derived(!!lease);
	const moveInChargesReady = $derived(charges.length > 0);
	const moveInInspectionScheduled = $derived(inspections.some((i) => i.type === 'move_in'));
</script>

<Card>
	<CardHeader>
		<CardTitle class="flex items-center gap-2">
			<ListChecks class="text-ocean size-5" /> Applicant → Tenant workflow
		</CardTitle>
		<CardDescription>
			The intended sequence, with what this app records at each step.
		</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col gap-3">
		<details open class="group">
			<summary class="flex min-h-12 cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
				<span class="transition-transform group-open:rotate-90">▸</span> Onboarding checklist (5 steps)
			</summary>
			<ol class="mt-2 flex flex-col gap-3 text-sm">
				<li class="flex gap-2">
					{#if hasSubmitted}<Check class="size-4 shrink-0 text-emerald-600" />{:else}<Circle class="text-muted-foreground size-4 shrink-0" />{/if}
					<span>
						<strong>1. View the property.</strong> An anonymous visitor reviews the listing and
						creates an Applicant account.
					</span>
				</li>
				<li class="flex gap-2">
					{#if hasSubmitted}<Check class="size-4 shrink-0 text-emerald-600" />{:else}<Circle class="text-muted-foreground size-4 shrink-0" />{/if}
					<span>
						<strong>2. Complete the rental application.</strong> The applicant provides contact
						information, rental/employment details, and identification.
						<span class="text-muted-foreground mt-1 flex items-start gap-1 text-xs">
							<Clock class="mt-0.5 size-3 shrink-0" />
							Screening authorization/signature: pending — sensitive screening information
							(including an SSN when required) goes through the approved secure screening
							process, not this app yet.
						</span>
					</span>
				</li>
				<li class="flex gap-2">
					{#if hasReviewed}<Check class="size-4 shrink-0 text-emerald-600" />{:else}<Circle class="text-muted-foreground size-4 shrink-0" />{/if}
					<span>
						<strong>3. Submit for review.</strong> Management reviews the application and
						completes screening. Submission is not approval and does not create a tenancy.
					</span>
				</li>
				<li class="flex gap-2">
					{#if signedLeaseUploaded}<Check class="size-4 shrink-0 text-emerald-600" />{:else}<Circle class="text-muted-foreground size-4 shrink-0" />{/if}
					<span>
						<strong>4. Approval and DocuSign.</strong> If approved, prepare the lease in
						DocuSign; landlord and tenant sign there (external — no DocuSign integration in
						this app). Then upload the completed signed lease PDF and completion certificate:
						tenant's <em>View summarized lease</em> dialog or the Lease card's document upload
						below.
					</span>
				</li>
				<li class="flex gap-2">
					{#if leaseCreated && signedLeaseUploaded && moveInChargesReady}<Check class="size-4 shrink-0 text-emerald-600" />{:else}<Circle class="text-muted-foreground size-4 shrink-0" />{/if}
					<span>
						<strong>5. Finalize the tenancy.</strong> Create the lease in the Lease card below —
						verify the tenant, dates, rent, and deposit. A new lease starts as <em>pending</em>:
						upload the signed packet, review the proposed move-in charges, then Activate tenancy —
						that grants Tenant access, creates the draft charges, and removes the listing. Schedule
						the move-in inspection
						{#if moveInInspectionScheduled}(scheduled){/if}.
					</span>
				</li>
			</ol>
		</details>

		<p class="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
			<AlertTriangle class="mt-0.5 size-4 shrink-0" />
			<span>
				Approving an application does <strong>not</strong> mean the lease is signed. New leases
				start as pending — Tenant access begins only at activation, after the signed DocuSign
				packet is on file.
			</span>
		</p>

		<div class="flex flex-wrap items-center gap-2">
			<Button href="/dashboard/manage/billing" variant="outline" size="sm" class="min-h-12">
				Open billing
			</Button>
			<span class="text-muted-foreground text-xs">
				Lease creation, document uploads, and inspections live in the Lease card below.
			</span>
		</div>
	</CardContent>
</Card>
