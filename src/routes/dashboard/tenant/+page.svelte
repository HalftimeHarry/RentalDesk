<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import MessageThread from '$lib/components/MessageThread.svelte';
	import MaintenancePhotos from '$lib/components/MaintenancePhotos.svelte';
	import MoveOutNoticeDialog from '$lib/components/MoveOutNoticeDialog.svelte';
	import LeaseDetailsDialog from '$lib/components/LeaseDetailsDialog.svelte';
	import BillingStatement from '$lib/components/BillingStatement.svelte';
	import { docUrl, isImageFile, maintenancePhotoError, MAINTENANCE_PHOTO, noticePdfUrl, daysBetween } from '$lib/files';
	import { formatDate, formatMoney } from '$lib/format';
	import { billStatus, monthLabel } from '$lib/billing';
	import type { Charge, DocRecord, MoveOutNotice } from '$lib/types';
	import { Eye, FileText, House, Receipt, Wallet, ClipboardCheck, Wrench, MessageSquare, ShieldCheck, Zap, Check, Copy, HandCoins, Camera, LogOut, X } from '@lucide/svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let lease = $derived(data.lease);
	let leaseOpen = $state(false);
	let cleaningReceipts = $derived(data.documents.filter((d) => d.kind === 'receipt'));

	// Move-out notice dialog (null = new notice; a notice = correction/new version).
	let noticeOpen = $state(false);
	let noticeCorrectFrom = $state<MoveOutNotice | null>(null);
	// A notice is superseded when a newer version points at it — originals persist.
	const supersededNoticeIds = $derived(
		new Set(data.moveOutNotices.map((n) => n.supersedes).filter(Boolean))
	);
	const latestNotice = $derived(data.moveOutNotices.find((n) => !supersededNoticeIds.has(n.id)));

	// Zelle instructions are display-only: copy the phone number to the clipboard
	// with a brief confirmation; nothing here processes or records a payment.
	const zellePhone = '(626) 222-3107';
	let zelleCopied = $state(false);
	let zelleCopyTimer: ReturnType<typeof setTimeout> | undefined;
	async function copyZellePhone() {
		try {
			await navigator.clipboard.writeText(zellePhone);
			zelleCopied = true;
			clearTimeout(zelleCopyTimer);
			zelleCopyTimer = setTimeout(() => (zelleCopied = false), 2000);
		} catch {
			// Clipboard unavailable (e.g. insecure context) — leave the button unchanged.
		}
	}

	// ---- maintenance photos ---------------------------------------------------
	// Picker state for the create form: local previews until the request is sent.
	let photoInput = $state<HTMLInputElement | null>(null);
	let picked = $state<{ file: File; url: string }[]>([]);
	let photoPickError = $state('');
	let mUploading = $state(false);
	let mProgress = $state(0);
	let mMessage = $state('');
	let mError = $state('');

	function pickPhotos(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const chosen = [...(input.files ?? [])];
		input.value = ''; // allow picking the same file again later
		photoPickError = '';
		mError = '';
		const err = maintenancePhotoError([...picked.map((p) => p.file), ...chosen]);
		if (err) {
			photoPickError = err;
			return;
		}
		for (const file of chosen) {
			picked.push({ file, url: URL.createObjectURL(file) });
		}
	}

	function removePicked(index: number) {
		const [removed] = picked.splice(index, 1);
		if (removed) URL.revokeObjectURL(removed.url);
	}

	/** Parse a SvelteKit action response (data may arrive plain or devalue-encoded). */
	function parseActionResponse(responseText: string, status: number): { ok: boolean; message: string } {
		try {
			const res = JSON.parse(responseText);
			const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
			if (res.type === 'success') return { ok: true, message: data?.message ?? 'Done.' };
			return { ok: false, message: data?.message ?? `Request failed (${status}).` };
		} catch {
			return { ok: false, message: `Unexpected server response (${status}).` };
		}
	}

	/** Submit a new request via XHR so photo upload progress can be shown. */
	function submitMaintenance(e: SubmitEvent) {
		e.preventDefault();
		const formEl = e.currentTarget as HTMLFormElement;
		const title = (formEl.elements.namedItem('title') as HTMLInputElement)?.value.trim() ?? '';
		const description =
			(formEl.elements.namedItem('description') as HTMLTextAreaElement)?.value.trim() ?? '';
		mError = '';
		mMessage = '';
		if (!title || !description) {
			mError = 'Title and description are required.';
			return;
		}
		mUploading = true;
		mProgress = 0;
		const fd = new FormData();
		fd.append('title', title);
		fd.append('description', description);
		for (const p of picked) fd.append('photos', p.file, p.file.name);
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '?/createMaintenance');
		xhr.setRequestHeader('Accept', 'application/json');
		xhr.upload.onprogress = (ev) => {
			if (ev.lengthComputable) mProgress = Math.round((ev.loaded / ev.total) * 100);
		};
		xhr.onload = async () => {
			mUploading = false;
			const res = parseActionResponse(xhr.responseText, xhr.status);
			if (res.ok) {
				mMessage = res.message;
				for (const p of picked) URL.revokeObjectURL(p.url);
				picked = [];
				formEl.reset();
				await invalidateAll();
			} else {
				mError = res.message;
			}
		};
		xhr.onerror = () => {
			mUploading = false;
			mError = 'Network error during upload.';
		};
		xhr.send(fd);
	}

	// ---- add photos to an existing request (append; earlier photos preserved) --
	let addInput = $state<HTMLInputElement | null>(null);
	let addFor = $state(''); // request id the shared picker is targeting
	let addUploading = $state(''); // request id currently uploading, '' when idle
	let addProgress = $state(0);
	let addError = $state('');
	let addMessage = $state('');

	function startAddPhotos(id: string) {
		addFor = id;
		addError = '';
		addMessage = '';
		addInput?.click();
	}

	function appendPhotos(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const chosen = [...(input.files ?? [])];
		input.value = '';
		if (!addFor || chosen.length === 0) return;
		const err = maintenancePhotoError(chosen);
		if (err) {
			addError = err;
			return;
		}
		addUploading = addFor;
		addProgress = 0;
		const fd = new FormData();
		fd.append('id', addFor);
		for (const f of chosen) fd.append('photos', f, f.name);
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '?/addMaintenancePhotos');
		xhr.setRequestHeader('Accept', 'application/json');
		xhr.upload.onprogress = (ev) => {
			if (ev.lengthComputable) addProgress = Math.round((ev.loaded / ev.total) * 100);
		};
		xhr.onload = async () => {
			addUploading = '';
			const res = parseActionResponse(xhr.responseText, xhr.status);
			if (res.ok) {
				addMessage = res.message;
				await invalidateAll();
			} else {
				addError = res.message;
			}
		};
		xhr.onerror = () => {
			addUploading = '';
			addError = 'Network error during upload.';
		};
		xhr.send(fd);
	}

	// Bill attachments keyed by charge for the statement rows.
	const billDocsMap = $derived(
		Object.fromEntries(
			data.documents
				.filter((d) => d.kind === 'bill' && d.charge)
				.map((d) => [d.charge, { url: docUrl(d.id, d.file) }])
		)
	);
	let ledger = $derived(data.ledger);
	let depositRemaining = $derived(Math.max(0, (lease?.deposit_cents ?? 0) - ledger.depositPaid));

	// Itemized account balance: each published charge's remaining balance.
	// Drafts never reach the client (API rules); the filter is belt-and-suspenders.
	function shortLabel(c: Charge): string {
		if (c.type === 'deposit') return 'Security deposit';
		const month = c.period ? monthLabel(c.period).split(' ')[0] : '';
		if (c.type === 'rent') return `${month} ${c.prorated ? 'partial rent' : 'rent'}`;
		if (c.type === 'late_fee') return `${month} late fee`.trim();
		// utilities: "AT&T reimbursement — service Nov 2026" -> "November AT&T"
		const who = c.description.split(' reimbursement')[0].split(' — ')[0].trim();
		return `${month} ${who}`.trim();
	}
	// Deposit row: from the published deposit charge when billed, otherwise from the
	// lease requirement (tagged "not yet billed" — it is not part of the billed total).
	const depositRow = $derived.by(() => {
		const dc = data.charges.find((c) => c.type === 'deposit' && c.status === 'published');
		if (dc) {
			const remaining = Math.max(0, dc.amount_cents - paidFor(dc));
			return remaining > 0 ? { remaining, billed: true } : null;
		}
		if (lease && lease.deposit_cents > 0 && depositRemaining > 0) {
			return { remaining: depositRemaining, billed: false };
		}
		return null;
	});
	// Outstanding items, largest remaining balance first. Drafts never reach the client
	// (API rules); the published-only filter is belt-and-suspenders. The deposit joins
	// the same ordering but keeps its own styling in the list.
	const balanceItems = $derived.by(() => {
		const items: (
			| { kind: 'charge'; c: Charge; remaining: number }
			| { kind: 'deposit'; remaining: number; billed: boolean }
		)[] = data.charges
			.filter((c) => c.status === 'published' && c.type !== 'deposit')
			.map((c) => ({
				kind: 'charge' as const,
				c,
				remaining: Math.max(0, c.amount_cents - paidFor(c))
			}))
			.filter((r) => r.remaining > 0);
		if (depositRow) {
			items.push({ kind: 'deposit', remaining: depositRow.remaining, billed: depositRow.billed });
		}
		return items.sort((a, b) => b.remaining - a.remaining);
	});
	const chargeTypeLabels: Record<string, string> = {
		rent: 'Rent',
		deposit: 'Deposit',
		late_fee: 'Late fee',
		other: 'Other'
	};

	// Per-charge payment allocation and remaining balance.
	function paidFor(c: Charge): number {
		return data.payments.filter((p) => p.charge === c.id).reduce((s, p) => s + p.amount_cents, 0);
	}
	function statusOf(c: Charge) {
		return billStatus(c, paidFor(c));
	}
	function remainingOf(c: Charge) {
		return Math.max(0, c.amount_cents - paidFor(c));
	}
	function calcSummary(c: Charge): string {
		const calc = c.calc;
		if (!calc) return '';
		const monthly = formatMoney(calc.monthly_rate_cents);
		if (calc.basis === '30-day') {
			return `${monthly}/mo ÷ 30 days × ${calc.billable_days} day${calc.billable_days === 1 ? '' : 's'} = ${formatMoney(calc.amount_cents)}`;
		}
		if (calc.basis === 'actual') {
			return (
				`${monthly}/mo, actual calendar days: ` +
				calc.portions
					.map((p) => `${p.days}d in ${p.month} (${p.days_in_month}-day month)`)
					.join(' + ') +
				` = ${formatMoney(calc.amount_cents)}`
			);
		}
		return '';
	}
	function billDocFor(c: Charge): DocRecord | undefined {
		return data.documents.find((d) => d.charge === c.id && d.kind === 'bill');
	}
	const methodLabels: Record<string, string> = {
		cash: 'Cash',
		check: 'Check',
		zelle: 'Zelle',
		venmo: 'Venmo',
		bank_transfer: 'Bank transfer',
		other: 'Other'
	};
	const inspectionLabels: Record<string, string> = {
		move_in: 'Move-in',
		move_out: 'Move-out',
		periodic: 'Periodic'
	};
