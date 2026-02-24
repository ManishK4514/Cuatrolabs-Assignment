# Performance Considerations

## Indexing Strategy

The schema includes targeted indexes that support the application's primary query patterns without over-indexing columns that see mostly writes.

Partner availability lookups filter on `status = 'available'`, so a partial index avoids indexing the much larger set of booked and blocked slots entirely:

```sql
CREATE INDEX idx_partner_slots_available
    ON partner_slots (partner_id, slot_start)
    WHERE status = 'available';
```

Partner assignment queries filter by city and only consider active partners. A partial composite index makes this a single index scan:

```sql
CREATE INDEX idx_partners_city_active
    ON partners (city, is_active)
    WHERE is_active = true;
```

Workload counting during assignment hits bookings filtered to active statuses. Without an index here, every assignment query would seq-scan bookings:

```sql
CREATE INDEX idx_bookings_partner_active
    ON bookings (partner_id, status)
    WHERE status IN ('pending', 'confirmed');
```

Customer-facing booking history pages sort by recency and often filter by status:

```sql
CREATE INDEX idx_bookings_customer
    ON bookings (customer_id, status, created_at DESC);
```

Payment deduplication during webhook processing relies on a unique composite. This doubles as both a constraint and a fast lookup path:

```sql
CREATE UNIQUE INDEX idx_payments_provider_txn
    ON payments (provider, provider_txn_id);
```

## Redis Caching

Available partner lists per city are cached under keys shaped as `partners:available:{city}:{date}` with a 60-second TTL. This is short enough that stale data self-corrects quickly, but long enough to absorb bursts of identical queries during peak hours.

Cache invalidation fires on four events: booking confirmed, cancellation processed, partner status toggled, and slot blocked. Rather than using `redis.keys('partners:available:*')` to find keys to invalidate (which is O(n) over all keys in the store), each city maintains a Redis SET at `partners:cache-keys:{city}` that tracks the active cache keys for that city. Invalidation iterates only over the members of the relevant city's set, deletes each one, then clears the set itself.

```javascript
async function invalidateCityCache(redis, city) {
  const trackingKey = `partners:cache-keys:${city}`;
  const keys = await redis.smembers(trackingKey);
  if (keys.length > 0) {
    await redis.del(...keys, trackingKey);
  }
}
```

When writing a cache entry, the key is simultaneously added to the city's tracking set:

```javascript
async function cachePartners(redis, city, date, data) {
  const key = `partners:available:${city}:${date}`;
  const trackingKey = `partners:cache-keys:${city}`;
  await redis.set(key, JSON.stringify(data), 'EX', 60);
  await redis.sadd(trackingKey, key);
}
```

## Production Notes

Connection pool size should be tuned relative to the PostgreSQL instance's `max_connections` setting. A common starting point is `(max_connections - superuser_reserved) / number_of_app_instances`. The pool in `db/pool.js` defaults to 20 and is overridable via `PG_POOL_MAX`.

As booking volume grows, the workload COUNT in the partner assignment query will become a bottleneck. At that point, materializing the active booking count directly on the partners row (incremented on booking creation, decremented on cancellation or completion) eliminates the lateral join entirely and turns assignment into a simple indexed ORDER BY.

Availability queries that power the customer-facing UI are read-heavy and tolerate slight staleness. Routing these to a streaming read replica offloads the primary and lets the partner assignment and booking writes run without contention from dashboard traffic.

After any schema migration that adds or modifies indexes, running `EXPLAIN ANALYZE` against the core queries (partner assignment, slot locking, webhook dedup) confirms that the planner is actually using the new indexes rather than falling back to sequential scans.
