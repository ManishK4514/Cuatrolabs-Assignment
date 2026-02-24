const crypto = require('crypto');
const pool = require('../db/pool');

function verifySignature(body, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function handlePaymentWebhook(eventId, eventType, payload) {
  const insert = await pool.query(
    `INSERT INTO webhook_events (event_id, provider, event_type, payload)
     VALUES ($1, 'razorpay', $2, $3)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [eventId, eventType, payload]
  );

  if (insert.rows.length === 0) {
    const existing = await pool.query(
      `SELECT processed, processing_error FROM webhook_events WHERE event_id = $1`,
      [eventId]
    );
    if (existing.rows[0]?.processed) return { duplicate: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entity = payload.payment?.entity || payload.entity || {};
    const bookingId = entity.notes?.booking_id;
    const txnId = entity.id;
    const amount = entity.amount;

    if (eventType === 'payment.captured') {
      await client.query(
        `INSERT INTO payments (booking_id, provider, provider_txn_id, amount_paise, status, captured_at, metadata)
         VALUES ($1, 'razorpay', $2, $3, 'captured', now(), $4)
         ON CONFLICT (provider, provider_txn_id) DO UPDATE SET status = 'captured', captured_at = now()`,
        [bookingId, txnId, amount, JSON.stringify(entity)]
      );
      await client.query(
        `UPDATE bookings SET status = 'confirmed' WHERE id = $1`,
        [bookingId]
      );
    } else if (eventType === 'payment.failed') {
      await client.query(
        `INSERT INTO payments (booking_id, provider, provider_txn_id, amount_paise, status, failed_at, metadata)
         VALUES ($1, 'razorpay', $2, $3, 'failed', now(), $4)
         ON CONFLICT (provider, provider_txn_id) DO UPDATE SET status = 'failed', failed_at = now()`,
        [bookingId, txnId, amount, JSON.stringify(entity)]
      );
      await client.query(
        `UPDATE partner_slots SET status = 'available'
         WHERE id = (SELECT slot_id FROM bookings WHERE id = $1)`,
        [bookingId]
      );
      await client.query(
        `UPDATE bookings SET status = 'cancelled' WHERE id = $1`,
        [bookingId]
      );
    }

    await client.query(
      `UPDATE webhook_events SET processed = true, processed_at = now(), processing_error = NULL
       WHERE event_id = $1`,
      [eventId]
    );

    await client.query('COMMIT');
    return { processed: true };
  } catch (err) {
    await client.query('ROLLBACK');
    await pool.query(
      `UPDATE webhook_events SET processing_error = $2 WHERE event_id = $1`,
      [eventId, err.message]
    );
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { verifySignature, handlePaymentWebhook };
