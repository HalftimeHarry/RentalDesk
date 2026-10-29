<script lang="ts">
	import type { Message } from '$lib/types';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';

	let {
		messages,
		currentUserId,
		recipientId = '',
		recipientLabel = 'Management',
		recipients = [],
		action = '?/sendMessage'
	}: {
		messages: Message[];
		currentUserId: string;
		recipientId?: string;
		recipientLabel?: string;
		recipients?: { id: string; label: string }[];
		action?: string;
	} = $props();

	function fmt(iso: string): string {
		return new Date(iso).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<div class="flex flex-col gap-3">
	{#if messages.length === 0}
		<p class="text-muted-foreground text-sm">No messages yet.</p>
	{:else}
		<div class="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border p-3">
			{#each messages as m (m.id)}
				{@const mine = m.sender === currentUserId}
				<div
					class={cn(
						'max-w-[85%] rounded-lg px-3 py-2 text-sm',
						mine ? 'bg-primary text-primary-foreground self-end' : 'bg-muted self-start'
					)}
				>
					<p class="whitespace-pre-line">{m.body}</p>
					<p
						class={cn(
							'mt-1 text-[0.65rem]',
							mine ? 'text-primary-foreground/70' : 'text-muted-foreground'
						)}
					>
						{mine ? 'You' : m.expand?.sender?.name || 'Management'} · {fmt(m.created)}
					</p>
				</div>
			{/each}
		</div>
	{/if}

	<form method="POST" {action} use:enhance class="flex flex-col gap-2">
		{#if recipients.length > 0}
			<Select.Root type="single" name="recipient" required>
				<Select.Trigger class="w-full" aria-label="Recipient">
					<Select.Value placeholder="Select recipient…" />
				</Select.Trigger>
				<Select.Content>
					{#each recipients as r (r.id)}
						<Select.Item value={r.id}>{r.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{:else}
			<input type="hidden" name="recipient" value={recipientId} />
		{/if}
		<Textarea name="body" required placeholder="Write a message…" rows={2} />
		<Button type="submit" size="sm" class="self-end">Send</Button>
	</form>
</div>
