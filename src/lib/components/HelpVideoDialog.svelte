<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { helpVideoUrl } from '$lib/files';
	import type { HelpVideo } from '$lib/types';
	import { X } from '@lucide/svelte';

	let { video = null, open = $bindable(false) }: { video: HelpVideo | null; open?: boolean } = $props();
	let videoEl: HTMLVideoElement | null = $state(null);
	let playbackMessage = $state('');

	const videoSrc = $derived(video ? helpVideoUrl(video.id, video.video_file) : '');
	const thumbSrc = $derived(video ? helpVideoUrl(video.id, video.thumbnail) : '');
	const captionsSrc = $derived(video ? helpVideoUrl(video.id, video.captions) : '');

	$effect(() => {
		if (!open || !video || !videoEl) return;
		videoEl.muted = false;
		videoEl.playsInline = true;
		videoEl.pause();
		void videoEl.play().catch(() => {
			playbackMessage = 'Playback may require an explicit tap in this browser.';
		});
	});

	$effect(() => {
		if (open || !videoEl) return;
		videoEl.pause();
		videoEl.currentTime = 0;
	});
</script>

{#if video}
	<Dialog.Root bind:open>
		<Dialog.Portal>
			<Dialog.Overlay />
			<Dialog.Content
				class="max-h-[92vh] w-[min(100%,30rem)] max-w-[calc(100vw-1rem)] overflow-hidden border-0 bg-slate-950 p-0 shadow-2xl"
			>
				<div class="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
					<div class="min-w-0 flex-1">
						<h3 class="truncate text-base font-semibold text-white">{video.title}</h3>
						{#if video.description}
							<p class="text-xs text-slate-300">{video.description}</p>
						{/if}
					</div>
					<Dialog.Close class="rounded-md border border-white/15 p-2 text-slate-200 hover:bg-white/5">
						<X class="size-4" />
					</Dialog.Close>
				</div>
				<div class="bg-slate-950 p-2">
					<video
						bind:this={videoEl}
						class="aspect-[390/844] w-full rounded-lg bg-black object-cover"
						controls
						preload="metadata"
						playsinline
						poster={thumbSrc}
					>
						<source src={videoSrc} type="video/mp4" />
						{#if captionsSrc}
							<track default kind="captions" label="English" src={captionsSrc} srclang="en" />
						{/if}
					</video>
					{#if playbackMessage}
						<p class="mt-2 px-1 text-xs text-amber-200">{playbackMessage}</p>
					{/if}
				</div>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{/if}
