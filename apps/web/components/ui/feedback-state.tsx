import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "danger" | "warning" | "success";

const toneStyles: Record<Tone, string> = {
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
    danger: "border-red-200 bg-red-50 text-red-700",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

export function FeedbackState({
    title,
    description,
    tone = "neutral",
    icon,
    action,
    compact = false,
    className,
}: {
    title: string;
    description?: string;
    tone?: Tone;
    icon?: string;
    action?: ReactNode;
    compact?: boolean;
    className?: string;
}) {
    return (
        <div className={cn("rounded-xl border", toneStyles[tone], compact ? "p-3" : "p-4", className)}>
            <div className="flex items-start gap-3">
                {icon ? <span className="text-base leading-none">{icon}</span> : null}
                <div className="space-y-1">
                    <div className="text-sm font-medium">{title}</div>
                    {description ? <div className="text-sm opacity-90">{description}</div> : null}
                    {action ? <div className="pt-1">{action}</div> : null}
                </div>
            </div>
        </div>
    );
}

export function LoadingState({
    label = "Cargando información...",
    className,
}: {
    label?: string;
    className?: string;
}) {
    return (
        <div className={cn("rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600", className)}>
            <div className="flex items-center gap-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                <span>{label}</span>
            </div>
        </div>
    );
}

export function ErrorState({
    title = "No se pudo completar esta carga",
    description,
    className,
}: {
    title?: string;
    description?: string;
    className?: string;
}) {
    return <FeedbackState title={title} description={description} tone="danger" icon="⚠️" className={className} />;
}

export function EmptyState({
    title,
    description,
    className,
}: {
    title: string;
    description?: string;
    className?: string;
}) {
    return <FeedbackState title={title} description={description} tone="neutral" icon="ℹ️" className={className} />;
}
