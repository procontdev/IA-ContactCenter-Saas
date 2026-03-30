# Arquitectura Multitenant (SaaS)

Este documento describe la estrategia de aislamiento por tenant implementada en la plataforma SaaS.

## 1. Estrategia de Aislamiento: Shared Schema / Row-Level

Actualmente la plataforma utiliza un esquema compartido para el alojamiento de datos, con una columna `tenant_id` en todas las tablas operativas.

- **Ventajas:** Facilidad de mantenimiento, migraciones centralizadas y unificación de esquemas de agregación.
- **Mecanismos de Control:**
  1. **Filtrado en Aplicación:** `injectTenantFilter` en la capa de helpers de DB.
  2. **Aislamiento en DB (Futuro):** Supabase RLS (Row-Level Security) se activará en fases posteriores (P1+).

## 2. Definición del Tenant (SaaS Control)

Un tenant representa una organización independiente.

- **Propiedades Core:**
  - `id`: UUID único.
  - `slug`: Nombre único en la URL (ej: `empresa-abc`).
  - `settings`: Configuración personalizada técnica y visual.

## 3. Matriz de Roles Funcionales

Los roles se gestionan por tenant en la tabla `platform_core.tenant_users`.

- **Superadmin:** Acceso bypass a todos los tenants. Gestión de infraestructura.
- **Tenant Admin:** Propietario de la organización. Gestión de usuarios internos y configuración.
- **Supervisor:** Seguimiento de analíticas y control de colas de llamadas.
- **Agent:** Operador de llamadas y gestión básica de leads.

## 4. Evolución de Esquemas por Dominio

La plataforma se estructura en esquemas semánticos:

- `platform_core`: Identidad y salud de la plataforma.
- `saas_control`: Planes, límites y facturación.
- `crm`, `contact_center`, `ai`, `analytics`, `audit`: Dominios operativos (actualmente en transición desde `demo_callcenter`).

## 5. Prevención de Fugas de Datos (Data Leakage)

1. **Resolver:** Los servicios deben resolver el `tenant_id` desde el contexto de la sesión AUTH.
2. **Guard:** El `tenant-guard` en la capa de aplicación asegura que ninguna respuesta contenga datos de un `tenant_id` extraño.
3. **Audit:** Las operaciones críticas se registran incluyendo siempre el ID del tenant solicitante.
