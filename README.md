# IA-ContactCenter-Saas

Base de evolución del MVP `IA-ContactCenter-Multichannel-MVP` hacia un producto SaaS multitenant de Contact Center + CRM + IA.

## Estructura
- `apps/web`: aplicación principal heredada del MVP
- `packages/*`: módulos compartidos de dominio, aplicación, infraestructura y utilitarios
- `supabase/*`: migraciones, políticas, views y RPC
- `docs/*`: arquitectura, épicas y runbooks

## Estado actual
- Base inicial copiada desde el MVP
- Próxima épica: `P0-01 Multitenancy foundation`

## Scripts
```bash
pnpm install
pnpm dev