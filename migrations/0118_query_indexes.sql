-- High-frequency query indexes for open-table orders, service-request polling, and tenant-scoped product media.

CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_open ON orders(tenant_id, billed_at, table_no, created_at);
CREATE INDEX IF NOT EXISTS idx_product_media_tenant_product ON product_media(tenant_id, product_id, sort_order);
