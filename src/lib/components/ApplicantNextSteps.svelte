<script lang="ts">
	import type { Application, DocRecord } from '$lib/types';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Check, Circle, Clock, ListOrdered } from '@lucide/svelte';

	/**
	 * "What happens next" — short onboarding steps for applicants.
	 * Used on the registration screen (static) and the applicant dashboard
	 * (with saved-data ticks). Steps that are not implemented yet are marked
	 * pending rather than claimed as working.
	 */
	let {
		application = null,
		documents = []
	}: { application?: Application | null; documents?: DocRecord[] } = $props();

	const applicationSubmitted = $derived(!!application && application.status !== 'draft');
	const idUploaded = $derived(documents.some((d) => d.kind === 'identification'));
</script>

<Card>
	<CardHeader>
		<CardTitle class="flex items-center gap-2">
			<ListOrdered class="text-ocean size-5" /> What happens next
		</CardTitle>
		<CardDescription>The path from account to signed lease.</CardDescription>
	</CardHeader>
	<CardContent>
		<ol class="flex flex-col gap-3 text-sm">
			<li class="flex gap-2">
				<Check class="size-4 shrink-0 text-emerald-600" />
				<span>
					<strong>1. Create your account.</strong> You're doing that now — it takes a minute.
				</span>
			</li>
			<li class="flex gap-2">
				{#if idUploaded}<Check class="size-4 shrink-0 text-emerald-600" />{:else}<Circle class="text-muted-foreground size-4 shrink-0" />{/if}
				<span>
					<strong>2. Complete the rental application.</strong> Have ready: your contact
					information, rental and employment details, and a photo of your ID. You can save a
					draft and come back any time.
				</span>
			</li>
			<li class="flex gap-2">
				<Clock class="text-muted-foreground size-4 shrink-0" />
				<span>
					<strong>3. Screening authorization.</strong>
					<span class="text-muted-foreground">
						Pending — management will provide the secure screening step when you apply. Never
						send your Social Security number by email or text.
					</span>
				</span>
			</li>
			<li class="flex gap-2">
				{#if applicationSubmitted}<Check class="size-4 shrink-0 text-emerald-600" />{:else}<Circle class="text-muted-foreground size-4 shrink-0" />{/if}
				<span>
					<strong>4. Submit for review.</strong> Submit when your application is complete.
					Management will review it and complete screening — submitting is not approval and
					does not create a tenancy.
				</span>
			</li>
			<li class="flex gap-2">
				<Circle class="text-muted-foreground size-4 shrink-0" />
				<span>
					<strong>5. Approval and signing.</strong> Approved applicants receive a separate
					DocuSign request by email to sign the lease.
				</span>
			</li>
			<li class="flex gap-2">
				<Circle class="text-muted-foreground size-4 shrink-0" />
				<span>
					<strong>6. Move in.</strong> Once the signed lease is uploaded, you can retrieve the
					signed agreement from your dashboard at any time.
				</span>
			</li>
		</ol>
	</CardContent>
</Card>
