/** Quoting alone does not prevent spreadsheet formula execution. */
export function csvCell(value: string): string {
  // Control characters must be inspected because spreadsheet importers can strip them before evaluation.
  // eslint-disable-next-line no-control-regex
  const escaped = /^[\s\u0000-\u001f]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${escaped.replace(/"/g, '""')}"`;
}
