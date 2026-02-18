import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
    DB: D1Database;
};

// Interfaces
type Product = {
    id: number;
    name: string;
    price: number;
    category: string;
    description: string;
    stock: number;
    image?: string;
};

type CartItem = {
    product_id: number;
    quantity: number;
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware: CORS total
app.use('/*', cors());

/**
 * Health Check
 * Verifica que la API esté online.
 */
app.get('/', (c) => c.text('Laburen API Online 🟢'));

/**
 * GET /products
 * Búsqueda de productos con paginación y filtros.
 * Params: ?search=term & ?page=1 & ?limit=3
 * Params: ?id=123 (Detalle de producto único)
 */
app.get('/products', async (c) => {
    const search = c.req.query('search') || '';
    const id = c.req.query('id');

    // Caso 1: Detalle por ID
    if (id) {
        try {
            const product = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Product>();
            if (!product) return c.json({ error: 'Producto no encontrado' }, 404);
            return c.json(product);
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    }

    // Caso 2: Búsqueda general con Paginación
    let query = 'SELECT * FROM products';
    let params: any[] = [];

    const page = Number(c.req.query('page') || 1);
    const limit = Number(c.req.query('limit') || 4);
    const offset = (page - 1) * limit;

    if (search) {
        query += ' WHERE name LIKE ? OR category LIKE ?';
        params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY id ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    try {
        const { results } = await c.env.DB.prepare(query).bind(...params).all<Product>();
        return c.json({
            products: results,
            page,
            limit,
            has_more: results.length === limit
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * POST /cart
 * Crea un nuevo carrito o recupera el activo si existe.
 */
app.post('/cart', async (c) => {
    const body = await c.req.json<{ user_phone?: string }>().catch(() => ({ user_phone: undefined }));
    const user_phone = body.user_phone;

    // Buscar carrito activo existente
    if (user_phone) {
        const existingCart = await c.env.DB.prepare(
            "SELECT id FROM carts WHERE user_phone = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1"
        ).bind(user_phone).first<{ id: string }>();

        if (existingCart) {
            return c.json({
                cart_id: existingCart.id,
                message: 'Carrito activo recuperado',
                status: 'active'
            });
        }
    }

    // Crear nuevo carrito
    const newCartId = crypto.randomUUID();
    try {
        await c.env.DB.prepare(
            "INSERT INTO carts (id, user_phone, status) VALUES (?, ?, 'active')"
        ).bind(newCartId, user_phone || null).run();

        return c.json({
            cart_id: newCartId,
            message: 'Nuevo carrito creado',
            status: 'active'
        }, 201);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * POST /cart/close
 * Cierra la compra, marca status='closed' y devuelve resumen final.
 * Query: ?cart_id=... (Prioridad) o Body { cart_id }
 */
app.post('/cart/close', async (c) => {
    let cart_id: string | undefined;
    let user_phone: string | undefined;

    try {
        const body = await c.req.json<{ cart_id?: string, user_phone?: string }>();
        cart_id = body.cart_id || c.req.query('cart_id');
        user_phone = body.user_phone;
    } catch (e) {
        cart_id = c.req.query('cart_id');
    }

    // Fallback: Buscar carrito activo por teléfono si falta ID
    if (!cart_id && user_phone) {
        const activeCart = await c.env.DB.prepare(
            "SELECT id FROM carts WHERE user_phone = ? AND status = 'active' LIMIT 1"
        ).bind(user_phone).first<{ id: string }>();

        if (activeCart) cart_id = activeCart.id;
    }

    if (!cart_id) return c.json({ error: 'Falta cart_id o user_phone para identificar el carrito.' }, 400);

    try {
        const items = await c.env.DB.prepare(`
            SELECT p.name, ci.quantity, p.price, (ci.quantity * p.price) as subtotal
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            WHERE ci.cart_id = ?
        `).bind(cart_id).all<any>();

        const total = items.results.reduce((sum, item) => sum + item.subtotal, 0);

        await c.env.DB.prepare("UPDATE carts SET status = 'closed' WHERE id = ?").bind(cart_id).run();

        return c.json({
            status: 'closed',
            message: 'Compra finalizada',
            items: items.results,
            total: total
        });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * GET /cart
 * Obtiene el contenido actual del carrito.
 * Params: ?id=UUID
 */
app.get('/cart', async (c) => {
    const cartId = c.req.query('id');
    if (!cartId) return c.json({ error: 'Falta cart ID (?id=...)' }, 400);

    const query = `
        SELECT p.id as product_id, p.name, ci.quantity, p.price, (ci.quantity * p.price) as subtotal
        FROM cart_items ci
        JOIN products p ON ci.product_id = p.id
        WHERE ci.cart_id = ?
    `;

    try {
        const { results } = await c.env.DB.prepare(query).bind(cartId).all();
        const total = results.reduce((sum: number, item: any) => sum + item.subtotal, 0);
        return c.json({ cart_id: cartId, items: results, total });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * POST /cart/items
 * Agrega item al carrito. Valida nombres para evitar errores de ID.
 */
app.post('/cart/items', async (c) => {
    const body = await c.req.json<{ cart_id: any, product_id: any, quantity?: any, expected_name?: string }>();
    const cart_id = String(body.cart_id);
    const product_id = Number(body.product_id);
    const qty = Number(body.quantity || 1);
    const expected_name = body.expected_name ? String(body.expected_name).toLowerCase() : null;

    if (!cart_id || !product_id || isNaN(product_id)) return c.json({ error: 'Datos inválidos' }, 400);

    try {
        const product = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(product_id).first<Product>();
        if (!product) return c.json({ error: 'Producto no encontrado' }, 404);

        // Seguridad: Validación de nombre
        if (expected_name) {
            const dbName = product.name.toLowerCase();
            const keywords = expected_name.split(' ').filter(w => w.length > 3);
            const match = keywords.some(k => dbName.includes(k)) || dbName.includes(expected_name);

            if (!match && keywords.length > 0) {
                return c.json({ error: `ERROR DE SEGURIDAD: ID ${product_id} es '${product.name}', no '${expected_name}'.` }, 409);
            }
        }

        // Upsert (Update or Insert)
        const update = await c.env.DB.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE cart_id = ? AND product_id = ?').bind(qty, cart_id, product_id).run();
        if (update.meta.changes === 0) {
            await c.env.DB.prepare('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)').bind(cart_id, product_id, qty).run();
        }

        const summary = await c.env.DB.prepare('SELECT SUM(quantity * price) as total FROM cart_items JOIN products ON product_id = products.id WHERE cart_id = ?').bind(cart_id).first<{ total: number }>();

        return c.json({ status: 'ok', added: product.name, total: summary?.total || 0 });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * PATCH /cart/items
 * Actualiza cantidad exacta.
 */
app.patch('/cart/items', async (c) => {
    const body = await c.req.json<{ cart_id: any, product_id: any, quantity: any, expected_name?: string }>();
    const cart_id = String(body.cart_id);
    const product_id = Number(body.product_id);
    const quantity = Number(body.quantity);
    const expected_name = body.expected_name ? String(body.expected_name).toLowerCase() : null;

    if (!cart_id || !product_id || isNaN(quantity)) return c.json({ error: 'Datos inválidos' }, 400);

    try {
        const product = await c.env.DB.prepare('SELECT id, name FROM products WHERE id = ?').bind(product_id).first<Product>();
        if (!product) return c.json({ error: 'Producto no encontrado' }, 404);

        // Seguridad
        if (expected_name) {
            const dbName = product.name.toLowerCase();
            const keywords = expected_name.split(' ').filter(w => w.length > 3);
            const match = keywords.some(k => dbName.includes(k)) || dbName.includes(expected_name);
            if (!match && keywords.length > 0) {
                return c.json({ error: `ERROR DE SEGURIDAD: ID ${product_id} es '${product.name}', no '${expected_name}'.` }, 409);
            }
        }

        if (quantity <= 0) {
            await c.env.DB.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').bind(cart_id, product_id).run();
            return c.json({ status: 'ok', deleted: true });
        } else {
            const res = await c.env.DB.prepare('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?').bind(quantity, cart_id, product_id).run();
            if (res.meta.changes === 0) {
                await c.env.DB.prepare('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)').bind(cart_id, product_id, quantity).run();
            }
            return c.json({ status: 'ok', quantity });
        }
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * DELETE /cart/items
 * Elimina un producto.
 * Query Params: ?cart_id=... & ?product_id=...
 */
app.delete('/cart/items', async (c) => {
    const cartId = c.req.query('cart_id');
    const productId = c.req.query('product_id');

    if (!cartId || !productId) return c.json({ error: 'Faltan parámetros' }, 400);

    try {
        await c.env.DB.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').bind(cartId, productId).run();
        return c.json({ status: 'ok', message: 'Producto eliminado' });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

export default app;