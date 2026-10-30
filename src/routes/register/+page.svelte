<script lang="ts">
	import type { ActionData } from './$types';
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
	import ApplicantNextSteps from '$lib/components/ApplicantNextSteps.svelte';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Create account — RentalDesk</title>
</svelte:head>

<div class="mx-auto max-w-md">
	<Card>
		<CardHeader>
			<CardTitle class="text-xl">Create your applicant account</CardTitle>
			<CardDescription>
				Register to start your rental application. You can save a draft and come back any time.
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.message}
				<p class="bg-destructive/10 text-destructive mb-4 rounded-md px-3 py-2 text-sm">
					{form.message}
				</p>
			{/if}
			<form method="POST" use:enhance class="flex flex-col gap-4">
				<div class="flex flex-col gap-2">
					<Label for="name">Full name</Label>
					<Input id="name" name="name" autocomplete="name" required value={form?.name ?? ''} />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="email">Email</Label>
					<Input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
						value={form?.email ?? ''}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="password">Password</Label>
					<Input
						id="password"
						name="password"
						type="password"
						autocomplete="new-password"
						minlength={8}
						required
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="passwordConfirm">Confirm password</Label>
					<Input
						id="passwordConfirm"
						name="passwordConfirm"
						type="password"
						autocomplete="new-password"
						minlength={8}
						required
					/>
				</div>
				<Button type="submit" class="w-full">Create account</Button>
			</form>
			<p class="text-muted-foreground mt-4 text-center text-sm">
				Already have an account? <a class="underline" href="/login">Log in</a>
			</p>
		</CardContent>
	</Card>

	<div class="mt-6">
		<ApplicantNextSteps />
	</div>
</div>
