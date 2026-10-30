<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/rental_logo.png';
	import type { LayoutProps } from './$types';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import logo from '$lib/assets/rental_logo.png';
	import bg from '$lib/assets/photos/cd.jpg';
	import { Button } from '$lib/components/ui/button';
	import { Home, LayoutDashboard, LogIn, LogOut, PenLine } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	let { children, data }: LayoutProps = $props();

	let dashboardHref = $derived(
		data.user?.role === 'owner' || data.user?.role === 'admin'
			? '/dashboard/manage'
			: data.user?.role === 'tenant'
				? '/dashboard/tenant'
				: '/dashboard/applicant'
	);

	let navItems = $derived.by(() => {
		if (!data.user) {
			return [
				{ href: '/', label: 'Listing', icon: Home, color: 'gold' },
				{ href: '/register', label: 'Apply', icon: PenLine, color: 'turquoise' },
				{ href: '/login', label: 'Sign in', icon: LogIn, color: 'ocean' }
			];
		}
		return [
			{ href: '/', label: 'Listing', icon: Home, color: 'gold' },
			{ href: dashboardHref, label: 'Dashboard', icon: LayoutDashboard, color: 'ocean' },
			{ href: '/logout', label: 'Sign out', icon: LogOut, color: 'red' }
		];
	});

	// Every destination gets its own solid coastal color.
	const colorClasses: Record<string, string> = {
		gold: 'border-gold bg-gold text-navy hover:brightness-105',
		ocean: 'border-ocean bg-ocean text-white hover:brightness-110',
		turquoise: 'border-turquoise bg-turquoise text-white hover:brightness-110',
		red: 'border-red-600 bg-red-600 text-white hover:brightness-110'
	};

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		if (href.startsWith('/dashboard')) return path.startsWith('/dashboard');
		return path.startsWith(href);
	}

	let roleLabel = $derived(
		data.user ? data.user.role.charAt(0).toUpperCase() + data.user.role.slice(1) : ''
	);

	// Only the content area scrolls; reset its scroll position on navigation.
	let mainEl: HTMLElement | undefined = $state(undefined);
	afterNavigate(() => mainEl?.scrollTo({ top: 0 }));
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={favicon} />
	<title>RentalDesk</title>
	<meta name="description" content="RentalDesk — simple rental management for one unit." />
</svelte:head>

<!-- Dimmed coastal background; fixed, non-interactive, independent of scrolling content. -->
<div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden print:hidden" aria-hidden="true">
	<!-- blurred fill of the same photo — prevents exposed edges around the frame -->
	<img src={bg} alt="" class="absolute inset-0 h-full w-full scale-110 object-cover blur-lg" />
	<!-- framed focal photo, slightly zoomed out so more of the building shows -->
	<img
		src={bg}
		alt=""
		class="absolute inset-[3%] h-[94%] w-[94%] rounded-2xl object-cover shadow-2xl"
	/>
	<!-- deep-navy dim keeps cards and controls readable -->
	<div class="bg-navy/60 absolute inset-0"></div>
	<div class="bg-sand/15 absolute inset-0"></div>
</div>

<div class="flex h-dvh flex-col overflow-hidden print:h-auto print:overflow-visible">
	<header class="bg-seafoam text-navy sticky top-0 z-40 border-b border-navy/15 print:hidden">
		<div class="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4">
			<a href="/" class="flex items-center gap-2">
				<img src={logo} alt="Rental Desk" class="h-10 w-auto object-contain" />
			</a>
			<nav class="ml-auto hidden items-center gap-2 sm:flex">
				{#if data.user}
					<span class="text-sm">
						<span class="font-medium">{data.user.name || data.user.email}</span>
						<span class="text-navy/70"> · {roleLabel}</span>
					</span>
					<Button href="/" size="sm" class="bg-gold text-navy hover:bg-gold/90 border-transparent">
						<Home class="size-4" /> Listing
					</Button>
					<Button
						href={dashboardHref}
						size="sm"
						class="border-ocean bg-ocean text-white hover:brightness-110"
					>
						<LayoutDashboard class="size-4" /> Dashboard
					</Button>
					<Button
						href="/logout"
						size="sm"
						class="border-transparent bg-red-600 text-white hover:bg-red-700"
					>
						<LogOut class="size-4" /> Sign out
					</Button>
				{:else}
					<Button href="/login" variant="ghost" size="sm">
						<LogIn class="size-4" /> Sign in
					</Button>
					<Button href="/register" size="sm">
						<PenLine class="size-4" /> Apply
					</Button>
				{/if}
			</nav>
		</div>
	</header>

	<main
		bind:this={mainEl}
		class="mx-auto w-full max-w-6xl min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:py-10 print:max-w-none print:overflow-visible print:p-0"
	>
		{@render children()}
	</main>

	<!-- Bottom navigation: its own row below the scrolling content (in flow, not fixed). -->
	<nav
		class="bg-navy/90 border-navy/40 shrink-0 border-t backdrop-blur print:hidden"
		style="padding-bottom: env(safe-area-inset-bottom);"
		aria-label="Primary"
	>
	<div class="mx-auto flex w-full max-w-md items-stretch justify-center gap-2 px-3 pt-2.5 pb-2.5">
		{#each navItems as item (item.href)}
			{@const Icon = item.icon}
			{@const active = isActive(item.href)}
			<a
				href={item.href}
				aria-current={active ? 'page' : undefined}
				class={cn(
					'flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border px-3 py-2 text-xs font-semibold shadow-sm transition-all',
					colorClasses[item.color],
					active && 'scale-[1.03] shadow-md ring-2 ring-white'
				)}
			>
				<Icon class="size-6" />
				<span>{item.label}</span>
			</a>
		{/each}
	</div>
</nav>
</div>
