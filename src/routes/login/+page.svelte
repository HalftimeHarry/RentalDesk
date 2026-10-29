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

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Log in — RentalDesk</title>
</svelte:head>

<div class="mx-auto max-w-md">
	<Card>
		<CardHeader>
			<CardTitle class="text-xl">Log in</CardTitle>
			<CardDescription>Access your applicant, tenant, or management dashboard.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.message}
				<p class="bg-destructive/10 text-destructive mb-4 rounded-md px-3 py-2 text-sm">
					{form.message}
				</p>
			{/if}
			<form method="POST" use:enhance class="flex flex-col gap-4">
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
						autocomplete="current-password"
						required
					/>
				</div>
				<Button type="submit" class="w-full">Log in</Button>
			</form>
			<p class="text-muted-foreground mt-4 text-center text-sm">
				No account yet? <a class="underline" href="/register">Apply now</a>
			</p>
		</CardContent>
	</Card>
</div>
