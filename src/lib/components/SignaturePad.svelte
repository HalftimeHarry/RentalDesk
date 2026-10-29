<script lang="ts">
	import { onMount } from 'svelte';
	import { cn } from '$lib/utils';
	import { Eraser, Redo2 } from '@lucide/svelte';

	type Point = { x: number; y: number };

	let {
		label,
		disabled = false,
		onchange
	}: {
		label: string;
		disabled?: boolean;
		onchange?: (empty: boolean) => void;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state(undefined);
	let hasStrokes = $state(false);

	let strokes: Point[][] = [];
	let redoStack: Point[][] = $state([]);
	let drawing = false;
	let current: Point[] = [];

	function ctx(): CanvasRenderingContext2D | null {
		return canvas?.getContext('2d') ?? null;
	}

	function setupCanvas() {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const rect = canvas.getBoundingClientRect();
		canvas.width = Math.max(1, Math.round(rect.width * dpr));
		canvas.height = Math.max(1, Math.round(rect.height * dpr));
		const c = ctx();
		if (!c) return;
		c.setTransform(dpr, 0, 0, dpr, 0, 0);
		c.lineWidth = 2.5;
		c.lineCap = 'round';
		c.lineJoin = 'round';
		c.strokeStyle = '#16324F';
		repaint();
	}

	function repaint() {
		const c = ctx();
		if (!c || !canvas) return;
		c.clearRect(0, 0, canvas.width, canvas.height);
		for (const stroke of strokes) drawStroke(c, stroke);
	}

	function drawStroke(c: CanvasRenderingContext2D, pts: Point[]) {
		if (pts.length === 0) return;
		c.beginPath();
		c.moveTo(pts[0].x, pts[0].y);
		if (pts.length === 1) c.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
		for (const p of pts) c.lineTo(p.x, p.y);
		c.stroke();
	}

	function pointFrom(e: PointerEvent): Point {
		const r = canvas!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onPointerDown(e: PointerEvent) {
		if (disabled || !canvas) return;
		try {
			canvas.setPointerCapture(e.pointerId);
		} catch {
			// synthetic or already-released pointers can't be captured — drawing still works
		}
		drawing = true;
		current = [pointFrom(e)];
		redoStack = []; // a new stroke invalidates redo
	}

	function onPointerMove(e: PointerEvent) {
		if (!drawing || !canvas) return;
		e.preventDefault(); // extra guard; touch-action:none already blocks scrolling here
		current.push(pointFrom(e));
		const c = ctx();
		if (c) drawStroke(c, current.slice(-2));
	}

	function onPointerUp() {
		if (!drawing) return;
		drawing = false;
		if (current.length > 0) {
			strokes = [...strokes, current];
			current = [];
			hasStrokes = true;
			onchange?.(false);
		}
	}

	/** Clear keeps strokes redo-able until a new stroke is drawn. */
	export function clear() {
		if (strokes.length === 0) return;
		redoStack = strokes;
		strokes = [];
		repaint();
		hasStrokes = false;
		onchange?.(true);
	}

	export function redo() {
		if (redoStack.length === 0) return;
		strokes = redoStack;
		redoStack = [];
		repaint();
		hasStrokes = true;
		onchange?.(false);
	}

	export function isEmpty(): boolean {
		return strokes.length === 0;
	}

	export function toFile(filename: string): Promise<File | null> {
		return new Promise((resolve) => {
			if (!canvas || strokes.length === 0) return resolve(null);
			canvas.toBlob((blob) => {
				resolve(blob ? new File([blob], filename, { type: 'image/png' }) : null);
			}, 'image/png');
		});
	}

	onMount(() => {
		setupCanvas();
		const ro = new ResizeObserver(setupCanvas);
		if (canvas) ro.observe(canvas);
		return () => ro.disconnect();
	});
</script>

<div class="flex flex-col gap-2">
	<div
		class={cn(
			'border-navy/25 bg-card relative overflow-hidden rounded-xl border-2',
			disabled && 'opacity-60'
		)}
		role="group"
		aria-label={label}
	>
		<canvas
			bind:this={canvas}
			class="block h-40 w-full cursor-crosshair touch-none select-none"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerUp}
		></canvas>
		{#if !hasStrokes}
			<span class="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
				Sign here with a finger, stylus, or mouse
			</span>
		{/if}
	</div>
	<div class="flex gap-2">
		<button
			type="button"
			onclick={clear}
			disabled={disabled || !hasStrokes}
			class="border-navy/15 bg-card text-navy hover:bg-sand flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border text-sm font-medium disabled:opacity-50"
		>
			<Eraser class="size-4" /> Clear
		</button>
		<button
			type="button"
			onclick={redo}
			disabled={disabled || redoStack.length === 0}
			class="border-navy/15 bg-card text-navy hover:bg-sand flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border text-sm font-medium disabled:opacity-50"
		>
			<Redo2 class="size-4" /> Redo
		</button>
	</div>
</div>
