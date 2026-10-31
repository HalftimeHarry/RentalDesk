<script lang="ts">
	import type { Invitation, User } from '$lib/types';
	import type { FormFeedback } from './ApplicantsCard.svelte';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Badge } from '$lib/components/ui/badge';
	import { formatDate } from '$lib/format';
	import { ChevronDown, MailPlus, UsersRound } from '@lucide/svelte';

	type TeamForm = { section?: string; message?: string; inviteUrl?: string } | null | undefined;

	let {
		users,
		invitations,
		currentUserId,
		isOwner,
		form
	}: {
		users: User[];
		invitations: Invitation[];
		currentUserId: string;
		isOwner: boolean;
		form: TeamForm;
	} = $props();

	const roleLabels: Record<string, string> = {
		owner: 'Owner',
		admin: 'Admin',
		applicant: 'Applicant',
		tenant: 'Tenant'
	};

	const inviteStatusVariant = (status: string) =>
		status === 'accepted' ? 'success' : status === 'expired' ? 'secondary' : 'warning';
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
				Invite admins by link (Owner and Admin). Direct role changes stay Owner-only — Applicants
				can never grant themselves management roles.
			</p>
		</div>
		<CardContent class="flex flex-col gap-3">
			{#if form?.section === 'team'}
				<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
				{#if form.inviteUrl}
					<div class="flex flex-col gap-1 rounded-md border border-turquoise/40 bg-turquoise/10 px-3 py-2">
						<Label for="invite-link" class="text-xs">Invitation link (local testing — share manually)</Label>
						<Input id="invite-link" readonly value={form.inviteUrl} onclick={(e) => e.currentTarget.select()} />
					</div>
				{/if}
			{/if}

			<form method="POST" action="?/inviteAdmin" use:enhance class="flex flex-wrap items-end gap-2 rounded-lg border p-3">
				<div class="flex min-w-48 flex-1 flex-col gap-2">
					<Label for="invite-email">Invite admin</Label>
					<Input id="invite-email" name="email" type="email" placeholder="name@example.com" required />
				</div>
				<Button type="submit" variant="outline" class="min-h-12">
					<MailPlus class="size-4" /> Invite admin
				</Button>
			</form>

			{#if invitations.length > 0}
				<div class="flex flex-col gap-1">
					<p class="text-sm font-medium">Invitations</p>
					<ul class="divide-y rounded-md border text-sm">
						{#each invitations as inv (inv.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 p-3">
								<span>{inv.email}</span>
								<span class="flex items-center gap-2">
									<span class="text-muted-foreground text-xs">
										{formatDate(inv.created)} · {inv.status === 'accepted' && inv.accepted_at ? `accepted ${formatDate(inv.accepted_at)}` : `expires ${formatDate(inv.expires)}`}
									</span>
									<Badge variant={inviteStatusVariant(inv.status)}>{inv.status}</Badge>
								</span>
							</li>
						{/each}
					</ul>
				</div>
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
