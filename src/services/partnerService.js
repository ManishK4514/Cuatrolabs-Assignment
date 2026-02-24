const pool = require('../db/pool');

async function assignBestPartner(city, slotStart = null) {
  const params = [city];
  let slotFilter = 'ps.slot_start > now()';
  if (slotStart) {
    slotFilter = 'ps.slot_start = $2';
    params.push(slotStart);
  }

  const { rows } = await pool.query(
    `SELECT p.id AS partner_id, p.name, COALESCE(w.active_workload, 0)::int AS active_workload
     FROM partners p
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS active_workload
       FROM bookings b
       WHERE b.partner_id = p.id AND b.status IN ('pending', 'confirmed')
     ) w ON true
     WHERE p.city = $1 AND p.is_active = true
       AND EXISTS (
         SELECT 1 FROM partner_slots ps
         WHERE ps.partner_id = p.id AND ps.status = 'available' AND ${slotFilter}
       )
     ORDER BY active_workload ASC, p.created_at ASC, p.name ASC
     LIMIT 1`,
    params
  );

  return rows[0] || null;
}

module.exports = { assignBestPartner };
