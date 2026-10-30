import type { Inspection } from './types';

export function canDeleteInspection(
  inspection: Pick<
    Inspection,
    'archived' | 'stage' | 'sig_landlord' | 'sig_tenant' | 'linked_inspection' | 'revision_of'
  >
): boolean {
  if (inspection.archived) return false;
  if (inspection.stage !== 'draft') return false;
  if (inspection.sig_landlord || inspection.sig_tenant) return false;
  if (inspection.linked_inspection || inspection.revision_of) return false;
  return true;
}

export function archiveRequiredReason(
  inspection: Pick<
    Inspection,
    'archived' | 'stage' | 'sig_landlord' | 'sig_tenant' | 'linked_inspection' | 'revision_of'
  >
): string | null {
  if (inspection.archived) return 'This inspection is already archived.';
  if (inspection.sig_landlord || inspection.sig_tenant) {
    return 'Signed inspections are preserved in history; archive instead of deleting them.';
  }
  if (inspection.stage !== 'draft') {
    return 'Only unsigned drafts can be deleted. Archive this record to preserve its history.';
  }
  if (inspection.linked_inspection || inspection.revision_of) {
    return 'This inspection is tied to inspection history; archive instead of deleting it.';
  }
  return null;
}
