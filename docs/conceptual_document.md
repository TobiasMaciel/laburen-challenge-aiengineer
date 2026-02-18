# Diseño Conceptual del Agente de IA - Laburen Challenge

## 1. Arquitectura del Sistema
El sistema opera mediante una orquestación de 4 capas específicas:
1.  **Interfaz:** WhatsApp (Chip Tuenti Prepago: `+54 9 11 7827-7213`).
2.  **CRM:** Chatwoot (gestiona la sesión, historial y derivación humana).
3.  **Cerebro:** Laburen Dashboard (Modelo **GPT-5-Chat** orquestando tools).
4.  **Backend (MCP):** Cloudflare Worker + D1 Database (Lógica de negocio y persistencia).

### Diagrama de Arquitectura

```mermaid
graph LR
    User([Usuario WhatsApp]) <-->|Interacción| CW[Chatwoot CRM]
    CW <-->|Eventos| LAB[Laburen AI Agent]
    LAB <-->|Function Calling| MCP[Backend Cloudflare Worker]
    MCP <-->|SQL| DB[(D1 Database)]
    
    classDef node fill:#fff,stroke:#333,stroke-width:2px;
    class User,CW,LAB,MCP,DB node;
```

## 2. Flujo de Interacción (Diagrama de Secuencia)
Este diagrama ilustra el viaje del usuario desde la exploración hasta el cierre de la compra.

```mermaid
sequenceDiagram
    participant U as Usuario (WhatsApp)
    participant CW as Chatwoot (CRM)
    participant A as Agente IA (Laburen GPT-5)
    participant MCP as Backend (Cloudflare)
    participant DB as Base de Datos (D1)

    %% 1. EXPLORACIÓN
    Note over U, DB: Fase 1: Exploración
    U->>CW: "Hola, ¿tenés pantalones?"
    CW->>A: Webhook (Mensaje entrante)
    A->>A: Detecta saludo + intención
    A->>MCP: GET /products?search=pantalones&page=1
    MCP->>DB: SELECT * FROM products...
    DB-->>MCP: Lista de resultados
    MCP-->>A: JSON [Pantalón A, Pantalón B...]
    A-->>CW: Texto de respuesta
    CW-->>U: "¡Hola! 👋 Sí, mirá estas opciones: ..."

    %% 2. CREACIÓN DE CARRITO
    Note over U, DB: Fase 2: Creación de Carrito
    U->>CW: "Quiero 2 del primero (Ref: 1)"
    CW->>A: Webhook
    A->>MCP: POST /cart (user_phone=...)
    MCP->>DB: INSERT/SELECT id FROM carts WHERE active
    DB-->>MCP: cart_id: "uuid-123"
    MCP-->>A: { cart_id: "uuid-123", status: "active" }
    
    A->>MCP: POST /cart/items
    Note right of A: Body: { cart_id, product_id: 1, qty: 2, expected_name: "Pantalón" }
    MCP->>DB: UPSERT cart_items
    DB-->>MCP: OK
    MCP-->>A: { status: "ok", total: $2000 }
    A-->>CW: Respuesta confirmación
    CW-->>U: "Listo ✅, agregué 2 pantalones. Total: $2000."

    %% 3. EDICIÓN (EXTRA)
    Note over U, DB: Fase 3: Edición (Extra)
    U->>CW: "Mejor que sea solo 1"
    CW->>A: Webhook
    A->>MCP: PATCH /cart/items
    Note right of A: Body: { cart_id, product_id: 1, qty: 1 }
    MCP->>DB: UPDATE cart_items...
    MCP-->>A: { status: "ok", quantity: 1 }
    A-->>CW: Texto
    CW-->>U: "Corregido 👍. Ahora tenés 1 unidad."

    %% 4. CIERRE
    Note over U, DB: Fase 4: Cierre
    U->>CW: "Eso es todo, cerrame el pedido"
    CW->>A: Webhook
    A->>MCP: POST /cart/close
    MCP->>DB: UPDATE carts SET status='closed'
    MCP->>DB: SELECT items, total...
    DB-->>MCP: Resumen final
    MCP-->>A: { status: "closed", total: $1000, items: [...] }
    A-->>CW: Texto final
    CW-->>U: "¡Gracias por tu compra! 🎉 Aquí tu resumen: ..."

    %% 5. SOPORTE HUMANO
    Note over U, DB: Fase 5: Derivación a Humano (Soporte)
    U->>CW: "Quiero hablar con una persona"
    CW->>A: Webhook
    A-->>CW: "Un asesor humano te atenderá en breve..."
    Note right of CW: Chatwoot asigna etiqueta "humano" / notifica staff.
    CW-->>U: (Mensaje del Agente Humano cuando se conecte)
```

## 3. Especificación de Endpoints (MCP)
El **Model Context Protocol (MCP)** expone las siguientes capacidades al Agente:

### Exploración
*   **`GET /products`**
    *   **Params:** `search` (string), `page` (int), `limit` (int).
    *   **Función:** Busca productos por nombre/categoría. Soporta paginación para catálogos grandes.
    *   **Retorno:** Lista de productos con ID, nombre, precio, stock y descripción.

### Gestión del Carrito
*   **`POST /cart`**
    *   **Body:** `{ user_phone }`
    *   **Función:** (Idempotente) Crea un nuevo carrito o recupera el activo si el usuario ya tiene uno abierto.
    *   **Retorno:** `cart_id` (UUID).

*   **`GET /cart`**
    *   **Params:** `id` (UUID)
    *   **Función:** Lista el contenido actual del carrito y el subtotal.

*   **`POST /cart/close`**
    *   **Query/Body:** `cart_id`
    *   **Función:** Finaliza la compra, marca el carrito como cerrado y genera el ticket final.

### Gestión de Items
*   **`POST /cart/items`** (Agregar)
    *   **Body:** `{ cart_id, product_id, quantity, expected_name }`
    *   **Función:** Agrega items. Incluye validación de seguridad (`expected_name`) para evitar alucinaciones de IDs.

*   **`PATCH /cart/items`** (Editar)
    *   **Body:** `{ cart_id, product_id, quantity, expected_name }`
    *   **Función:** Ajusta cantidades exactas. También valida nombre por seguridad.

*   **`DELETE /cart/items`** (Eliminar)
    *   **Query:** `cart_id`, `product_id`
    *   **Función:** Elimina un producto específico del carrito.
