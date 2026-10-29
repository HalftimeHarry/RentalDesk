<script lang="ts">
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { formatDate } from '$lib/format';
	import { CalendarClock } from '@lucide/svelte';

	let { upcoming }: { upcoming: { date: string; label: string }[] } = $props();
</script>

<Card>
	<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<CalendarClock class="text-coral size-5" /> Upcoming lease dates
			</CardTitle>
		<CardDescription>Next 60 days.</CardDescription>
	</CardHeader>
	<CardContent>
		{#if upcoming.length === 0}
			<p class="text-muted-foreground text-sm">Nothing scheduled in the next 60 days.</p>
		{:else}
			<ul class="flex flex-col gap-2 text-sm">
				{#each upcoming as u (u.date + u.label)}
					<li class="flex items-center gap-2">
						<CalendarClock class="text-muted-foreground size-4 shrink-0" />
						<span class="font-medium">{formatDate(u.date)}</span>
						<span class="text-muted-foreground">— {u.label}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</CardContent>
</Card>
