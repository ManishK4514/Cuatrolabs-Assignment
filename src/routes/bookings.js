const express = require('express');
const router = express.Router();
const { bookSlot } = require('../services/bookingService');

router.post('/', async (req, res, next) => {
  try {
    const { partner_id, slot_id, customer_id } = req.body;
    if (!partner_id || !slot_id || !customer_id) {
      return res.status(400).json({ error: 'partner_id, slot_id, and customer_id are required' });
    }

    const result = await bookSlot(partner_id, slot_id, customer_id);
    if (result.error) return res.status(result.status).json({ error: result.error });

    res.status(201).json(result.booking);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
