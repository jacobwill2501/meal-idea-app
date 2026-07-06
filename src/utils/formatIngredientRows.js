export function formatIngredientRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return rows.map((row) => (row.qty > 1 ? `${row.name} x${row.qty}` : row.name)).join(', ');
}
