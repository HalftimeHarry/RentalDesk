/**
 * Database-free validation for inspection cleanup eligibility.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { archiveRequiredReason, canDeleteInspection } from '../src/lib/inspection-cleanup.ts';

const baseDraft = {
	archived: false,
	stage: 'draft',
	sig_landlord: '',
	sig_tenant: '',
	linked_inspection: '',
	revision_of: ''
};

test('unsigned drafts are eligible for deletion', () => {
	assert.equal(canDeleteInspection(baseDraft), true);
	assert.equal(archiveRequiredReason(baseDraft), null);
});

test('signed or completed records are never ordinary deletions', () => {
	assert.equal(canDeleteInspection({ ...baseDraft, sig_landlord: 'sig.png' }), false);
	assert.equal(canDeleteInspection({ ...baseDraft, stage: 'completed' }), false);
	assert.match(archiveRequiredReason({ ...baseDraft, sig_landlord: 'sig.png' }), /archive/i);
	assert.match(archiveRequiredReason({ ...baseDraft, stage: 'completed' }), /archive/i);
});

test('history-linked records must be archived instead of deleted', () => {
	assert.equal(canDeleteInspection({ ...baseDraft, linked_inspection: 'insp-2' }), false);
	assert.equal(canDeleteInspection({ ...baseDraft, revision_of: 'insp-1' }), false);
	assert.match(archiveRequiredReason({ ...baseDraft, linked_inspection: 'insp-2' }), /history/i);
});
