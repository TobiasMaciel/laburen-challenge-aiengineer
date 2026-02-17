-- Agregar Constraint Unique para habilitar UPSERT eficiente en items del carrito
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_unique ON cart_items(cart_id, product_id);
