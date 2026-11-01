/**
 * Unit tests for the tenant payment-history PDF export (database-free).
 *
 * Covers the builder behind GET /dashboard/tenant/payments.pdf:
 *  - exporting MORE THAN FIVE payments includes every row (pagination on the
 *    dashboard never limits the export) in the given order
 *  - long notes wrap instead of being truncated
 *  - the column header row repeats on every PDF page
 *  - the total line is present
 *
 * Route authorization (tenant-only role guard + user-scoped PocketBase rules)
 * is exercised against the running local instance; see the PR/session notes.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPaymentHistoryPdf } from '../src/lib/server/pdf.ts';

const row = (i, extra = {}) => ({
	date: `Oct ${i + 1}, 2026`,
	method: 'Zelle',
	appliesTo: 'Rent',
	note: `Payment number ${i + 1}`,
	amount: `$${i + 1},000.00`,
	...extra
});

function build(rows) {
	return Buffer.from(
		buildPaymentHistoryPdf({
			address: '2728 B Street, San Diego, CA 92102',
			unitNumber: '102',
			tenantName: 'Test Tenant',
			generated: 'Nov 1, 2026',
			rows,
			total: '$9,999.99'
		})
	).toString('latin1');
}

test('exports all rows when there are more than five payments, in order', () => {
	const rows = Array.from({ length: 9 }, (_, i) => row(i));
	const pdf = build(rows);
	let last = -1;
	for (let i = 0; i < 9; i++) {
		const at = pdf.indexOf(`Payment number ${i + 1}`);
		assert.ok(at >= 0, `row ${i + 1} missing from PDF`);
		assert.ok(at > last, `row ${i + 1} out of order`);
		last = at;
	}
	assert.match(pdf, /Total payments/);
	assert.match(pdf, /\$9,999\.99/);
	assert.match(pdf, /Test Tenant/);
	assert.match(pdf, /Generated: Nov 1, 2026/);
	assert.match(pdf, /2728 B Street, San Diego, CA 92102/);
	assert.match(pdf, /\(Unit 102\) Tj/);
	// Address precedes the unit line in the masthead.
	assert.ok(pdf.indexOf('2728 B Street') < pdf.indexOf('(Unit 102) Tj'));
});

test('long notes wrap across lines instead of being cut off', () => {
	const longNote =
		'Partial payment covering the remaining October balance after the maintenance credit, ' +
		'confirmed by the management team on the first of the month';
	const pdf = build([row(0, { note: longNote })]);
	// The note cannot fit one 38-char column line, so it must be split — the
	// start and the end must both be present on separate text lines.
	assert.match(pdf, /Partial payment covering the/);
	assert.match(pdf, /first of the\s*month|of the month/);
	assert.doesNotMatch(pdf, new RegExp(longNote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('column headers repeat on every page of a multi-page export', () => {
	const rows = Array.from({ length: 80 }, (_, i) => row(i));
	const pdf = build(rows);
	const pageCount = Number(pdf.match(/\/Count (\d+)/)?.[1]);
	assert.ok(pageCount >= 2, `expected a multi-page PDF, got ${pageCount} page(s)`);
	const headerOccurrences = pdf.match(/\(Applies to\) Tj/g)?.length ?? 0;
	assert.equal(headerOccurrences, pageCount, 'header row must appear once per page');
	// Every row survives pagination.
	for (const i of [0, 39, 79]) assert.ok(pdf.includes(`Payment number ${i + 1}`));
});

test('single short page: one header, valid PDF structure', () => {
	const pdf = build([row(0)]);
	assert.ok(pdf.startsWith('%PDF-1.4'));
	assert.ok(pdf.trimEnd().endsWith('%%EOF'));
	assert.equal(pdf.match(/\(Applies to\) Tj/g)?.length, 1);
	assert.equal(Number(pdf.match(/\/Count (\d+)/)?.[1]), 1);
});
