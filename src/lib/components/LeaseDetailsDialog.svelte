<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { docUrl } from '$lib/files';
	import { formatDate, formatMoney } from '$lib/format';
	import type { DocRecord, Lease } from '$lib/types';
	import { Download, ExternalLink, Eye, FileText, Upload } from '@lucide/svelte';

	let {
		open = $bindable(false),
		lease,
		documents,
		canManage
	}: {
		open: boolean;
		lease: Lease;
		documents: DocRecord[];
		canManage: boolean;
	} = $props();

	// Signed-lease versions, newest first; the newest is the current signed lease.
	const signedDocs = $derived(
		documents
			.filter((d) => d.kind === 'signed_lease')
			.sort((a, b) => b.created.localeCompare(a.created))
	);
	const current = $derived(signedDocs[0] ?? null);
	const versions = $derived(signedDocs.slice(1));

	let previewOpen = $state(false);

	// ---- upload (management only) --------------------------------------------
	let fileInput: HTMLInputElement | null = $state(null);
	let uploading = $state(false);
	let progress = $state(0);
	let uploadError = $state('');
	let uploadSuccess = $state('');

	function startUpload(file: File) {
		uploadError = '';
		uploadSuccess = '';
		if (file.type !== 'application/pdf') {
			uploadError = 'Only PDF files are accepted.';
			return;
		}
		uploading = true;
		progress = 0;
		const fd = new FormData();
		fd.append('lease', lease.id);
		fd.append('file', file);
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/dashboard/manage/signed-lease');
		xhr.setRequestHeader('Accept', 'application/json');
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) progress = Math.round((e.loaded / e.total) * 100);
		};
		xhr.onload = async () => {
			uploading = false;
			if (xhr.status >= 200 && xhr.status < 300) {
				progress = 100;
				uploadSuccess = 'Signed lease saved to PocketBase.';
				previewOpen = false;
				await invalidateAll(); // refresh page data so the new version appears
			} else {
				try {
					uploadError = JSON.parse(xhr.responseText).message ?? `Upload failed (${xhr.status}).`;
				} catch {
					uploadError = xhr.responseText || `Upload failed (${xhr.status}).`;
				}
			}
		};
		xhr.onerror = () => {
			uploading = false;
			uploadError = 'Network error during upload.';
		};
		xhr.send(fd);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay />
		<Dialog.Content
			class="bg-card text-card-foreground mx-4 max-h-[85dvh] max-w-lg overflow-y-auto rounded-xl border p-6 shadow-lg"
		>
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					Lease — {lease.expand?.tenant?.name || lease.expand?.tenant?.email || 'Tenant'}
				</Dialog.Title>
				<Dialog.Description>The original signed lease PDF and a summary of the lease terms.</Dialog.Description>
			</Dialog.Header>

			<div class="mt-4 flex flex-col gap-5">
				<!-- Lease summary (reference only — the signed PDF below is the agreement) -->
				<div class="flex flex-col gap-2">
					<div>
						<p class="text-sm font-medium">Lease summary</p>
						<p class="text-muted-foreground text-xs">
							Quick reference — the signed lease PDF below is the agreement.
						</p>
					</div>
					<div class="grid grid-cols-2 gap-3 text-sm">
						<div>
							<p class="text-muted-foreground">Status</p>
							<StatusBadge status={lease.status} />
						</div>
						<div>
							<p class="text-muted-foreground">Tenant</p>
							<p class="font-medium">{lease.expand?.tenant?.name || '—'}</p>
						</div>
						<div>
							<p class="text-muted-foreground">Start</p>
							<p class="font-medium">{formatDate(lease.start_date)}</p>
						</div>
						<div>
							<p class="text-muted-foreground">End</p>
							<p class="font-medium">{formatDate(lease.end_date)}</p>
						</div>
						<div>
							<p class="text-muted-foreground">Monthly rent</p>
							<p class="font-medium">{formatMoney(lease.monthly_rent_cents)}</p>
						</div>
						<div>
							<p class="text-muted-foreground">Security deposit</p>
							<p class="font-medium">{formatMoney(lease.deposit_cents)}</p>
						</div>
					</div>
				</div>

				<!-- Signed lease -->
				<div class="flex flex-col gap-3 rounded-lg border p-4">
					<div>
						<p class="flex items-center gap-2 text-sm font-medium">
							<FileText class="text-gold size-4" /> Signed lease PDF
						</p>
						<p class="text-muted-foreground mt-0.5 text-xs">
							Original uploaded PDF signed by landlord and tenant.
						</p>
					</div>

					{#if current}
						<div class="flex flex-col gap-1 text-sm">
							<p class="flex items-center gap-1.5 font-medium">
								<FileText class="text-muted-foreground size-4 shrink-0" />{current.title}
							</p>
							<p class="text-muted-foreground text-xs">
								Uploaded {formatDate(current.created)}
								{versions.length > 0 ? `· ${versions.length} earlier version${versions.length === 1 ? '' : 's'} kept` : ''}
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
							<Button
								variant="outline"
								size="sm"
								class="min-h-12"
								onclick={() => (previewOpen = !previewOpen)}
							>
								<Eye class="size-4" /> {previewOpen ? 'Hide view' : 'View'}
							</Button>
							<Button
								href={docUrl(current.id, current.file)}
								target="_blank"
								rel="noreferrer"
								variant="outline"
								size="sm"
								class="min-h-12"
							>
								<ExternalLink class="size-4" /> Open in new tab
							</Button>
							<Button
								href="{docUrl(current.id, current.file)}?download=1"
								download="{current.title}.pdf"
								variant="outline"
								size="sm"
								class="min-h-12"
							>
								<Download class="size-4" /> Download
							</Button>
						</div>
						{#if previewOpen}
							<iframe
								src={docUrl(current.id, current.file)}
								title="Signed lease preview"
								class="h-96 w-full rounded-md border"
							></iframe>
						{/if}
					{:else}
						<p class="text-muted-foreground text-sm">Signed lease PDF not uploaded yet.</p>
					{/if}

					{#if canManage}
						<div class="flex flex-col gap-2">
							<input
								bind:this={fileInput}
								type="file"
								accept="application/pdf"
								class="hidden"
								onchange={(e) => {
									const f = e.currentTarget.files?.[0];
									if (f) startUpload(f);
									e.currentTarget.value = '';
								}}
							/>
							<Button
								class="min-h-12 w-full sm:w-fit"
								disabled={uploading}
								onclick={() => fileInput?.click()}
							>
								<Upload class="size-4" />
								{uploading ? 'Uploading…' : current ? 'Replace signed lease PDF' : 'Upload signed lease PDF'}
							</Button>
							{#if uploading}
								<div
									class="bg-muted h-2 w-full overflow-hidden rounded-full"
									role="progressbar"
									aria-valuenow={progress}
									aria-valuemin={0}
									aria-valuemax={100}
								>
									<div class="bg-turquoise h-full transition-all" style="width: {progress}%"></div>
								</div>
								<p class="text-muted-foreground text-xs">{progress}% uploaded</p>
							{/if}
							{#if uploadSuccess}
								<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm">{uploadSuccess}</p>
							{/if}
							{#if uploadError}
								<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
									{uploadError}
								</p>
							{/if}
							<p class="text-muted-foreground text-xs">
								Replacing keeps every earlier signed version linked to this lease below. Lease dates
								and status are not affected.
							</p>
						</div>
					{/if}

					{#if versions.length > 0}
						<div class="flex flex-col gap-1">
							<p class="text-muted-foreground text-xs font-medium">Earlier versions</p>
							<ul class="divide-y rounded-md border text-sm">
								{#each versions as v (v.id)}
									<li class="flex items-center justify-between gap-2 p-2">
										<span>{v.title}</span>
										<a
											href={docUrl(v.id, v.file)}
											target="_blank"
											rel="noreferrer"
											class="text-ocean text-xs underline-offset-4 hover:underline"
										>
											Open
										</a>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			</div>

			<Dialog.Footer>
				<Dialog.Close class="min-h-12 w-full rounded-md border px-4 text-sm font-medium sm:w-auto">
					Close
				</Dialog.Close>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
