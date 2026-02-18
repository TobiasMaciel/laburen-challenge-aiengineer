
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { D1Database } from '@cloudflare/workers-types';

type Env = {
    DB: D1Database;
    BASE_URL?: string; // Para documentacion
};

// -- TYPES --
interface Product {
    id: number;
    name: string;
    description: string;
    price: number;
    stock: number;
    category: string;
}

interface CartItem {
    product_id: number;
    quantity: number;
}

// Inicializamos la aplicación Hono
const app = new Hono<{ Bindings: Env }>();

// -- MIDDLEWARES --
// 1. Logger para ver peticiones en consola y debuggear
app.use('*', logger());
// 2. JSON formateado si se pide desde navegador
app.use('*', prettyJSON());
// 3. CORS: Permite que cualquier frontend llame a esta API
app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
}));

// -- RUTAS --

/**
 * GET /
 * Health check y documentación básica
 */
app.get('/', (c) => {
    return c.json({
        messsage: 'Laburen AI Agent API is running 🚀',
        endpoints: [
            'GET /products?search={term}&id={id}',
            'POST /cart',
            'GET /cart/:id',
            'POST /cart/items',
            'DELETE /cart/items'
        ]
    });
});

/**
 * GET /products
 * Endpoint maestro para obtener productos.
 * - Sin params: Devuelve los primeros 10.
 * - ?search=... : Busca por texto (nombre, desc, cat).
 * - ?id=... : Devuelve un producto específico por ID (detalle).
 */
