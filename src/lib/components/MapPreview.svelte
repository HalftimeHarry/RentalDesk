<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { MapPin } from '@lucide/svelte';

	/**
	 * Compact map preview for the property. OpenStreetMap's iframe embed is an
	 * officially supported, keyless method — no API key or billing is involved.
	 * "Get directions" uses the documented Google Maps URL API (no key).
	 *
	 * Coordinates are the Golden Hill block of the property address; the address
	 * text itself always comes from saved settings (with a fallback literal).
	 */
	let { address }: { address: string } = $props();

	const LAT = 32.7172; // 2728 B Street, San Diego, CA 92102 (approximate)
	const LON = -117.1278;
	const bbox = `${LON - 0.006}%2C${LAT - 0.004}%2C${LON + 0.006}%2C${LAT + 0.004}`;
	const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${LAT}%2C${LON}`;
	const directionsUrl = $derived(
		`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
	);
</script>

<div class="flex w-full flex-col gap-2 sm:w-64 sm:shrink-0">
	<div class="border-navy/10 relative overflow-hidden rounded-xl border shadow-sm">
		<iframe
			title="Map preview of {address}"
			src={embedUrl}
			class="h-44 w-full"
			loading="lazy"
			referrerpolicy="no-referrer"
		></iframe>
		<span
			class="bg-card/90 text-navy pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full px-2 py-1 text-xs font-medium shadow"
		>
			<MapPin class="size-3.5 shrink-0 text-rose-600" />
			<span class="truncate">{address}</span>
		</span>
	</div>
	<Button
		href={directionsUrl}
		target="_blank"
		rel="noreferrer"
		variant="outline"
		size="sm"
		class="min-h-12 w-full"
		aria-label="Get directions to {address}"
	>
		<MapPin class="size-4" /> Get directions
	</Button>
</div>
