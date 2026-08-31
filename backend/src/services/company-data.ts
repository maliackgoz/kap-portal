import db from '../db.js';
import { invalidateCache } from './graph-builder.js';

const upsertCompanyField = db.prepare(`
  INSERT INTO shareholders (company_id, item_key, value, fetched_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(company_id, item_key) DO UPDATE SET
    value = excluded.value,
    fetched_at = excluded.fetched_at
`);

const replaceFields = db.transaction((companyId: number, items: Array<[string, string]>) => {
  db.prepare('DELETE FROM shareholders WHERE company_id = ?').run(companyId);
  for (const [key, value] of items) {
    upsertCompanyField.run(companyId, key, value);
  }
});

export function replaceCompanyData(companyId: number, data: Record<string, unknown>) {
  const items = Object.entries(data).map(
    ([key, value]): [string, string] => [key, JSON.stringify(value)],
  );

  replaceFields(companyId, items);
  invalidateCache();

  return {
    keysWritten: items.length,
    keys: items.map(([key]) => key),
    graphInvalidated: true,
  };
}
