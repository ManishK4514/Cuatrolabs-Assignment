CREATE TABLE partners (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE partner_slots (
    id SERIAL PRIMARY KEY,
    partner_id INTEGER NOT NULL REFERENCES partners(id),
    slot_start TIMESTAMPTZ NOT NULL,
    slot_end TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'booked', 'blocked')),
    UNIQUE (partner_id, slot_start)
);

CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    partner_id INTEGER NOT NULL REFERENCES partners(id),
    slot_id INTEGER NOT NULL REFERENCES partner_slots(id),
    customer_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (slot_id)
);

CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    provider TEXT NOT NULL,
    provider_txn_id TEXT NOT NULL,
    amount_paise BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL,
    captured_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    UNIQUE (provider, provider_txn_id)
);

CREATE TABLE webhook_events (
    id SERIAL PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT false,
    processing_error TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE refunds (
    id SERIAL PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    payment_id INTEGER REFERENCES payments(id),
    amount_paise BIGINT NOT NULL,
    refund_type TEXT NOT NULL CHECK (refund_type IN ('full', 'partial', 'none')),
    reason TEXT,
    provider_refund_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- partial index: only available slots matter for assignment queries
CREATE INDEX idx_partner_slots_available
    ON partner_slots (partner_id, slot_start)
    WHERE status = 'available';

CREATE INDEX idx_partners_city_active
    ON partners (city, is_active)
    WHERE is_active = true;

CREATE INDEX idx_bookings_partner_active
    ON bookings (partner_id, status)
    WHERE status IN ('pending', 'confirmed');

CREATE INDEX idx_bookings_customer
    ON bookings (customer_id, status, created_at DESC);

CREATE UNIQUE INDEX idx_payments_provider_txn
    ON payments (provider, provider_txn_id);
