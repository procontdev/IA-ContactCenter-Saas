# IA Contact Center Multichannel MVP

Repositorio privado que conserva el estado actual del MVP funcional de la plataforma de **Contact Center + CRM + IA**.

Este repositorio sirve como:

- snapshot técnico del MVP actual,
- base de referencia antes del refactor a arquitectura SaaS multitenant,
- respaldo del código y de la estructura de datos del sistema en su estado actual.

## Propósito

Preservar una versión estable del MVP antes de evolucionarlo hacia una arquitectura modular compuesta por:

- **Core Platform**
- **SaaS Control Plane**
- **Contact Center Domain**
- **CRM Domain**
- **AI Domain**

## Alcance actual del MVP

- gestión de campañas
- leads
- conversaciones
- handoff humano
- dashboards operativos básicos
- integraciones base del MVP
- flujos con IA
- estructura de base de datos del esquema principal

## Base de datos

La base de datos actual usa PostgreSQL / Supabase.

El esquema principal respaldado en este repositorio es:

- `demo_callcenter`

### Archivos incluidos

- `database/schema/demo_callcenter_schema.sql`  
  Estructura del esquema `demo_callcenter`

- `database/backup/demo_callcenter_full.dump.gz`  
  Dump completo del esquema `demo_callcenter`  
  **Uso interno solamente**

## Restauración

### Restaurar solo estructura

```bash
psql -h HOST -p 5432 -U USER -d DATABASE -f database/schema/demo_callcenter_schema.sql