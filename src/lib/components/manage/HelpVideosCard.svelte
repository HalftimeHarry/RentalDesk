<script lang="ts">
	import type { HelpVideo } from '$lib/types';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import HelpVideoDialog from '$lib/components/HelpVideoDialog.svelte';
	import { ChevronDown, CircleHelp, Play } from '@lucide/svelte';

	let { videos, autoWatchSlug = '' }: { videos: HelpVideo[]; autoWatchSlug?: string } = $props();

	let open = $state(false);
	let expanded = $state(false);
	let selected = $state<HelpVideo | null>(null);
	function watch(video: HelpVideo) {
		selected = video;
		open = true;
	}

	// Email/tutorial deep link: ?watch=<slug> opens the matching dialog once
	// after login (closing it again must stick).
	let autoWatched = $state(false);
	$effect(() => {
		if (autoWatched || !autoWatchSlug) return;
		const match = videos.find((v) => v.slug === autoWatchSlug);
		if (match) {
			autoWatched = true;
			watch(match);
		}
	});
</script>

{#if videos.length > 0}
	<div class="rounded-xl border border-slate-200 bg-white">
		<button
			type="button"
			class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
			onclick={() => (expanded = !expanded)}
			aria-expanded={expanded}
		>
			<div class="flex items-center gap-2 text-base font-semibold text-slate-900">
				<CircleHelp class="text-ocean size-5" /> Help videos
			</div>
			<ChevronDown
				class={`text-muted-foreground size-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
			/>
		</button>

		{#if expanded}
			<Card class="border-0 shadow-none">
				<CardHeader class="pb-2">
					<CardTitle class="flex items-center gap-2">
						<Play class="text-ocean size-5" /> Help videos
					</CardTitle>
					<CardDescription>Short walkthroughs of the dashboards.</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-2">
					{#each videos as video (video.id)}
						<div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">{video.title}</p>
								{#if video.description}
									<p class="text-muted-foreground text-xs">{video.description}</p>
								{/if}
							</div>
							<Button variant="outline" size="sm" class="min-h-11" onclick={() => watch(video)}>
								<Play class="size-4" /> Watch
							</Button>
						</div>
					{/each}
				</CardContent>
			</Card>
		{/if}
	</div>
	<HelpVideoDialog bind:open video={selected} />
{/if}
