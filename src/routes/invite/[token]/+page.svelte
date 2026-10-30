<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { MailCheck } from '@lucide/svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Admin invitation — RentalDesk</title>
</svelte:head>

<div class="mx-auto max-w-md">
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2 text-xl">
				<MailCheck class="text-ocean size-5" /> Admin invitation
			</CardTitle>
			<CardDescription>Rental Desk management invited you to join as an Admin.</CardDescription>
		</CardHeader>
		<CardContent class="flex flex-col gap-4 text-sm">
			{#if form?.message}
				<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2">{form.message}</p>
			{/if}

			{#if data.status === 'accepted'}
				<p>This invitation has already been accepted.</p>
				<Button href="/login" variant="outline" class="w-full">Sign in</Button>
			{:else if data.status === 'expired'}
				<p>This invitation has expired. Ask the management team for a new one.</p>
			{:else if !data.userEmail}
				<p>
					This invitation is for <strong>{data.email}</strong>. Sign in or create an account with
					that email to accept it.
				</p>
				<div class="flex flex-col gap-2">
					<Button href="/login?next=/invite/{data.token}" class="min-h-12 w-full">Sign in</Button>
					<Button href="/register?next=/invite/{data.token}" variant="outline" class="min-h-12 w-full">
						Create account
					</Button>
				</div>
			{:else if data.userEmail.toLowerCase() === data.email.toLowerCase()}
				<p>
					Signed in as <strong>{data.userEmail}</strong>. Accept to get Admin access to Rental
					Desk management.
				</p>
				<form method="POST" action="?/accept" use:enhance>
					<Button type="submit" class="min-h-12 w-full">Accept Admin invitation</Button>
				</form>
			{:else}
				<p>
					This invitation is for <strong>{data.email}</strong>, but you are signed in as
					<strong>{data.userEmail}</strong>.
				</p>
				<Button href="/logout" variant="outline" class="min-h-12 w-full">Sign out to switch accounts</Button>
			{/if}
		</CardContent>
	</Card>
</div>
