const AUDIT_ACTION_LABELS: Record<string, string> = {
  posting_approved: 'Postings approved',
  posting_rejected: 'Postings rejected',
  user_reinstated: 'Users reinstated',
  user_suspended: 'Users suspended',
  gdpr_data_export: 'GDPR data export',
  gdpr_right_to_erasure_executed: 'GDPR right to erasure executed',
  admin_user_deleted: 'Admin user deleted',
}

export function auditActionLabel(action: string): string {
  const normalized = action.trim().toLowerCase().replaceAll(' ', '_')
  const known = AUDIT_ACTION_LABELS[normalized]
  if (known) return known
  return normalized
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase())
    .replace(/\b(gdpr|ai|ml)\b/gi, (acronym) => acronym.toUpperCase())
}
