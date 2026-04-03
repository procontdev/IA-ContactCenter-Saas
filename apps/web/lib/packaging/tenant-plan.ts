import { callPlatformCoreRpc, normalizeRpcPayload } from '@/lib/tenant/tenant-rpc-server';
import {
    DEFAULT_PLAN_CODE,
    normalizePlanCode,
    PLAN_CATALOG,
    type PlanCode,
    type PlanFeatureKey,
    type PlanLimitKey,
} from './plan-catalog';

type RawTenantPlanRow = {
    tenant_id: string;
    plan_code: string | null;
    settings: Record<string, unknown> | null;
    limits: Record<string, unknown> | null;
};

export type TenantPlanSnapshot = {
    tenant_id: string;
    plan_code: PlanCode;
    plan_name: string;
    features: Record<PlanFeatureKey, boolean>;
    limits: Record<PlanLimitKey, number | null>;
    settings: Record<string, unknown>;
    limits_raw: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function parseFeatureOverrides(input: Record<string, unknown>) {
    const output: Partial<Record<PlanFeatureKey, boolean>> = {};
    const keys: PlanFeatureKey[] = ['manager_view', 'executive_dashboard', 'omnichannel_workspace', 'playbooks_nba'];

    for (const key of keys) {
        const raw = input[key];
        if (typeof raw === 'boolean') output[key] = raw;
    }
    return output;
}

function parseLimitOverrides(input: Record<string, unknown>) {
    const output: Partial<Record<PlanLimitKey, number | null>> = {};
    const keys: PlanLimitKey[] = ['max_active_campaigns', 'max_members'];

    for (const key of keys) {
        const raw = input[key];
        if (raw === null) {
            output[key] = null;
            continue;
        }
        const num = Number(raw);
        if (Number.isFinite(num) && num >= 0) {
            output[key] = Math.floor(num);
        }
    }
    return output;
}

export async function resolveTenantPlanFromRequest(req: Request): Promise<TenantPlanSnapshot> {
    const raw = await callPlatformCoreRpc<RawTenantPlanRow[] | RawTenantPlanRow>(req, 'get_active_tenant_plan', {});
    const row = normalizeRpcPayload(raw);

    if (!row?.tenant_id) {
        return {
            tenant_id: '',
            plan_code: DEFAULT_PLAN_CODE,
            plan_name: PLAN_CATALOG[DEFAULT_PLAN_CODE].name,
            features: { ...PLAN_CATALOG[DEFAULT_PLAN_CODE].features },
            limits: { ...PLAN_CATALOG[DEFAULT_PLAN_CODE].limits },
            settings: {},
            limits_raw: {},
        };
    }

    const settings = asObject(row.settings);
    const limitsRaw = asObject(row.limits);

    const planCode = normalizePlanCode(row.plan_code || settings.plan_code);
    const base = PLAN_CATALOG[planCode];

    const featureOverrides = parseFeatureOverrides(asObject(settings.feature_overrides));
    const limitOverrides = {
        ...parseLimitOverrides(limitsRaw),
        ...parseLimitOverrides(asObject(settings.limit_overrides)),
    };

    return {
        tenant_id: row.tenant_id,
        plan_code: planCode,
        plan_name: base.name,
        features: {
            ...base.features,
            ...featureOverrides,
        },
        limits: {
            ...base.limits,
            ...limitOverrides,
        },
        settings,
        limits_raw: limitsRaw,
    };
}

export function hasPlanFeature(plan: TenantPlanSnapshot, feature: PlanFeatureKey): boolean {
    return Boolean(plan?.features?.[feature]);
}

export function getPlanLimit(plan: TenantPlanSnapshot, limit: PlanLimitKey): number | null {
    const value = plan?.limits?.[limit];
    if (value == null) return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return null;
    return Math.floor(num);
}