</script>

<svelte:head>
	<title>Tenant dashboard — RentalDesk</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight text-white drop-shadow-sm">Tenant dashboard</h1>
		<p class="text-white/85 drop-shadow-sm">Welcome, {data.user.name || data.user.email}.</p>
	</div>

	{#if !lease}
		<Card>
			<CardContent class="text-muted-foreground py-8 text-center text-sm">
				No lease is linked to your account yet. Contact the management team if you believe this
				is a mistake.
			</CardContent>
		</Card>
	{:else}
		<!-- Account balance -->
		<Card>
			<CardHeader class="pb-2">
				<CardTitle class="flex items-center gap-2">
					<Wallet class="text-ocean size-5" /> Account balance
				</CardTitle>
				<CardDescription>Outstanding charges.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if balanceItems.length === 0}
					<p class="text-muted-foreground text-sm">
						Nothing due — all published charges are settled.
					</p>
				{:else}
					<ul class="flex flex-col">
						{#each balanceItems as item (item.kind === 'charge' ? item.c.id : 'deposit')}
							{#if item.kind === 'charge'}
								{@const Icon = item.c.type === 'rent' ? House : item.c.type === 'late_fee' ? Receipt : Zap}
								<li class="flex items-center gap-3 py-2.5">
									<Icon class="text-ocean size-4 shrink-0" />
									<span class="min-w-0 flex-1 truncate text-sm">{shortLabel(item.c)}</span>
									<span class="shrink-0 text-sm font-medium tabular-nums">
										{formatMoney(item.remaining)}
									</span>
								</li>
							{:else}
								<li class="bg-sand/70 -mx-2 my-0.5 flex items-center gap-3 rounded-lg px-2 py-2.5">
									<ShieldCheck class="text-turquoise size-4 shrink-0" />
									<span class="min-w-0 flex-1 text-sm">
										Security deposit
										<span class="text-muted-foreground block text-xs">
											Required: {formatMoney(lease.deposit_cents)} · {item.billed
												? 'held separately'
												: 'not yet billed — not in the total below'}
										</span>
									</span>
									<span class="shrink-0 text-sm font-medium tabular-nums">
										{formatMoney(item.remaining)}
									</span>
								</li>
							{/if}
						{/each}
					</ul>
					<hr class="border-border my-3" />
					<div class="flex items-center justify-between gap-3">
						<span class="text-sm font-semibold">Total balance due</span>
						<span class="text-navy text-xl font-bold tabular-nums">
							{formatMoney(ledger.totalBalance)}
						</span>
					</div>

					<!-- How to pay: instructions only — no payment is processed or recorded here. -->
					<div class="bg-seafoam/50 border-turquoise/25 mt-4 rounded-xl border p-4">
						<p class="text-navy flex items-center gap-2 text-sm font-semibold">
							<HandCoins class="text-turquoise size-5" /> Pay with Zelle
						</p>
						<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
							<div class="text-sm">
								<p class="text-navy font-medium">Dustin Dinsmore</p>
								<p class="text-muted-foreground tabular-nums">{zellePhone}</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								class="ml-auto min-h-12"
								onclick={copyZellePhone}
							>
								{#if zelleCopied}
									<Check class="size-4" /> Copied!
								{:else}
									<Copy class="size-4" /> Copy phone number
								{/if}
							</Button>
							<span class="sr-only" aria-live="polite">
								{zelleCopied ? 'Phone number copied to clipboard' : ''}
							</span>
						</div>
						<p class="text-muted-foreground mt-3 text-xs">
							Please include your name and unit number in the payment memo.
						</p>
					</div>
				{/if}
			</CardContent>
		</Card>

		<!-- Lease -->
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between gap-2">
					<CardTitle class="flex items-center gap-2">
						<House class="text-ocean size-5" /> Lease
					</CardTitle>
					<div class="flex flex-wrap items-center gap-2">
						<StatusBadge status={lease.status} />
						<Button variant="outline" size="sm" class="min-h-12" onclick={() => (leaseOpen = true)}>
							<Eye class="size-4" /> View summarized lease
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="min-h-12"
							onclick={() => {
								noticeCorrectFrom = null;
								noticeOpen = true;
							}}
						>
							<LogOut class="size-4" /> Give move-out notice
						</Button>
						<LeaseDetailsDialog bind:open={leaseOpen} {lease} documents={data.documents} canManage={false} />
						<MoveOutNoticeDialog
							bind:open={noticeOpen}
							tenantName={data.user.name || data.user.email}
							address={data.settings?.address ?? ''}
							unit={data.settings?.unit_name ?? ''}
							{form}
							correctFrom={noticeCorrectFrom}
						/>
					</div>
				</div>
				<CardDescription>
					{formatDate(lease.start_date)} – {formatDate(lease.end_date)} · {formatMoney(
						lease.monthly_rent_cents
					)}/month · deposit {formatMoney(lease.deposit_cents)}
				</CardDescription>
			</CardHeader>
			{#if data.documents.length > 0}
				<CardContent>
					<p class="mb-2 text-sm font-medium">Lease documents</p>
					<ul class="divide-y rounded-md border">
						{#each data.documents as doc (doc.id)}
							<li class="flex items-center gap-3 p-3 text-sm">
								{#if isImageFile(doc.file)}
									<img
										src="{docUrl(doc.id, doc.file)}?thumb=100x100"
										alt=""
										class="size-10 shrink-0 rounded border object-cover"
									/>
								{:else}
									<FileText class="text-muted-foreground size-4 shrink-0" />
								{/if}
								<a
									class="font-medium underline-offset-4 hover:underline"
									href={docUrl(doc.id, doc.file)}
									target="_blank"
									rel="noreferrer">{doc.title}</a
								>
								<span class="text-muted-foreground ml-auto">{formatDate(doc.created)}</span>
							</li>
						{/each}
					</ul>
				</CardContent>
			{/if}
			<CardContent class="flex flex-col gap-3">
				<p class="text-sm font-medium">Move-out notice</p>
				{#if form?.section === 'notice'}
					<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm">{form.message}</p>
				{/if}
				{#if data.moveOutNotices.length === 0}
					<p class="text-muted-foreground text-sm">
						No move-out notice submitted. Use “Give move-out notice” above if you plan to
						end your tenancy.
					</p>
				{:else}
					<ul class="divide-y rounded-md border text-sm">
						{#each data.moveOutNotices as n (n.id)}
							{@const superseded = supersededNoticeIds.has(n.id)}
							<li class="flex flex-col gap-1.5 p-3">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<span class="font-medium">Move-out on {formatDate(n.requested_date)}</span>
									<span
										class={superseded
											? 'bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px] font-semibold'
											: n.status === 'acknowledged'
												? 'rounded bg-emerald-200 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-900'
												: 'rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900'}
									>
										{superseded
											? 'Superseded'
											: n.status === 'acknowledged'
												? 'Acknowledged'
												: 'Submitted'}
									</span>
								</div>
								<p class="text-muted-foreground text-xs">
									Submitted {formatDate(n.submitted_at)} · {daysBetween(n.submitted_at, n.requested_date)} days' notice{#if n.agreed_termination_date}&nbsp;· Agreed termination: {formatDate(n.agreed_termination_date)}{/if}
								</p>
								<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
									{#if n.notice_pdf}
										<a
											class="text-ocean underline-offset-4 hover:underline"
											href={noticePdfUrl(n.id, n.notice_pdf)}
											target="_blank"
											rel="noreferrer">View notice PDF</a
										>
										<a
											class="text-ocean underline-offset-4 hover:underline"
											href="{noticePdfUrl(n.id, n.notice_pdf)}?download=1">Download</a
										>
									{/if}
									{#if !superseded && latestNotice?.id === n.id}
										<button
											type="button"
											class="text-ocean font-medium underline-offset-4 hover:underline"
											onclick={() => {
												noticeCorrectFrom = n;
												noticeOpen = true;
											}}
										>
											Submit a correction
										</button>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
				{/if}

				<!-- Move-out cleaning expectations + cleaning-receipt upload -->
				<div class="mt-2 flex flex-col gap-3 rounded-lg border p-4">
					<p class="flex items-center gap-2 text-sm font-medium">
						<Receipt class="text-ocean size-4" /> Move-out cleaning
					</p>
					<p class="text-sm">
						Please return the property to the same level of cleanliness as when you moved in,
						allowing for ordinary wear and tear. Arrange and pay for any cleaning necessary to
						meet that standard.
					</p>
					<p class="text-sm">
						Cecilia’s Cleaning prepared the property before your move-in. If you would like to
						use the same service, contact Cecilia at
						<a class="text-ocean font-medium underline-offset-4 hover:underline" href="tel:+16195916300">619-591-6300</a>.
						You may choose another cleaning service.
					</p>
					<p class="text-sm">
						If you use a professional cleaner, please upload the receipt here when available.
					</p>
					{#if form?.section === 'receipt'}
						<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm">{form.message}</p>
					{/if}
					{#if cleaningReceipts.length > 0}
						<ul class="flex flex-col gap-1 text-sm">
							{#each cleaningReceipts as r (r.id)}
								<li>
									<a
										class="text-ocean underline-offset-4 hover:underline"
										href={docUrl(r.id, r.file)}
										target="_blank"
										rel="noreferrer">{r.title}</a
									>
									<span class="text-muted-foreground"> · {formatDate(r.created)}</span>
								</li>
							{/each}
						</ul>
					{/if}
					<form
						method="POST"
						action="?/uploadReceipt"
						enctype="multipart/form-data"
						class="flex flex-col gap-3 sm:flex-row sm:items-end"
					>
						<div class="flex flex-1 flex-col gap-2">
							<Label for="cleaning-receipt">Cleaning receipt (PDF, JPEG, or PNG)</Label>
							<Input
								id="cleaning-receipt"
								name="files"
								type="file"
								accept="application/pdf,image/jpeg,image/png"
								required
							/>
						</div>
						<Button type="submit" variant="outline" class="min-h-12">Upload receipt</Button>
					</form>
				</div>
			</CardContent>
		</Card>

		<!-- Monthly statements -->
		<div class="flex flex-col gap-4">
			<h2 class="text-lg font-semibold tracking-tight text-white drop-shadow-sm">
				Monthly statements
			</h2>
			<BillingStatement
				charges={data.charges}
				payments={data.payments}
				billDocs={billDocsMap}
				printHref={(m) => `/dashboard/billing/statement?month=${m}`}
			/>
		</div>

		<!-- Payments -->
		<Card>
			<CardHeader>
				<CardTitle class="flex items-center gap-2">
					<Wallet class="text-turquoise size-5" /> Payments
				</CardTitle>
				<CardDescription>
					Payments are made outside the app and recorded by the management team once received.
					Message them if something looks off.
				</CardDescription>
				{#if data.settings?.zelle_instructions}
					<p class="bg-ocean/10 text-navy mx-6 rounded-md px-3 py-2 text-sm">
						<strong>Pay with Zelle:</strong> {data.settings.zelle_instructions}
					</p>
				{/if}
			</CardHeader>
			<CardContent>
				{#if data.payments.length === 0}
					<p class="text-muted-foreground text-sm">No payments recorded yet.</p>
				{:else}
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Date</TableHead>
								<TableHead>Method</TableHead>
								<TableHead>Applies to</TableHead>
								<TableHead>Note</TableHead>
								<TableHead class="text-right">Amount</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{#each data.payments as p (p.id)}
								<TableRow>
									<TableCell>{formatDate(p.date)}</TableCell>
									<TableCell>{methodLabels[p.method] ?? p.method}</TableCell>
									<TableCell>{p.applies_to === 'deposit' ? 'Deposit' : 'Rent'}</TableCell>
									<TableCell class="text-muted-foreground">{p.note}</TableCell>
									<TableCell class="text-right font-medium">{formatMoney(p.amount_cents)}</TableCell
									>
								</TableRow>
							{/each}
						</TableBody>
					</Table>
				{/if}
			</CardContent>
		</Card>

		<div class="grid gap-6 lg:grid-cols-2">
			<!-- Inspections -->
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2">
						<ClipboardCheck class="text-ocean size-5" /> Inspections
					</CardTitle>
					<CardDescription>Scheduled and completed inspections for your lease.</CardDescription>
				</CardHeader>
				<CardContent>
					{#if data.inspections.length === 0}
						<p class="text-muted-foreground text-sm">No inspections scheduled.</p>
					{:else}
						<ul class="divide-y rounded-md border">
							{#each data.inspections as i (i.id)}
								<li class="p-3 text-sm">
								<div class="flex items-center justify-between gap-2">
									<span class="font-medium">{inspectionLabels[i.type] ?? i.type}</span>
									<span class="text-muted-foreground">{formatDate(i.date)}</span>
								</div>
								{#if i.notes}
									<p class="text-muted-foreground mt-1">{i.notes}</p>
								{/if}
								<a
									href="/dashboard/inspections/{i.id}/print"
									class="text-ocean text-xs underline-offset-4 hover:underline"
								>
									View inspection report
								</a>
								</li>
							{/each}
						</ul>
					{/if}
				</CardContent>
			</Card>

			<!-- Maintenance -->
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2">
						<Wrench class="text-coral size-5" /> Maintenance requests
					</CardTitle>
					<CardDescription>Report an issue and track its status.</CardDescription>
				</CardHeader>
				<CardContent class="flex flex-col gap-4">
					{#if form?.section === 'maintenance'}
						<p class="bg-muted rounded-md px-3 py-2 text-sm">{form.message}</p>
					{/if}
					<form
						method="POST"
						action="?/createMaintenance"
						enctype="multipart/form-data"
						onsubmit={submitMaintenance}
						class="flex flex-col gap-3"
					>
						<div class="flex flex-col gap-2">
							<Label for="m-title">Title</Label>
							<Input id="m-title" name="title" placeholder="e.g. Kitchen faucet leaks" required />
						</div>
						<div class="flex flex-col gap-2">
							<Label for="m-desc">Description</Label>
							<Textarea id="m-desc" name="description" rows={2} required />
						</div>
						<div class="flex flex-col gap-2">
							<Label>Photos (optional)</Label>
							<input
								bind:this={photoInput}
								type="file"
								accept={MAINTENANCE_PHOTO.accept}
								multiple
								class="hidden"
								onchange={pickPhotos}
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="min-h-12 w-full sm:w-fit"
								onclick={() => photoInput?.click()}
							>
								<Camera class="size-4" /> Add photos
							</Button>
							<p class="text-muted-foreground text-xs">
								Up to {MAINTENANCE_PHOTO.maxCount} photos · JPEG, PNG, or WebP · 5 MB each.
								On your phone you can pick from the gallery or take a new photo.
							</p>
							{#if photoPickError}
								<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
									{photoPickError}
								</p>
							{/if}
							{#if picked.length > 0}
								<ul class="flex flex-wrap gap-2">
									{#each picked as p, i (p.url)}
										<li class="relative">
											<img
												src={p.url}
												alt="Selected attachment {i + 1}"
												class="size-20 rounded-lg border object-cover"
											/>
											<button
												type="button"
												class="bg-navy/80 absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full text-white"
												onclick={() => removePicked(i)}
												aria-label="Remove photo {i + 1}"
											>
												<X class="size-3.5" />
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
						{#if mError}
							<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">{mError}</p>
						{/if}
						{#if mMessage}
							<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm">{mMessage}</p>
						{/if}
						{#if mUploading}
							<div
								class="bg-muted h-2 w-full overflow-hidden rounded-full"
								role="progressbar"
								aria-valuenow={mProgress}
								aria-valuemin={0}
								aria-valuemax={100}
							>
								<div class="bg-turquoise h-full transition-all" style="width: {mProgress}%"></div>
							</div>
							<p class="text-muted-foreground text-xs">{mProgress}% uploaded</p>
						{/if}
						<Button type="submit" size="sm" class="self-end" disabled={mUploading}>
							{mUploading ? 'Uploading…' : 'Submit request'}
						</Button>
					</form>
					{#if data.maintenance.length > 0}
						<input
							bind:this={addInput}
							type="file"
							accept={MAINTENANCE_PHOTO.accept}
							multiple
							class="hidden"
							onchange={appendPhotos}
						/>
						<ul class="divide-y rounded-md border">
							{#each data.maintenance as m (m.id)}
								<li class="p-3 text-sm">
									<div class="flex items-center justify-between gap-2">
										<span class="font-medium">{m.title}</span>
										<StatusBadge status={m.status} />
									</div>
									<p class="text-muted-foreground mt-1">{m.description}</p>
									{#if m.photos && m.photos.length > 0}
										<div class="mt-2">
											<MaintenancePhotos recordId={m.id} photos={m.photos} />
										</div>
									{/if}
									<div class="mt-2 flex flex-wrap items-center gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											class="min-h-9"
											disabled={addUploading !== ''}
											onclick={() => startAddPhotos(m.id)}
										>
											<Camera class="size-4" /> Add photos
										</Button>
										{#if addUploading === m.id}
											<div
												class="bg-muted h-2 w-32 overflow-hidden rounded-full"
												role="progressbar"
												aria-valuenow={addProgress}
												aria-valuemin={0}
												aria-valuemax={100}
											>
												<div class="bg-turquoise h-full transition-all" style="width: {addProgress}%"></div>
											</div>
											<span class="text-muted-foreground text-xs">{addProgress}%</span>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
						{#if addError}
							<p class="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">{addError}</p>
						{/if}
						{#if addMessage}
							<p class="bg-turquoise/15 text-navy rounded-md px-3 py-2 text-sm">{addMessage}</p>
						{/if}
					{/if}
				</CardContent>
			</Card>
		</div>
	{/if}

	<!-- Messages -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<MessageSquare class="text-turquoise size-5" /> Messages
			</CardTitle>
			<CardDescription>Chat with the management team.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.section === 'messages'}
				<p class="bg-muted mb-3 rounded-md px-3 py-2 text-sm">{form.message}</p>
			{/if}
			<MessageThread
				messages={data.messages}
				currentUserId={data.user.id}
				recipientLabel={data.contact?.name || 'Management'}
			/>
		</CardContent>
	</Card>
</div>
