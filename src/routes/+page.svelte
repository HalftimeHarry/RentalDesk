<script lang="ts">
	import type { PageProps } from './$types';
	import logo from '$lib/assets/rental_logo.png';
	import cd from '$lib/assets/photos/cd.jpg';
	import img2306 from '$lib/assets/photos/IMG_2306.jpeg';
	import img2307 from '$lib/assets/photos/IMG_2307.jpeg';
	import img2308 from '$lib/assets/photos/IMG_2308.jpeg';
	import img2324 from '$lib/assets/photos/IMG_2324.jpeg';
	import img2326 from '$lib/assets/photos/IMG_2326.jpeg';
	import img2327 from '$lib/assets/photos/IMG_2327.jpeg';
	import img2328 from '$lib/assets/photos/IMG_2328.jpeg';
	import img2340 from '$lib/assets/photos/IMG_2340.jpeg';
	import img2343 from '$lib/assets/photos/IMG_2343.jpeg';
	import img2345 from '$lib/assets/photos/IMG_2345.jpeg';
	import img2346 from '$lib/assets/photos/IMG_2346.jpeg';
	import img2347 from '$lib/assets/photos/IMG_2347.jpeg';
	import img2348 from '$lib/assets/photos/IMG_2348.jpeg';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import * as Carousel from '$lib/components/ui/carousel';
	import type { CarouselAPI } from '$lib/components/ui/carousel/context';
	import { formatDate, formatMoney } from '$lib/format';
	import {
		CalendarCheck,
		CalendarClock,
		CircleCheck,
		House,
		ShieldCheck,
		Wallet
	} from '@lucide/svelte';

	let { data }: PageProps = $props();
	let settings = $derived(data.settings);

	// Slideshow photos: cd.jpg first, then the 13 IMG_* photos in filename order.
	// (cd.jpg also remains the dimmed app background.)
	const photos = [
		cd,
		img2306,
		img2307,
		img2308,
		img2324,
		img2326,
		img2327,
		img2328,
		img2340,
		img2343,
		img2345,
		img2346,
		img2347,
		img2348
	];

	let api: CarouselAPI | undefined = $state(undefined);
	let current = $state(1);

	// Presented on the unit card (static listing content).
	const amenities = [
		'Parking',
		'Washer / Dryer in unit',
		'Pool',
		'Gym',
		'Air conditioning',
		'Garbage disposal',
		'Gated',
		'Public transportation close'
	];

	$effect(() => {
		if (!api) return;
		const onSelect = () => {
			current = (api?.selectedScrollSnap() ?? 0) + 1;
		};
		api.on('select', onSelect);
		onSelect();
		return () => {
			api?.off('select', onSelect);
		};
	});
</script>

<svelte:head>
	<title>{settings.unit_name} — RentalDesk</title>
</svelte:head>

<section class="mx-auto flex max-w-3xl flex-col gap-6">
	<div class="flex flex-col items-center gap-3 text-center">
		<div
			class="bg-sand/95 ring-navy/10 flex items-center justify-center rounded-full p-5 shadow-xl ring-1 sm:p-7"
		>
			<img src={logo} alt="Rental Desk" class="h-24 w-auto object-contain sm:h-32" />
		</div>
		{#if settings.is_available}
			<Badge variant="success">Available</Badge>
		{:else}
			<Badge variant="secondary">Not currently available</Badge>
		{/if}
	</div>

	<!-- Photo slideshow: swipe on touch, large controls, slide count. -->
	<Card class="gap-3 overflow-hidden py-4">
		<CardContent class="px-4">
			<Carousel.Root
				opts={{ loop: true }}
				setApi={(a) => (api = a)}
				class="w-full"
			>
				<Carousel.Content class="ml-0">
					{#each photos as src, i (src)}
						<Carousel.Item class="pl-0">
							<img
								{src}
								alt="Photo {i + 1} of {settings.unit_name}"
								class="aspect-[4/3] w-full rounded-lg border object-cover"
								loading={i === 0 ? 'eager' : 'lazy'}
								fetchpriority={i === 0 ? 'high' : 'auto'}
							/>
						</Carousel.Item>
					{/each}
				</Carousel.Content>
				<Carousel.Previous
					class="bg-card/90 text-navy hover:bg-card left-2 size-12 shadow-md disabled:opacity-40"
				/>
				<Carousel.Next
					class="bg-card/90 text-navy hover:bg-card right-2 size-12 shadow-md disabled:opacity-40"
				/>
			</Carousel.Root>
			<p class="text-muted-foreground mt-3 text-center text-sm" aria-live="polite">
				Photo {current} of {photos.length}
			</p>
		</CardContent>
	</Card>

	<!-- Unit card: every value below is read from saved settings, never hardcoded. -->
	<Card class="bg-sand/95 border-navy/10 shadow-md">
		<CardHeader>
			<CardTitle class="text-navy flex items-center gap-2 text-2xl">
				<House class="text-ocean size-6 shrink-0" />
				{settings.unit_name}
			</CardTitle>
			{#if settings.address}
				<CardDescription>{settings.address}</CardDescription>
			{/if}
		</CardHeader>
		<CardContent class="flex flex-col gap-4">
			<div class="flex flex-wrap items-baseline gap-2">
				<span class="text-ocean text-4xl font-bold tracking-tight"
					>{formatMoney(settings.monthly_rent_cents)}</span
				>
				<span class="text-navy/70">/ month</span>
			</div>
			<div class="flex flex-col gap-2">
				<span class="bg-turquoise/10 text-navy flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm">
					<ShieldCheck class="text-turquoise size-4 shrink-0" />
					Security deposit {formatMoney(settings.deposit_cents)}
				</span>
				<span class="bg-ocean/10 text-navy flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm">
					<CalendarClock class="text-ocean size-4 shrink-0" />
					{settings.min_lease_months}-month minimum lease
				</span>
				{#if settings.is_available}
					{#if settings.available_date}
						<span class="bg-gold/30 text-navy flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium">
							<CalendarCheck class="text-ocean size-4 shrink-0" />
							Available after {formatDate(settings.available_date)}
						</span>
					{:else}
						<span class="bg-turquoise/15 text-navy flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium">
							<CalendarCheck class="text-turquoise size-4 shrink-0" />
							Available now
						</span>
					{/if}
				{/if}
			</div>
			<p class="leading-relaxed whitespace-pre-line">{settings.description}</p>

			<div class="border-navy/10 border-t pt-4">
				<p class="text-navy mb-2 text-sm font-semibold">Amenities</p>
				<ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{#each amenities as amenity, i (amenity)}
						<li class="bg-card/80 text-navy flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
							<CircleCheck
								class={i % 2 === 0
									? 'text-turquoise size-5 shrink-0'
									: 'size-5 shrink-0 text-emerald-600'}
							/>
							{amenity}
						</li>
					{/each}
				</ul>
			</div>
		</CardContent>
	</Card>

	<div class="flex flex-col gap-3">
		{#if settings.is_available}
			<Button href="/register" size="lg" class="w-full sm:w-auto">
				<Wallet class="size-5" />
				Apply now
			</Button>
		{:else}
			<Button size="lg" disabled class="w-full sm:w-auto">Not accepting applications</Button>
		{/if}
		<Button href="/login" variant="outline" size="lg" class="w-full sm:w-auto">
			Already applied? Sign in
		</Button>
	</div>
</section>
