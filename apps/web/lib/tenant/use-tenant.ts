import { useEffect, useState } from 'react';
import { TenantContext } from './tenant-types';
import { resolveTenantContext } from './tenant-resolver';

/**
 * Hook para obtener el contexto del tenant en componentes del lado del cliente.
 */
export function useTenant() {
  const [context, setContext] = useState<TenantContext | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // En esta fase, pasamos null para que use el default
        // Más adelante, pasaremos la sesión real de Supabase
        const ctx = await resolveTenantContext();
        setContext(ctx);
      } catch (e) {
        console.error('Error loading tenant context:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { context, loading };
}
