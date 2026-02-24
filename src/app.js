const express = require('express');
const bookingsRouter = require('./routes/bookings');
const partnersRouter = require('./routes/partners');
const webhooksRouter = require('./routes/webhooks');

const app = express();
app.use(express.json());

app.use('/api/bookings', bookingsRouter);
app.use('/api/partners', partnersRouter);
app.use('/webhooks', webhooksRouter);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`listening on ${PORT}`));

module.exports = app;
