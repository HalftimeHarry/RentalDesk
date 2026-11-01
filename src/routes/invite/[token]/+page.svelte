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
					This invitation is for <strong>{data.email}</strong>. Set up your account with that email
					to accept it.
				</p>
				<form method="POST" action="?/setup" use:enhance class="flex flex-col gap-3">
					<label class="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Full name
						<input
							name="name"
							autocomplete="name"
							required
							class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-11 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Invited email
						<input
							value={data.email}
							readonly
							disabled
							class="border-input bg-muted/40 min-h-11 rounded-md border px-3 text-sm text-muted-foreground"
						/>
						<input type="hidden" name="email" value={data.email} />
					</label>
					<label class="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Password
						<input
							type="password"
							name="password"
							autocomplete="new-password"
							required
							class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-11 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
						/>
					</label>
					<label class="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Confirm password
						<input
							type="password"
							name="passwordConfirm"
							autocomplete="new-password"
							required
							class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-11 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
						/>
					</label>
					<div class="flex flex-col gap-2 pt-1">
						<Button type="submit" class="min-h-12 w-full">Create account & continue</Button>
						<Button href="/login?next=/invite/{data.token}" variant="outline" class="min-h-12 w-full">
							I already have an account
						</Button>
					</div>
				</form>
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
