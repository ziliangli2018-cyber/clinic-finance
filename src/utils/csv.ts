/** Quoting alone does not prevent spreadsheet formula execution. */
export function csvCell(value: string): string {
  // Control characters must be inspected because spreadsheet importers can strip them before evaluation.
  const firstVisible = [...value].find(
    (character) => character.trim() && character.charCodeAt(0) > 31,
  );
  const escaped =
    (firstVisible && ['=', '+', '@', '-'].includes(firstVisible)) || /^[\t\r\n]/.test(value)
      ? `'${value}`
      : value;
  return `"${escaped.replace(/"/g, '""')}"`;
}
