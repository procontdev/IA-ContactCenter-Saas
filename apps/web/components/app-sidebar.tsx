"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTenantPlan } from "@/lib/packaging/use-tenant-plan";
import type { PlanFeatureKey } from "@/lib/packaging/plan-catalog";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { logout } from "@/lib/auth/supabase-auth";

const items = [
    { href: "/demo", label: "Demo Launcher" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/tenant-settings", label: "Organización" },
    { href: "/campaigns", label: "Campañas" },
    { href: "/inbox", label: "Inbox" },
    { href: "/leads/workspace", label: "Omnichannel Workspace", feature: "omnichannel_workspace" as PlanFeatureKey },
    { href: "/leads", label: "Leads" },
    { href: "/leads/desk", label: "Human Desk" },
    { href: "/leads/manager", label: "Manager View", feature: "manager_view" as PlanFeatureKey },
    { href: "/leads/commercial", label: "Commercial Insights", feature: "executive_dashboard" as PlanFeatureKey },
    { href: "/leads/executive", label: "Executive Demo Dashboard", feature: "executive_dashboard" as PlanFeatureKey },
    { href: "/leads/wow", label: "WOW Queue" },
    { href: "/reports", label: "Reportes" },
];

function normalizePath(path: string) {
    return String(path || "").replace(/\/+$/, "") || "/";
}

export function AppSidebar({ userEmail }: { userEmail?: string | null }) {
    const pathname = usePathname();
    const currentPath = normalizePath(pathname || "/");
    const { plan } = useTenantPlan();

    function isEnabled(feature?: PlanFeatureKey) {
        if (!feature) return true;
        return Boolean(plan?.features?.[feature]);
    }

    return (
        <aside className="w-64 border-r bg-card flex min-h-screen flex-col">
            <div className="p-4 font-semibold">EventProLabs · IA Contact Center</div>
            <TenantSwitcher />
            <div className="px-4 pb-2 text-[11px] text-muted-foreground">
                Plan: <span className="font-medium text-foreground">{plan?.plan_name || "..."}</span>
            </div>
            <nav className="px-2 space-y-1 flex-1">
                {items.map((it) => {
                    const itemPath = normalizePath(it.href);
                    const active = currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
                    const enabled = isEnabled(it.feature);

                    if (!enabled) {
                        return (
                            <div
                                key={it.href}
                                className="block rounded-md px-3 py-2 text-sm text-muted-foreground opacity-70"
                                title="Disponible en plan superior"
                            >
                                {it.label} <span className="text-[10px]">🔒</span>
                            </div>
                        );
                    }

                    return (
                        <Link
                            key={it.href}
                            href={it.href}
                            className={[
                                "block rounded-md px-3 py-2 text-sm",
                                active ? "bg-muted font-medium" : "hover:bg-muted/60",
                            ].join(" ")}
                        >
                            {it.label}
                        </Link>
                    );
                })}
            </nav>

            <div className="border-t p-3 space-y-2">
                <div className="text-[11px] text-muted-foreground truncate" title={userEmail || undefined}>
                    {userEmail || "Usuario autenticado"}
                </div>
                <button
                    className="w-full rounded-md border px-3 py-2 text-sm hover:bg-muted"
                    onClick={() => {
                        void logout();
                    }}
                >
                    Cerrar sesión
                </button>
            </div>
        </aside>
    );
}
