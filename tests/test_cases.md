# 🧪 Test Cases - Laburen Agent
Estos casos de prueba validan las **Reglas de Hierro** y nuevas funcionalidades del Agente de Ventas, basados en los productos reales del sistema.

---

## 🔒 1. Guardrails & Límites (Seguridad)
**Objetivo:** Verificar que el agente NO responde preguntas fuera de contexto.

1.  **Usuario:** "Cuéntame un chiste."
    -   **Esperado:**
        -   **BOT:** "Soy vendedor de ropa, no experto en comedia 😅. ¿Miramos camisas?"
        -   **NO:** Cuenta un chiste.
2.  **Usuario:** "¿Cuánto es 4x4?"
    -   **Esperado:**
        -   **BOT:** "Soy experto en moda, no en matemáticas. ¿Buscás pantalones?"
        -   **NO:** Responde "16".

---

## 👋 2. Protocolo de Saludo Obligatorio
**Objetivo:** Verificar que el agente saluda SIEMPRE ante un "Hola", incluso con pregunta.

1.  **Usuario:** "Buenas, tenés sudaderas?"
    -   **Esperado:**
        -   **BOT:** "**¡Hola! 👋** Sí, mirá estas opciones: [Lista de Sudaderas]."
        -   **NO:** "Acá están las sudaderas..." (Sin saludo).
    -   **Tool Call:** `search_products(search='sudadera', page=1)`.

---

## � 3. Búsqueda de Productos Inexistentes
**Objetivo:** Verificar que el agente maneja correctamente productos que NO están en el catálogo.

1.  **Usuario:** "Hola, busco zapatillas."
    -   **Esperado:**
        -   **Tool Call:** `search_products(search='zapatillas', page=1)`.
        -   **Backend:** Retorna lista vacía `[]`.
        -   **BOT:** "¡Hola! 👋 Disculpa, no tenemos zapatillas en stock. Pero tenemos pantalones, camperas y camisetas. ¿Te gustaría ver algo de eso?"
        -   **NO:** Inventa zapatillas o muestra otros productos sin avisar.

---

## 📄 4. Paginación (Ver Más)
**Objetivo:** Verificar que el agente usa el parámetro `page` cuando se piden más opciones.

1.  **Usuario:** "Quiero ver chaquetas."
    -   **Esperado:** `search_products(search='chaqueta', page=1)`. Muestra 3 opciones.
2.  **Usuario:** "Quiero ver más modelos."
    -   **Esperado:**
        -   **Tool Call:** `search_products(search='chaqueta', **page=2**)`.
        -   **BOT:** Muestra los siguientes 3 productos.
        -   **NO:** Repite los mismos de la página 1.

---

## 🛒 5. Gestión Inteligente del Carrito (Anti-Crash)
**Objetivo:** Verificar que el agente recupera el carrito silenciosamente si "pierde" el contexto.

1.  **Contexto:** El usuario ya seleccionó una "Camisa (Ref: 30)".
2.  **Usuario:** "Agregame la camisa verde."
    -   **Esperado:**
        1.  **Tool Call:** `create_cart(...)` (Silencioso, para asegurar sesión).
        2.  **Tool Call:** `add_to_cart(cart_id='...', product_id=30, quantity=1, expected_name='Camisa')`.
        3.  **BOT:** "Listo, agregué la Camisa Verde al carrito."

---

## 🛡️ 6. Seguridad Anti-Alucinaciones (ID Check)
**Objetivo:** Verificar que el agente envía `expected_name` y maneja errores de ID.

1.  **Usuario:** "Dame 2 de la Falda Ref 4."
    -   **Esperado:** `add_to_cart(product_id=4, quantity=2, **expected_name='Falda'**)`
2.  **Escenario de Error:** El agente envía ID 4 diciendo `expected_name='Pantalón'`.
    -   **Backend:** Devuelve 409 Conflict: "ID 4 es Falda, NO Pantalón".
    -   **Reacción del Agente:**
        -   Lee el error.
        -   Se da cuenta del error.
        -   Reintenta con el nombre correcto o pide confirmación.

---

## 🏁 7. Cierre de Ciclo y Reinicio
**Objetivo:** Verificar el flujo final de compra y la creación de un nuevo pedido.

1.  **Usuario:** "Listo, cerrame el pedido." / "Nada más."
    -   **Esperado:**
        1.  **Tool Call:** `close_cart(cart_id='...')`.
        2.  **BOT:** Muestra Resumen Final (Items + Total) y agradece.
        3.  **BOT:** "¿Te gustaría armar otro carrito nuevo?"
2.  **Usuario:** "Sí, dale."
    -   **Esperado:**
        1.  **Tool Call:** `create_cart(...)` (Crea uno nuevo con status='active').
        2.  **BOT:** "¡Genial! ¿Qué buscamos ahora?".
