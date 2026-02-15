
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
            'GET /products?search={term}',
            'POST /cart',
            'GET /cart/:id',
            'POST /cart/items',
            'DELETE /cart/items'
        ]
    });
});

/**
 * GET /products
 * Busca productos por nombre, descripción o categoría.
 * Query Params: ?search=zapatilla
 */
app.get('/products', async (c) => {
    const search = c.req.query('search') || '';

    let query = 'SELECT * FROM products';
    let params: any[] = [];

    if (search) {
        query += ' WHERE name LIKE ? OR description LIKE ? OR category LIKE ?';
        const term = `%${search}%`;
        params = [term, term, term];
    }

    query += ' LIMIT 10'; // Límite para no sobrecargar al LLM

    try {
        const { results } = await c.env.DB.prepare(query).bind(...params).all<Product>();
        return c.json(results);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * POST /cart
 * Crea un nuevo carrito vacío.
 * Retorna: { cart_id: string }
 */
app.post('/cart', async (c) => {
    const cartId = crypto.randomUUID();
    try {
        await c.env.DB.prepare('INSERT INTO carts (id) VALUES (?)').bind(cartId).run();
        return c.json({
            cart_id: cartId,
            message: 'Carrito creado exitosamente',
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
app.post('/cart/items', async (c) => { // URL genérica
    const body = await c.req.json<CartItem & { cart_id: string }>();

    if (!body.cart_id || !body.product_id) {
        return c.json({ error: 'Faltan datos (cart_id o product_id)' }, 400);
    }

    const cartId = body.cart_id;
    const qty = body.quantity || 1;

    try {
        // 1. Verificar producto y stock
        const product = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(body.product_id).first<Product>();

        if (!product) {
            return c.json({ error: 'Producto no encontrado' }, 404);
        }

        // 2. Verificar si ya existe en el carrito
        const existingItem = await c.env.DB.prepare(
            'SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?'
        ).bind(cartId, body.product_id).first<{ quantity: number }>();

        if (existingItem) {
            // UPDATE: Sumar cantidad
            const newQty = existingItem.quantity + qty;
            await c.env.DB.prepare(
                'UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?'
            ).bind(newQty, cartId, body.product_id).run();
        } else {
            // INSERT: Nuevo item
            await c.env.DB.prepare(
                'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)'
            ).bind(cartId, body.product_id, qty).run();
        }

        return c.json({
            message: 'Producto agregado/actualizado',
            product: product.name,
            quantity_added: qty
        });

    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

/**
 * DELETE /cart/items
 * Elimina un producto del carrito.
 * Body: { "cart_id": "...", "product_id": ... }
 */
app.delete('/cart/items', async (c) => {
    const body = await c.req.json<{ cart_id: string, product_id: number }>();

    if (!body.cart_id || !body.product_id) {
        return c.json({ error: 'Faltan datos (cart_id o product_id)' }, 400);
    }

    try {
        const res = await c.env.DB.prepare(
            'DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?'
        ).bind(body.cart_id, body.product_id).run();

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