# Cuatro Labs Marketplace Backend

Slot-based booking service connecting customers with service partners. Handles partner assignment, concurrent slot booking, payment webhooks (Razorpay), and cancellations with tiered refunds.

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- Redis >= 6
- A Razorpay account with webhook secret

## Setup

Clone the repo and install dependencies:

```
npm install
```

Create a `.env` file in the project root:

```
DATABASE_URL=postgresql://user:password@localhost:5432/cuatro_labs
PG_POOL_MAX=20
PORT=3000
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=xxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxx
```

Run the schema against your database:

```
psql -d cuatro_labs -f schema.sql
```

Start the server:

```
node src/app.js
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/bookings | Book a slot for a customer |
| POST | /api/bookings/:id/cancel | Cancel a booking and process refund |
| POST | /api/partners/assign | Find the best available partner in a city |
| POST | /webhooks/payment | Razorpay payment webhook receiver |

## Architecture Notes

- Slot booking uses `FOR UPDATE SKIP LOCKED` for concurrency safety
- Webhook processing is idempotent via `ON CONFLICT DO NOTHING` on event_id
- Refund gateway calls run outside the DB transaction (`setImmediate`) to avoid holding locks during HTTP
- See `docs/performance.md` for indexing, caching, and scaling considerations
