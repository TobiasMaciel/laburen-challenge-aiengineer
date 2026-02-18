-- Migration number: 0002 	 2026-02-17T23:00:00.000Z
ALTER TABLE carts ADD COLUMN status TEXT DEFAULT 'active';
