"use client";

import { useEffect, useState } from "react";
import { readAccessTokenFromLocalStorage } from "@/lib/tenant/tenant-resolver";
import type { TenantPlanSnapshot } from "@/lib/packaging/tenant-plan";

const TENANT_CONTEXT_EVENT = "tenant-context-changed";

type TenantPlanResponse = {
    item?: TenantPlanSnapshot;
    error?: string;
};

function getAuthHeaders() {
    const token = readAccessTokenFromLocalStorage();
    if (!token) throw new Error("No access token in localStorage");
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}

export function useTenantPlan() {
    const [plan, setPlan] = useState<TenantPlanSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>("");

    async function refreshPlan() {
        setLoading(true);
        setError("");

        try {
            const res = await fetch("/api/tenant/plan/", {
                method: "GET",
                headers: getAuthHeaders(),
                cache: "no-store",
            });
            const data = (await res.json().catch(() => ({}))) as TenantPlanResponse;
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            setPlan(data.item || null);
        } catch (e: unknown) {
            setPlan(null);
            setError(e instanceof Error ? e.message : "Error loading tenant plan");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void refreshPlan();

        const onTenantChanged = () => {
            void refreshPlan();
        };

        window.addEventListener(TENANT_CONTEXT_EVENT, onTenantChanged);
        return () => {
            window.removeEventListener(TENANT_CONTEXT_EVENT, onTenantChanged);
        };
    }, []);

    return { plan, loading, error, refreshPlan };
}

