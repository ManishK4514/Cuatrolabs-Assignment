const express = require('express');
const router = express.Router();
const { verifySignature, handlePaymentWebhook } = require('../services/webhookService');

router.post('/payment', async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature || !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const { event_id, event: eventType, payload } = req.body;
    const result = await handlePaymentWebhook(event_id, eventType, payload);

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
