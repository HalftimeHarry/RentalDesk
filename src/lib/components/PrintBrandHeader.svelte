<script lang="ts">
	// Branded masthead for printable/PDF documents: site logo, coastal theme
	// colors, and as much business context (unit name, address, owner) as the
	// caller can provide. Colors are forced in print via print-color-adjust.
	import logo from '$lib/assets/rental_logo.png';

	let {
		title,
		subtitle = '',
		unitName = '',
		address = '',
		ownerName = ''
	}: {
		title: string;
		subtitle?: string;
		unitName?: string;
		address?: string;
		ownerName?: string;
	} = $props();
</script>

<header
	class="border-navy/15 mb-6 overflow-hidden rounded-lg border print:rounded-none"
	style="print-color-adjust: exact; -webkit-print-color-adjust: exact;"
>
	<div class="bg-seafoam flex flex-wrap items-center justify-between gap-4 px-5 py-4">
		<div class="flex items-center gap-3">
			<img src={logo} alt="RentalDesk" class="h-12 w-auto object-contain" />
			<div>
				<p class="text-navy text-lg leading-tight font-bold tracking-tight">
					{unitName || 'RentalDesk'}
				</p>
				{#if address}
					<p class="text-navy/80 text-xs">{address}</p>
				{/if}
				{#if ownerName}
					<p class="text-navy/80 text-xs">Owner / manager: {ownerName}</p>
				{/if}
			</div>
		</div>
		<div class="text-right">
			<h1 class="text-ocean text-xl font-bold tracking-tight">{title}</h1>
			{#if subtitle}
				<p class="text-navy/70 text-sm">{subtitle}</p>
			{/if}
		</div>
	</div>
	<div class="bg-gold h-1.5 w-full"></div>
</header>
