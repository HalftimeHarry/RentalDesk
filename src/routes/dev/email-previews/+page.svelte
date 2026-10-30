<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Email previews (dev only) — RentalDesk</title>
</svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-8">
	<div>
		<h1 class="text-2xl font-bold tracking-tight text-white drop-shadow-sm">Email template previews</h1>
		<p class="text-white/85 drop-shadow-sm">
			Development only — fictional data, nothing is sent or loaded from the database.
		</p>
	</div>

	{#each data.previews as preview (preview.id)}
		<section class="bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
			<div>
				<h2 class="text-lg font-semibold">{preview.title}</h2>
				<p class="text-muted-foreground text-sm">
					Subject: <span class="font-medium">{preview.subject}</span>
				</p>
			</div>
			<iframe
				title="{preview.title} — HTML preview"
				srcdoc={preview.html}
				sandbox=""
				class="h-[560px] w-full rounded-lg border bg-white"
			></iframe>
			<details>
				<summary class="cursor-pointer text-sm font-medium">Plain-text version</summary>
				<pre class="bg-muted mt-2 overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">{preview.text}</pre>
			</details>
		</section>
	{/each}
</div>
