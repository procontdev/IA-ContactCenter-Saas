import { useEffect, useState } from 'react';
import { TenantContext } from './tenant-types';
import { resolveTenantContext } from './tenant-resolver';

const TENANT_CONTEXT_EVENT = 'tenant-context-changed';

/**
 * Hook para obtener el contexto del tenant en componentes del lado del cliente.
 */
export function useTenant() {
  const [context, setContext] = useState<TenantContext | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshContext() {
    try {
      const ctx = await resolveTenantContext();
      setContext(ctx);
    } catch (e) {
      console.error('Error loading tenant context:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshContext();

    const onTenantChanged = () => {
      void refreshContext();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(TENANT_CONTEXT_EVENT, onTenantChanged);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(TENANT_CONTEXT_EVENT, onTenantChanged);
      }
    };
  }, []);

  return { context, loading, refreshContext };
}
