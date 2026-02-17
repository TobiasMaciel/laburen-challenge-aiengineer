
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
    let query = 'SELECT id, name, price, category FROM products'; // ULTRA-MINIMALISTA
    let params: any[] = [];

    if (search) {
        // Usamos LIKE simple. Para Full Text Search real se necesitaría D1 FTS (más complejo)
        query += ' WHERE name LIKE ? OR category LIKE ?';
        const term = `%${search}%`;
        params = [term, term];
    }

    query += ' LIMIT 3'; // Solo 3 resultados para que el LLM responda volando

    try {
        const { results } = await c.env.DB.prepare(query).bind(...params).all<Product>();
        return c.json({ products: results });
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * POST /cart
 * Crea un nuevo carrito o recupera uno existente activo (Idempotencia).
 * Body: { "user_phone": "..." }
 */
app.post('/cart', async (c) => {
    // Definir tipo esperado del body
    const body = await c.req.json<{ user_phone?: string }>().catch(() => ({ user_phone: undefined }));

    let phone = body.user_phone ? String(body.user_phone) : null;

    // Limpieza de teléfono (Micro-optimización: Regex es más seguro para quitar todo lo que no sea numérico si se quisiera, pero manteniendo split por ahora para compatibilidad)
    if (phone && phone.includes('.')) {
        phone = phone.split('.')[0];
    }

    try {
        // 1. INTENTO DE RECUPERACIÓN (Solo si hay teléfono)
        // El índice (user_phone, status) hace esto instantáneo.
        if (phone) {
            const existingCart = await c.env.DB.prepare(
                "SELECT id FROM carts WHERE user_phone = ? AND status = 'active' LIMIT 1"
            ).bind(phone).first<{ id: string }>();

            if (existingCart) {
                return c.json({
                    cart_id: existingCart.id,
                    message: 'Carrito activo recuperado',
                    instructions: 'Usa este ID, no crees otro.'
                }, 200);
            }
        }

        // 2. CREACIÓN DE NUEVO CARRITO
        const cartId = crypto.randomUUID();

        // La inserción es rápida.
        await c.env.DB.prepare(
            'INSERT INTO carts (id, user_phone, status) VALUES (?, ?, ?)'
        ).bind(cartId, phone, 'active').run();

        return c.json({
            cart_id: cartId,
            message: 'Carrito nuevo creado exitosamente',
            instructions: 'Usa este ID para futuras operaciones.'
        }, 201);

    } catch (e: any) {
        return c.json({ error: 'Error creando carrito: ' + e.message }, 500);
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
    const body = await c.req.json<CartItem & { cart_id: string }>();

    if (!body.cart_id || !body.product_id) {
        return c.json({ error: 'Faltan datos (cart_id o product_id)' }, 400);
    }

    const { cart_id, product_id } = body;
    const qty = body.quantity || 1;

    try {
        // 1. Verificar producto (SOLO columnas necesarias)
        const product = await c.env.DB.prepare('SELECT id, name, price FROM products WHERE id = ?').bind(product_id).first<Product>();

        if (!product) {
            return c.json({ error: 'Producto no encontrado' }, 404);
        }

        // 2. UPSERT (Insertar o Actualizar en un solo paso) - Requiere Unique Index
        // Si ya existe (cart_id, product_id), sumamos la cantidad. Si no, insertamos.
        await c.env.DB.prepare(`
            INSERT INTO cart_items (cart_id, product_id, quantity) 
            VALUES (?, ?, ?)
            ON CONFLICT(cart_id, product_id) 
            DO UPDATE SET quantity = quantity + ?
        `).bind(cart_id, product_id, qty, qty).run();

        // --- OPTIMIZACIÓN DE RESPUESTA EXTREMA ---
        // Eliminamos el recálculo de totales (SELECT SUM...) que puede causar delay.
        // Respondemos rápido para que el Bot no haga timeout.
        return c.json({
            message: 'Producto Agregado',
            product_name: product.name
            // Si el bot necesita el total, que llame a get_cart
        });

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
    const cartId = c.req.query('cart_id');
    const productId = c.req.query('product_id');

    if (!cartId || !productId) {
        return c.json({ error: 'Faltan datos (cart_id o product_id en query params)' }, 400);
    }

    try {
        const res = await c.env.DB.prepare(
            'DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?'
        ).bind(cartId, productId).run();

        if (res.meta.changes > 0) {
            return c.json({ message: 'Producto eliminado del carrito' });
        } else {
            return c.json({ error: 'Producto no estaba en el carrito' }, 404);
        }

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
                description: "Busca productos en el catálogo por nombre o categoría",
                parameters: {
                    type: "object",
                    properties: {
                        search: { type: "string", description: "Término de búsqueda (ej: 'zapatillas')" }
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
                description: "Crea un nuevo carrito de compras para el usuario",
                parameters: {}
            },
            {
                name: "add_to_cart",
                description: "Agrega un producto al carrito especificado",
                parameters: {
                    type: "object",
                    properties: {
                        cart_id: { type: "string", description: "ID del carrito" },
                        product_id: { type: "integer", description: "ID del producto a agregar" },
                        quantity: { type: "integer", description: "Cantidad (default 1)" }
                    },
                    required: ["cart_id", "product_id"]
                }
            },
            {
                name: "get_cart",
                description: "Obtiene los productos y total del carrito",
                parameters: {
                    type: "object",
                    properties: {
                        cart_id: { type: "string", description: "ID del carrito a consultar" }
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