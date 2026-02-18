# Prueba tecnica Laburen - IA engineer

![Tech](https://img.shields.io/badge/stack-Cloudflare_Workers_%7C_Hono_%7C_D1-orange)

> **Desafío Técnico AI Engineer** - Implementación de un Agente de Ventas Transaccional integrando **LLMs**, **CRM (Chatwoot)** y **WhatsApp**.

## 📱 Interactuar con el Agente
¡Escanea el código para hablar con nuestro asistente de ventas!

<a href="https://api.whatsapp.com/send?phone=5491178277213&text=Buenas%20%F0%9F%91%8B%2C%20estoy%20buscando%20ropa.">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://api.whatsapp.com/send?phone=5491178277213%26text=Buenas%20%F0%9F%91%8B%2C%20estoy%20buscando%20ropa." alt="QR Code WhatsApp" />
</a>

[**➡️ Chatear con el Agente**](https://api.whatsapp.com/send?phone=5491178277213&text=Buenas%20%F0%9F%91%8B%2C%20estoy%20buscando%20ropa.)

Este repositorio aloja el **Model Context Protocol (MCP)** Backend desarrollado sobre **Cloudflare Workers**. Proporciona las herramientas (*tools*) necesarias para que el Agente de IA gestione inventario, carritos de compra y lógica de negocio.

---

## Características Técnicas

*   **Arquitectura Serverless:** Desplegado en Cloudflare Workers para latencia mínima global.
*   **Persistencia en el Edge:** Base de datos **D1 (SQLite)** distribuida para gestión de stock y sesiones.
*   **Optimización de Contexto:** Paginación de productos e inyección optimizada de prompts para reducir el uso de tokens.
*   **Idempotencia:** Endpoints diseñados para ser reintentables sin duplicar transacciones.

---

## Arquitectura

El sistema actúa como el nexo lógico entre la capa de conversación y los datos.

`Usuario (WhatsApp)` ↔ `Chatwoot (CRM)` ↔ `Laburen Agent (Cerebro)` ↔ `Cloudflare Worker (MCP)` ↔ `D1 (DB)`

Para ver el diagrama de flujo detallado y la especificación de la API, consulte [**Diseño y Arquitectura**](./docs/conceptual_document.md).

---

## Stack Tecnológico

| Componente    | Tecnología                |
| ------------- | ------------------------- |
| **Runtime**   | Cloudflare Workers        |
| **Framework** | [Hono](https://hono.dev/) |
| **Database**  | Cloudflare D1             |
| **Language**  | TypeScript                |

---

## Integración con Laburen Dashboard

Para conectar este MCP con el Agente en Laburen, configure las siguientes **Tools (Herramientas)** utilizando la URL base obtenida:

| Tool Name         | Method | Endpoint      | Parámetros Clave                         | Descripción                                 |
| ----------------- | ------ | ------------- | ---------------------------------------- | ------------------------------------------- |
| `search_products` | GET    | `/products`   | `search`, `page`                         | Busca en el catálogo.                       |
| `create_cart`     | POST   | `/cart`       | `user_phone`                             | Inicia/Recupera sesión.                     |
| `add_to_cart`     | POST   | `/cart/items` | `cart_id`, `product_id`, `expected_name` | Agrega items (con validación de seguridad). |
| `close_cart`      | POST   | `/cart/close` | `cart_id`                                | Finaliza compra.                            |

> Consulte [`docs/conceptual_document.md`](./docs/conceptual_document.md) para la especificación JSON completa de cada tool.

---

## Testing y QA

La calidad del agente se valida mediante escenarios de prueba de "Caja Negra".

*   **Test Suite:** [`tests/test_cases.md`](./tests/test_cases.md)
*   Incluye pruebas para:
    *   **Guardrails:** Intentos de jailbreak y temas prohibidos.
    *   **Protocolo:** Validación de saludo obligatorio.
    *   **Flujo Crítico:** Ciclo completo de compra (Crear -> Agregar -> Cerrar).


---

## CI/CD Pipeline

Este proyecto cuenta con un workflow automatizado en GitHub Actions que asegura la robustez del código antes de cada despliegue.

1.  **Validación de Tipos (Type Safety):** Ejecuta `tsc --noEmit` para garantizar que no existan errores de compilación o tipos en `index.ts`.
2.  **Despliegue Automático:** Si la validación es exitosa, utiliza `wrangler-action` para desplegar la nueva versión a Cloudflare Workers.



---

## Estructura del Proyecto

```bash
/
├── src/
│   └── index.ts           # Punto de entrada y definición de rutas
├── migrations/            # SQL Schema versionado (D1)
├── docs/                  # Documentación Técnica y Diagramas
├── agent_config/          # Prompts e Instrucciones del Sistema (System Prompt)
├── tests/                 # Escenarios de QA
├── wrangler.toml          # Configuración de Infraestructura (IaC)
└── package.json           # Dependencias y Scripts
```


---



---

**Author:** Tobías Maciel