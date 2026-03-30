# Épica: P0-01 — Multitenancy Foundation

Este documento centraliza el estado de la épica P0-01 para el repositorio `IA-ContactCenter-Saas`.

## 1. Objetivo General

Implementar el aislamiento multitenant transversal sin romper las funcionalidades actuales del MVP legado en `demo_callcenter`.

## 2. Definiciones de Dominio (Fase Inicial)

*   **Identidad en BD:** `platform_core.tenants`
*   **Asociación Usuarios:** `platform_core.tenant_users`
*   **Aislamiento de Recursos:** Columna `tenant_id` añadida a las tablas reales del MVP.

## 3. Estado de la Implementación (P0-01)

| Hito | Estado |
| :--- | :--- |
| Creación de Esquemas (`0001`) | **LISTO** |
| Base Multitenant (`0002`) | **LISTO** |
| Inyección `tenant_id` Legado (`0003`) | **LISTO** |
| FKs e Índices (`0004`) | **LISTO** |
| Seed y Backfill (`0005`) | **LISTO** |
| Endurecimiento Constraints (`0006`) | **LISTO** |
| Capa Aplicación (Helpers) | **LISTO** en `apps/web/lib/*` |

## 4. Criterios de Aceptación (Checklist)

* [x] Existe entidad `tenant` operativa.
* [x] Existe `tenant_users` operativa.
* [x] Existe `tenant_settings` persistible.
* [x] Entidades P0 del MVP tienen `tenant_id`.
* [x] Filtrado de `tenant_id` disponible en helpers para lectura y escritura.
* [x] Legado operativo (Vistas y Consultas siguen funcionando).
* [x] Estrategia de `superadmin` contemplada.

## 5. Deuda Técnica Remanente

*   **Migración Física:** Mover físicamente las tablas fuera de `demo_callcenter` hacia sus esquemas correspondientes.
*   **RLS Extenso:** Aplicar políticas de Supabase RLS de manera agresiva.
*   **Middleware:** Falta integración con el middleware de Next.js para forzar el filtrado a nivel de fetch global.
*   **Vistas Restantes:** Algunas vistas de menor prioridad aún no exponen el `tenant_id`.

## 6. Fuera de Alcance para P0-01

*   Módulos de IA independientes por tenant.
*   Limites de cuota en frontend.
*   Gestión de pagos y suscripciones.
*   Dashboard de Superadmin.