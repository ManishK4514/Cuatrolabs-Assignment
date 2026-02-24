const pool = require('../db/pool');

async function bookSlot(partnerId, slotId, customerId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lock = await client.query(
      `SELECT id, partner_id, status FROM partner_slots
       WHERE id = $1 FOR UPDATE SKIP LOCKED`,
      [slotId]
    );

    if (lock.rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: 'slot is being booked by another request', status: 409 };
    }

    const slot = lock.rows[0];
    if (slot.partner_id !== partnerId) {
      await client.query('ROLLBACK');
      return { error: 'slot does not belong to this partner', status: 400 };
    }
    if (slot.status !== 'available') {
      await client.query('ROLLBACK');
      return { error: 'slot is not available', status: 409 };
    }

    await client.query(
      `UPDATE partner_slots SET status = 'booked' WHERE id = $1`,
      [slotId]
    );

    const booking = await client.query(
      `INSERT INTO bookings (partner_id, slot_id, customer_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [partnerId, slotId, customerId]
    );

    await client.query('COMMIT');
    return { booking: booking.rows[0], status: 201 };
  } catch (err) {
    await client.query('ROLLBACK');
    // unique violation on slot_id means another txn already booked it
    if (err.code === '23505') {
      return { error: 'slot already booked', status: 409 };
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { bookSlot };
