const express = require('express');
const router = express.Router();
const { assignBestPartner } = require('../services/partnerService');

router.post('/assign', async (req, res, next) => {
  try {
    const { city, slot_start } = req.body;
    if (!city) return res.status(400).json({ error: 'city is required' });

    const partner = await assignBestPartner(city, slot_start || null);
    if (!partner) return res.status(404).json({ error: 'no available partner found' });

    res.json(partner);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
