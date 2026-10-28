const AUDIT_ACTION_LABELS: Record<string, string> = {
  admin_created: 'Administrators created',
  admin_user_deleted: 'Admin user deleted',
  company_rejected: 'Companies rejected',
  company_verified: 'Companies verified',
  internship_closed: 'Internships closed',
  posting_approved: 'Postings approved',
  posting_removed: 'Postings removed',
  posting_rejected: 'Postings rejected',
  report_resolved: 'Reports resolved',
  report_status_updated: 'Report status updated',
  skill_learning_resource_created: 'Learning resources created',
  skill_learning_resource_deleted: 'Learning resources deleted',
  skill_learning_resource_updated: 'Learning resources updated',
  skill_question_created: 'Assessment questions created',
  skill_question_deleted: 'Assessment questions deleted',
  skill_question_updated: 'Assessment questions updated',
  skill_questions_imported: 'Assessment questions imported',
  user_reinstated: 'Users unblocked',
  user_suspended: 'Users blocked',
  gdpr_data_export: 'GDPR data export',
  gdpr_right_to_erasure_executed: 'GDPR right to erasure executed',
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
