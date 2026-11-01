<script lang="ts">
	import type { User } from '$lib/types';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Badge } from '$lib/components/ui/badge';
	import { formatDate } from '$lib/format';
	import { ChevronDown, UsersRound } from '@lucide/svelte';

	let {
		users,
		currentUserId,
		isOwner
	}: {
		users: User[];
		currentUserId: string;
		isOwner: boolean;
	} = $props();

	const roleLabels: Record<string, string> = {
		owner: 'Owner',
		admin: 'Admin',
		applicant: 'Applicant',
		tenant: 'Tenant'
	};
</script>

<Card>
	<details class="group block" open={false}>
		<summary class="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
			<div class="flex items-center justify-between gap-3 px-4 pt-4 text-left">
				<div class="flex items-center gap-2 font-semibold text-slate-900">
					<UsersRound class="text-ocean size-5" /> Team &amp; roles
				</div>
				<ChevronDown class="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
			</div>
		</summary>
		<div class="px-4 pt-3">
			<p class="text-sm text-slate-600">
				Direct role changes stay Owner-only — Applicants can never grant themselves management roles.
			</p>
		</div>
		<CardContent class="flex flex-col gap-3">
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
					{#if u.id === currentUserId || !isOwner}
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
	</details>
</Card>