app.get('/products', async (c) => {
    const search = c.req.query('search') || '';
    const id = c.req.query('id');

    // 1. Caso búsqueda por ID específico (Optimizado)
    if (id) {
        try {
            // SOLO columnas necesarias (evita Select *)
            const product = await c.env.DB.prepare('SELECT id, name, price, description, size, color, stock, category FROM products WHERE id = ?').bind(id).first<Product>();
            if (!product) {
                return c.json({ error: 'Producto no encontrado' }, 404);
            }
            return c.json(product);
        } catch (e: any) {
            return c.json({ error: e.message }, 500);
        }
    }

    // 2. Caso búsqueda general
    let query = 'SELECT id, name, price FROM products'; // ULTRA-MINIMALISTA (Sin categoría)
    let params: any[] = [];

    if (search) {
        query += ' WHERE name LIKE ? OR category LIKE ?';
        const term = `%${search}%`;
        params = [term, term];
    }

    query += ' LIMIT 3'; // Solo 3 resultados

    try {
        const { results } = await c.env.DB.prepare(query).bind(...params).all<Product>();
        return c.json({ products: results });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * POST /cart
 * Crea o recupera carrito.
 */
app.post('/cart', async (c) => {
    const body = await c.req.json<{ user_phone?: string }>();
    const user_phone = body.user_phone;

    // 1. Buscar carrito ACTIVO existente para este usuario
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

    // 2. Crear nuevo carrito
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
 * Cierra el carrito (status='closed') y devuelve resumen final.
 * Query Param: ?cart_id=...
 */
app.post('/cart/close', async (c) => {
    let cart_id = c.req.query('cart_id');

    // Fallback: intentar leer del body si no vino en query
    if (!cart_id) {
        try {
            const body = await c.req.json<{ cart_id: string }>();
            cart_id = body.cart_id;
        } catch (e) {
            // Body vacío o inválido, ignorar
        }
    }

    if (!cart_id) return c.json({ error: 'Falta cart_id (query param o body)' }, 400);

    try {
        // 1. Obtener items para el resumen final
        const items = await c.env.DB.prepare(`
            SELECT p.name, ci.quantity, p.price, (ci.quantity * p.price) as subtotal
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            WHERE ci.cart_id = ?
        `).bind(cart_id).all<any>();

        const total = items.results.reduce((sum, item) => sum + item.subtotal, 0);

        // 2. Cerrar el carrito
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
 * Obtiene el contenido actual del carrito con subtotales.
 * Query Param: ?id=...
 */
app.get('/cart', async (c) => {
    const cartId = c.req.query('id');

    if (!cartId) {
        return c.json({ error: 'Falta cart ID (?id=...)' }, 400);
    }

    const query = `
        SELECT 
            p.id as product_id,
            p.name, 
            p.price, 
            ci.quantity, 
            (p.price * ci.quantity) as subtotal
        FROM cart_items ci
        JOIN products p ON ci.product_id = p.id
        WHERE ci.cart_id = ?
    `;

    try {
        const { results } = await c.env.DB.prepare(query).bind(cartId).all();

        // Calculamos total general en código para facilitar al LLM
        const total = results.reduce((acc: number, item: any) => acc + (item.subtotal || 0), 0);

        return c.json({
            cart_id: cartId,
            items: results,
            total: total,
            currency: 'USD'
        });
    } catch (e: any) {
        return c.json({ error: 'Error obteniendo carrito: ' + e.message }, 500);
    }
});

/**
 * POST /cart/items
 * Agrega un producto o actualiza su cantidad (Upsert lógico).
 * Body: { "cart_id": "...", "product_id": 1, "quantity": 1 }
 */
app.post('/cart/items', async (c) => {
    const body = await c.req.json<CartItem & { cart_id: any, expected_name?: string }>();
    console.log('[POST /cart/items] Body recibido:', body); // Debug

    // Casteo para robustez
    const cart_id = String(body.cart_id);
    const product_id = Number(body.product_id);
    const qty = Number(body.quantity || 1);
    const expected_name = body.expected_name ? String(body.expected_name).toLowerCase() : null;

    if (!cart_id || !product_id || isNaN(product_id)) {
        console.error('[POST /cart/items] Faltan datos:', { cart_id, product_id });
        return c.json({ error: 'Faltan datos o tipos incorrectos' }, 400);
    }

    try {
        const product = await c.env.DB.prepare('SELECT name, price FROM products WHERE id = ?').bind(product_id).first<Product>();

        if (!product) {
            console.error('[POST /cart/items] Producto no encontrado ID:', product_id);
            return c.json({ error: '404 Product' }, 404);
        }

        // VALIDACIÓN DE SEGURIDAD (SEMÁNTICA)
        if (expected_name) {
            const dbName = product.name.toLowerCase();
            const keywords = expected_name.split(' ').filter(w => w.length > 3);
            const match = keywords.some(k => dbName.includes(k)) || dbName.includes(expected_name);

            if (!match && keywords.length > 0) {
                console.error(`[Security] ID Mismatch. ID ${product_id} es '${product.name}', se esperaba '${expected_name}'`);
                return c.json({
                    error: `ERROR DE ID: El ID ${product_id} corresponde a '${product.name}', NO a '${expected_name}'. Por favor busca el ID correcto.`
                }, 409);
            }
        }

        const updateResult = await c.env.DB.prepare(
            'UPDATE cart_items SET quantity = quantity + ? WHERE cart_id = ? AND product_id = ?'
        ).bind(qty, cart_id, product_id).run();

        if (updateResult.meta.changes === 0) {
            await c.env.DB.prepare(
                'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)'
            ).bind(cart_id, product_id, qty).run();
        }

        // Resumen rápido
        const summary = await c.env.DB.prepare(`
            SELECT SUM(quantity * price) as total FROM cart_items JOIN products ON product_id = products.id WHERE cart_id = ?
        `).bind(cart_id).first<{ total: number }>();

        return c.json({
            status: 'ok',
            cart_id,
            product_id,
            added: product.name,
            total: summary?.total || 0
        });

    } catch (e: any) {
        console.error('[POST /cart/items] Excepción:', e);
        return c.json({ error: e.message }, 500);
    }
});

/**
 * PATCH /cart/items
 * Actualiza la cantidad exacta de un item (Set Quantity).
 * Si cantidad = 0, elimina el item.
 */
app.patch('/cart/items', async (c) => {
    const body = await c.req.json<{ cart_id: any, product_id: any, quantity: any, expected_name?: string }>();

    // Casteo forzado para evitar errores de tipos (ej: "3" vs 3)
    const cart_id = String(body.cart_id);
    const product_id = Number(body.product_id);
    const quantity = Number(body.quantity);
    const expected_name = body.expected_name ? String(body.expected_name).toLowerCase() : null;

    // Validación básica
    if (!cart_id || !product_id || isNaN(quantity)) {
        return c.json({ error: 'Faltan datos o tipos incorrectos' }, 400);
    }

    try {
        // 1. Verificar si el producto REALMENTE existe (Evita FK Constraint Error = 500)
        const product = await c.env.DB.prepare('SELECT id, name FROM products WHERE id = ?').bind(product_id).first<Product>();
        if (!product) {
            return c.json({ error: 'Producto no encontrado' }, 404);
        }

        // VALIDACIÓN DE SEGURIDAD (SEMÁNTICA)
        if (expected_name) {
            const dbName = product.name.toLowerCase();
            const keywords = expected_name.split(' ').filter(w => w.length > 3);
            const match = keywords.some(k => dbName.includes(k)) || dbName.includes(expected_name);

            if (!match && keywords.length > 0) {
                return c.json({
                    error: `ERROR DE ID: El ID ${product_id} es '${product.name}', NO corresponde a '${expected_name}'. Por favor busca el ID correcto.`
                }, 409);
            }
        }

        if (quantity <= 0) {
            // Eliminar item
            await c.env.DB.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?').bind(cart_id, product_id).run();
            // Retornamos IDs para mantener contexto
            return c.json({ status: 'ok', cart_id, product_id, deleted: true });
        } else {
            // Actualizar cantidad exacta
            const res = await c.env.DB.prepare('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?').bind(quantity, cart_id, product_id).run();

            if (res.meta.changes === 0) {
                // Si no existía en el carrito, lo creamos (INSERT seguro porque ya validamos el producto)
                await c.env.DB.prepare('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)').bind(cart_id, product_id, quantity).run();
            }

            return c.json({ status: 'ok', cart_id, product_id, quantity: quantity });
        }
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * DELETE /cart/items
 * Elimina un producto del carrito.
 * Query Params: ?cart_id=...&product_id=...
 */
app.delete('/cart/items', async (c) => {
    const cart_id = c.req.query('cart_id');
    const product_id = c.req.query('product_id');

    if (!cart_id || !product_id) {
        return c.json({ error: 'Faltan parámetros cart_id o product_id' }, 400);
    }

    try {
        await c.env.DB.prepare('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?')
            .bind(cart_id, product_id).run();

        return c.json({ message: 'Producto eliminado', status: 'ok' });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * GET /manifest
 * Devuelve la especificación de herramientas para que el LLM sepa qué puede hacer.
 */
app.get('/manifest', (c) => {
    return c.json({
        tools: [
            {
                name: "search_products",
                description: "Busca productos por nombre o categoría (ej: 'pantalones', 'camisa azul'). Retorna lista con ID, nombre y precio.",
                parameters: {
                    type: "object",
                    properties: {
                        search: { type: "string", description: "Término de búsqueda" }
                    }
                }
            },
            {
                name: "get_product_details",
                description: "Obtiene información detallada de un producto específico",
                parameters: {
                    type: "object",
                    properties: {
                        id: { type: "integer", description: "ID del producto a consultar" }
                    },
                    required: ["id"]
                }
            },
            {
                name: "create_cart",
                description: "Crea un nuevo carrito de compras o recupera uno existente si se da el teléfono.",
                parameters: {
                    type: "object",
                    properties: {
                        user_phone: { type: "string", description: "Teléfono del usuario (opcional)" }
                    }
                }
            },
            {
                name: "close_cart",
                description: "Cierra el carrito actual, finaliza la compra y devuelve el resumen. Usar cuando el usuario confirma.",
                parameters: {
                    type: "object",
                    properties: {
                        cart_id: { type: "string", description: "ID del carrito a cerrar" }
                    },
                    required: ["cart_id"]
                }
            },
            {
                name: "add_to_cart",
                description: "Agrega un producto nuevo al carrito. Requiere cart_id, product_id y quantity.",
                parameters: {
                    type: "object",
                    properties: {
                        cart_id: { type: "string", description: "ID del carrito" },
                        product_id: { type: "integer", description: "ID del producto a agregar" },
                        quantity: { type: "integer", description: "Cantidad (default 1)" },
                        expected_name: { type: "string", description: "Nombre esperado del producto (ej: 'Chaqueta'). ÚSALO SIEMPRE para evitar errores de ID." }
                    },
                    required: ["cart_id", "product_id"]
                }
            },
            {
                name: "update_cart_item",
                description: "Fija la cantidad exacta de un producto en el carrito. Si pones 0, lo elimina.",
                parameters: {
                    type: "object",
                    properties: {
                        cart_id: { type: "string", description: "ID del carrito" },
                        product_id: { type: "integer", description: "ID del producto" },
                        quantity: { type: "integer", description: "Nueva cantidad exacta (ej: 3)" },
                        expected_name: { type: "string", description: "Nombre esperado del producto (para validar ID)." }
                    },
                    required: ["cart_id", "product_id", "quantity"]
                }
            },
            {
                name: "get_cart",
                description: "Obtiene el contenido actual del carrito y el total.",
                parameters: {
                    type: "object",
                    properties: {
                        cart_id: { type: "string", description: "ID del carrito" }
                    },
                    required: ["cart_id"]
                }
            },
            {
                name: "remove_from_cart",
                description: "Elimina un producto del carrito",
                parameters: {
                    type: "object",
                    properties: {
                        cart_id: { type: "string", description: "ID del carrito" },
                        product_id: { type: "integer", description: "ID del producto a eliminar" }
                    },
                    required: ["cart_id", "product_id"]
                }
            }
        ]
    });
});

export default app;