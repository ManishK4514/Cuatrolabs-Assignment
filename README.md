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

## Testing

Seed some data to work with:

```sql
INSERT INTO partners (name, city) VALUES ('Manish Kumar', 'mumbai');
INSERT INTO partner_slots (partner_id, slot_start, slot_end)
VALUES (1, now() + interval '1 day', now() + interval '1 day 1 hour');
```

Find the best partner in a city:

```bash
curl -X POST http://localhost:3000/api/partners/assign \
  -H "Content-Type: application/json" \
  -d '{"city": "mumbai"}'
```

Book a slot (use the partner and slot ids from above):

```bash
curl -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"partner_id": 1, "slot_id": 1, "customer_id": 100}'
```

Try booking the same slot again — should get a 409:

```bash
curl -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"partner_id": 1, "slot_id": 1, "customer_id": 200}'
```

Simulate a Razorpay payment webhook (the signature needs to match `RAZORPAY_WEBHOOK_SECRET` in your `.env`):

```bash
PAYLOAD='{"event_id":"evt_001","event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_123","amount":50000,"notes":{"booking_id":"1"}}}}}'

SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "test_secret" | awk '{print $2}')

curl -X POST http://localhost:3000/webhooks/payment \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: $SIG" \
  -d "$PAYLOAD"
```

Sending the same webhook again returns 200 with `{"duplicate": true}` — idempotency working as expected.

Cancel a booking (replace `1` with your booking id):

```bash
curl -X POST http://localhost:3000/api/bookings/1/cancel \
  -H "Content-Type: application/json" \
  -d '{"reason": "changed plans"}'
```

Refund tiers depend on timing — no partner assigned gets a full refund, more than 24h before the slot gets 75%, and anything within 24h gets nothing.

## Architecture Notes

- Slot booking uses `FOR UPDATE SKIP LOCKED` for concurrency safety
- Webhook processing is idempotent via `ON CONFLICT DO NOTHING` on event_id
- Refund gateway calls run outside the DB transaction (`setImmediate`) to avoid holding locks during HTTP
- See `docs/performance.md` for indexing, caching, and scaling considerations
