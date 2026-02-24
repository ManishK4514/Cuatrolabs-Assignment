const pool = require('../db/pool');
const Razorpay = require('razorpay');

const PARTIAL_REFUND_PERCENT = 75;
const LATE_CANCEL_HOURS = 24;

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

async function cancelBooking(bookingId, reason) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [booking] } = await client.query(
      `SELECT b.id, b.partner_id, b.slot_id, b.status, ps.slot_start
       FROM bookings b
       JOIN partner_slots ps ON ps.id = b.slot_id
       WHERE b.id = $1
       FOR UPDATE`,
      [bookingId]
    );

    if (!booking) {
      await client.query('ROLLBACK');
      return { error: 'booking not found', status: 404 };
    }
    if (booking.status === 'cancelled') {
      await client.query('ROLLBACK');
      return { error: 'booking is already cancelled', status: 400 };
    }

    const payment = await client.query(
      `SELECT id, amount_paise FROM payments
       WHERE booking_id = $1 AND status = 'captured'
       ORDER BY captured_at DESC LIMIT 1`,
      [bookingId]
    );
    const capturedPayment = payment.rows[0];

    let refundType = 'none';
    let refundAmount = 0;

    if (!booking.partner_id) {
      refundType = 'full';
      refundAmount = capturedPayment?.amount_paise || 0;
    } else {
      const hoursUntilSlot = (new Date(booking.slot_start) - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilSlot > LATE_CANCEL_HOURS) {
        refundType = 'partial';
        refundAmount = Math.floor((capturedPayment?.amount_paise || 0) * PARTIAL_REFUND_PERCENT / 100);
      }
    }

    await client.query(
      `UPDATE bookings SET status = 'cancelled' WHERE id = $1`,
      [bookingId]
    );

    if (booking.slot_id) {
      await client.query(
        `UPDATE partner_slots SET status = 'available' WHERE id = $1`,
        [booking.slot_id]
      );
    }

    const refund = await client.query(
      `INSERT INTO refunds (booking_id, payment_id, amount_paise, refund_type, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [bookingId, capturedPayment?.id || null, refundAmount, refundType, reason, 'pending']
    );

    await client.query('COMMIT');

    // fire gateway call outside the transaction to avoid holding db locks during http
    if (refundAmount > 0 && capturedPayment) {
      setImmediate(async () => {
        try {
          const gatewayRefund = await razorpay.payments.refund(capturedPayment.amount_paise, {
            amount: refundAmount,
            notes: { booking_id: bookingId, reason },
          });
          await pool.query(
            `UPDATE refunds SET status = 'processed', provider_refund_id = $2 WHERE id = $1`,
            [refund.rows[0].id, gatewayRefund.id]
          );
        } catch (err) {
          console.error('refund gateway call failed', err);
          await pool.query(
            `UPDATE refunds SET status = 'failed' WHERE id = $1`,
            [refund.rows[0].id]
          );
        }
      });
    }

    return { refund: refund.rows[0], status: 200 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { cancelBooking };
