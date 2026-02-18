# 🤖 Laburen AI Sales Agent (MCP)

![Status](https://img.shields.io/badge/status-stable-green)
![Tech](https://img.shields.io/badge/stack-Cloudflare_Workers_%7C_Hono_%7C_D1-orange)
![License](https://img.shields.io/badge/license-MIT-blue)

> **Desafío Técnico AI Engineer** - Implementación de referencia para un Agente de Ventas Transaccional integrando **LLMs (GPT-5)**, **CRM (Chatwoot)** y **WhatsApp**.

Este repositorio aloja el **Model Context Protocol (MCP)** Backend desarrollado sobre **Cloudflare Workers**. Proporciona las herramientas (*tools*) necesarias para que el Agente de IA gestione inventario, carritos de compra y lógica de negocio con persistencia en el Edge.

---

## ⚡ Características Técnicas

*   **Arquitectura Serverless:** Desplegado en Cloudflare Workers para latencia mínima global.
*   **Persistencia en el Edge:** Base de datos **D1 (SQLite)** distribuida para gestión de stock y sesiones.
*   **Optimización de Contexto:** Paginación de productos e inyección optimizada de prompts para reducir el uso de tokens.
*   **Idempotencia:** Endpoints diseñados para ser reintentables sin duplicar transacciones.

---

## 🏗️ Arquitectura

El sistema actúa como el nexo lógico entre la capa de conversación y los datos.

`Usuario (WhatsApp)` ↔ `Chatwoot (CRM)` ↔ `Laburen Agent (Cerebro)` ↔ `Cloudflare Worker (MCP)` ↔ `D1 (DB)`

Para ver el diagrama de flujo detallado y la especificación de la API, consulte [**Diseño y Arquitectura**](./docs/conceptual_document.md).

---

## 🛠️ Stack Tecnológico

| Componente    | Tecnología                | Justificación                                                 |
| ------------- | ------------------------- | ------------------------------------------------------------- |
| **Runtime**   | Cloudflare Workers        | Ejecución V8 aislada, sin cold starts, coste cero en reposo.  |
| **Framework** | [Hono](https://hono.dev/) | Estándar moderno, tipado estricto, <15kb footprint.           |
| **Database**  | Cloudflare D1             | SQLite en el edge, consistencia fuerte y backups automáticos. |
| **Language**  | TypeScript                | Tipado estático para robustez en producción.                  |


---

## 🔌 Integración con Laburen Dashboard

Para conectar este MCP con el Agente en Laburen, configure las siguientes **Tools (Herramientas)** utilizando la URL base obtenida:

| Tool Name         | Method | Endpoint      | Parámetros Clave                         | Descripción                                 |
| ----------------- | ------ | ------------- | ---------------------------------------- | ------------------------------------------- |
| `search_products` | GET    | `/products`   | `search`, `page`                         | Busca en el catálogo.                       |
| `create_cart`     | POST   | `/cart`       | `user_phone`                             | Inicia/Recupera sesión.                     |
| `add_to_cart`     | POST   | `/cart/items` | `cart_id`, `product_id`, `expected_name` | Agrega items (con validación de seguridad). |
| `close_cart`      | POST   | `/cart/close` | `cart_id`                                | Finaliza compra.                            |

> Consulte [`docs/conceptual_document.md`](./docs/conceptual_document.md) para la especificación JSON completa de cada tool.

---

## ✅ Testing y QA

La calidad del agente se valida mediante escenarios de prueba de "Caja Negra".

*   **Test Suite:** [`tests/test_cases.md`](./tests/test_cases.md)
*   Incluye pruebas para:
    *   🛡️ **Guardrails:** Intentos de jailbreak y temas prohibidos.
    *   👋 **Protocolo:** Validación de saludo obligatorio.
    *   🛒 **Flujo Crítico:** Ciclo completo de compra (Crear -> Agregar -> Cerrar).


---

## 📂 Estructura del Proyecto

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

**Author:** Tobías Maciel  