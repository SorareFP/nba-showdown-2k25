/** A Record Breakers card earned by a feat, never dealt by a pack (docs/plans/2026-10-14-record-breakers-design.md). */
export const isFeatCard = card => card?.set === 'record-breakers' && !!card.earn && card.earn !== 'pack';
