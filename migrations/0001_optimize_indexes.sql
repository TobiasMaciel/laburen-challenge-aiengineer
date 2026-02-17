-- Optimización de Búsqueda de Carritos (CRÍTICO para el inicio)
-- Ayuda a: "SELECT id FROM carts WHERE user_phone = ? AND status = 'active'"
CREATE INDEX IF NOT EXISTS idx_carts_phone_status ON carts(user_phone, status);

-- Optimización de Items del Carrito
-- Ayuda a: "SELECT ... FROM cart_items WHERE cart_id = ?" (Para calcular total y listar)
CREATE INDEX IF NOT EXISTS idx_cart_items_cart_product ON cart_items(cart_id, product_id);

-- Optimización de Productos
-- Ayuda a filtros por categoría y ordenamiento
-- NOTA: Para búsquedas con 'LIKE %texto%' el índice normal ayuda poco, pero agiliza el resto.
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
