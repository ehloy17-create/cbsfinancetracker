import pool from '../db.js';

function convertDatetime(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return value.replace('T', ' ').replace(/\.\d{3}Z?$/, '');
  }
  return value;
}

export function normalizeSupplierCode(value, id) {
  const code = String(value ?? '').trim().toUpperCase();
  if (code) return code;
  const token = String(id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();
  return `SUP-${token || 'LEGACY'}`;
}

export async function syncSupplierToInventoryMirror(row, executor = pool) {
  const supplierId = String(row?.id ?? '').trim();
  if (!supplierId) return;

  const normalizedRow = {
    id: supplierId,
    code: normalizeSupplierCode(row.code, supplierId),
    name: String(row.name ?? '').trim(),
    contact_person: String(row.contact_person ?? row.contact ?? '').trim(),
    phone: String(row.phone ?? '').trim(),
    email: String(row.email ?? '').trim(),
    address: String(row.address ?? '').trim(),
    city: String(row.city ?? '').trim(),
    payment_terms: String(row.terms ?? row.payment_terms ?? '').trim(),
    notes: String(row.notes ?? '').trim(),
    is_active: Number(row.is_active ?? 1) ? 1 : 0,
    created_by: row.created_by ?? null,
    created_at: convertDatetime(row.created_at) ?? null,
    updated_at: convertDatetime(row.updated_at) ?? null,
  };

  await executor.query(
    `INSERT INTO \`inv_suppliers\`
      (\`id\`, \`code\`, \`name\`, \`contact_person\`, \`phone\`, \`email\`, \`address\`, \`city\`, \`payment_terms\`, \`notes\`, \`is_active\`, \`created_by\`, \`created_at\`, \`updated_at\`)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
     ON DUPLICATE KEY UPDATE
      \`code\` = VALUES(\`code\`),
      \`name\` = VALUES(\`name\`),
      \`contact_person\` = VALUES(\`contact_person\`),
      \`phone\` = VALUES(\`phone\`),
      \`email\` = VALUES(\`email\`),
      \`address\` = VALUES(\`address\`),
      \`city\` = VALUES(\`city\`),
      \`payment_terms\` = VALUES(\`payment_terms\`),
      \`notes\` = VALUES(\`notes\`),
      \`is_active\` = VALUES(\`is_active\`),
      \`updated_at\` = VALUES(\`updated_at\`)`,
    [
      normalizedRow.id,
      normalizedRow.code,
      normalizedRow.name,
      normalizedRow.contact_person,
      normalizedRow.phone,
      normalizedRow.email,
      normalizedRow.address,
      normalizedRow.city,
      normalizedRow.payment_terms,
      normalizedRow.notes,
      normalizedRow.is_active,
      normalizedRow.created_by,
      normalizedRow.created_at,
      normalizedRow.updated_at,
    ]
  );
}

export async function syncSupplierTable(table, rows, mode = 'upsert', executor = pool) {
  if (table !== 'suppliers') return;
  if (!Array.isArray(rows) || rows.length === 0) return;

  if (mode === 'delete') {
    const ids = rows.map((row) => String(row?.id ?? '').trim()).filter(Boolean);
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    await executor.query(
      `UPDATE \`inv_suppliers\`
          SET \`is_active\` = 0,
              \`updated_at\` = CURRENT_TIMESTAMP
        WHERE \`id\` IN (${placeholders})`,
      ids
    );
    return;
  }

  for (const row of rows) {
    await syncSupplierToInventoryMirror(row, executor);
  }
}
