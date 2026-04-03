"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { logout } from "@/lib/auth/supabase-auth";

const items = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/tenant-settings", label: "Organización" },
    { href: "/campaigns", label: "Campañas" },
    { href: "/inbox", label: "Inbox" },
    { href: "/leads", label: "Leads" },
    { href: "/leads/desk", label: "Human Desk" },
    { href: "/leads/manager", label: "Manager View" },
    { href: "/leads/wow/", label: "Leads QA" },
    { href: "/reports", label: "Reportes" },
];

export function AppSidebar({ userEmail }: { userEmail?: string | null }) {
    const pathname = usePathname();

    return (
        <aside className="w-64 border-r bg-card flex min-h-screen flex-col">
            <div className="p-4 font-semibold">Orquesta IA Crm</div>
            <TenantSwitcher />
            <nav className="px-2 space-y-1 flex-1">
                {items.map((it) => {
                    const active = pathname === it.href;
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
