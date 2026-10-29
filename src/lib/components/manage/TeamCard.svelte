<script lang="ts">
	import type { User } from '$lib/types';
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
	import * as Select from '$lib/components/ui/select';
	import { Badge } from '$lib/components/ui/badge';
	import { formatDate } from '$lib/format';
	import { UsersRound } from '@lucide/svelte';

	let {
		users,
		currentUserId,
		form
	}: { users: User[]; currentUserId: string; form: FormFeedback } = $props();

	const roleLabels: Record<string, string> = {
		owner: 'Owner',
		admin: 'Admin',
		applicant: 'Applicant',
		tenant: 'Tenant'
	};
</script>

<Card>
	<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<UsersRound class="text-ocean size-5" /> Team &amp; roles
			</CardTitle>
		<CardDescription>
			Owner only. Assign Admin access here — Applicants can never grant themselves management
			roles.
		</CardDescription>
	</CardHeader>
	<CardContent class="flex flex-col gap-3">
		{#if form?.section === 'team'}
			<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
		{/if}
		{#each users as u (u.id)}
			<div
				class="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
			>
				<div>
					<p class="font-medium">
						{u.name || u.email}
						{#if u.id === currentUserId}
							<Badge variant="outline" class="ml-1">you</Badge>
						{/if}
					</p>
					<p class="text-muted-foreground">{u.email} · joined {formatDate(u.created)}</p>
				</div>
				{#if u.id === currentUserId}
					<Badge variant="default">{roleLabels[u.role] ?? u.role}</Badge>
				{:else}
					<form method="POST" action="?/assignRole" use:enhance class="flex items-center gap-2">
						<input type="hidden" name="user_id" value={u.id} />
						<Select.Root type="single" name="role" value={u.role}>
							<Select.Trigger aria-label="Role" class="w-36"><Select.Value /></Select.Trigger>
							<Select.Content>
								<Select.Item value="applicant">Applicant</Select.Item>
								<Select.Item value="tenant">Tenant</Select.Item>
								<Select.Item value="admin">Admin</Select.Item>
								<Select.Item value="owner">Owner</Select.Item>
							</Select.Content>
						</Select.Root>
						<Button type="submit" size="sm" variant="outline">Save</Button>
					</form>
				{/if}
			</div>
		{/each}
	</CardContent>
</Card>
