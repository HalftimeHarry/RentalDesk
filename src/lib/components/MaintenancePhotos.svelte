<script lang="ts">
	import { maintenancePhotoUrl } from '$lib/files';
	import { X } from '@lucide/svelte';

	/**
	 * Read-only photo gallery for a maintenance request: thumbnails that enlarge
	 * into a fullscreen overlay (tap the enlarged photo, the close button, or
	 * Escape to dismiss). Files load through the protected /files proxy.
	 */
	let { recordId, photos }: { recordId: string; photos: string[] } = $props();

	let enlarged: string | null = $state(null);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') enlarged = null;
	}}
/>

{#if photos.length > 0}
	<ul class="flex flex-wrap gap-2">
		{#each photos as p (p)}
			<li>
				<button
					type="button"
					class="block cursor-zoom-in overflow-hidden rounded-lg border shadow-xs transition-transform hover:scale-[1.03]"
					onclick={() => (enlarged = maintenancePhotoUrl(recordId, p))}
					aria-label="Enlarge maintenance photo"
				>
					<img
						src={maintenancePhotoUrl(recordId, p, '300x300')}
						alt="Maintenance request attachment"
						class="size-20 object-cover"
						loading="lazy"
					/>
				</button>
			</li>
		{/each}
	</ul>

	{#if enlarged}
		<div
			class="bg-navy/85 fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden"
			role="dialog"
			aria-modal="true"
			aria-label="Enlarged maintenance photo"
		>
			<button
				type="button"
				class="max-h-full max-w-full cursor-zoom-out"
				onclick={() => (enlarged = null)}
				aria-label="Close enlarged photo"
			>
				<img
					src={enlarged}
					alt="Enlarged maintenance request attachment"
					class="max-h-[85dvh] max-w-full rounded-lg object-contain"
				/>
			</button>
			<button
				type="button"
				class="bg-card text-navy absolute top-3 right-3 flex size-10 items-center justify-center rounded-full shadow-lg"
				onclick={() => (enlarged = null)}
				aria-label="Close"
			>
				<X class="size-5" />
			</button>
		</div>
	{/if}
{/if}
