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

type RawTenantSubscriptionRow = {
    tenant_id: string;
    plan_code: string | null;
    status: string | null;
    trial_ends_at: string | null;
    current_period_ends_at: string | null;
    cancel_at_period_end: boolean | null;
    canceled_at: string | null;
    past_due_since: string | null;
    suspended_at: string | null;
    provider: string | null;
    provider_ref: string | null;
    metadata: Record<string, unknown> | null;
};

export type TenantSubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'canceled';

export type TenantSubscriptionSnapshot = {
    tenant_id: string;
    plan_code: PlanCode;
    status: TenantSubscriptionStatus;
    trial_ends_at: string | null;
    current_period_ends_at: string | null;
    cancel_at_period_end: boolean;
    canceled_at: string | null;
    past_due_since: string | null;
    suspended_at: string | null;
    provider: string | null;
    provider_ref: string | null;
    metadata: Record<string, unknown>;
};

export type TenantPlanSnapshot = {
    tenant_id: string;
    plan_code: PlanCode;
    plan_name: string;
    features: Record<PlanFeatureKey, boolean>;
    limits: Record<PlanLimitKey, number | null>;
    settings: Record<string, unknown>;
    limits_raw: Record<string, unknown>;
    subscription: TenantSubscriptionSnapshot;
};

function asObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function normalizeSubscriptionStatus(value: unknown): TenantSubscriptionStatus {
    const status = String(value || '').trim().toLowerCase();
    if (status === 'trial' || status === 'active' || status === 'past_due' || status === 'suspended' || status === 'canceled') {
        return status;
    }
    return 'active';
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

    const rawSubscription = await callPlatformCoreRpc<RawTenantSubscriptionRow[] | RawTenantSubscriptionRow>(
        req,
        'get_active_tenant_subscription',
        {}
    );
    const subscriptionRow = normalizeRpcPayload(rawSubscription);

    if (!row?.tenant_id) {
        return {
            tenant_id: '',
            plan_code: DEFAULT_PLAN_CODE,
            plan_name: PLAN_CATALOG[DEFAULT_PLAN_CODE].name,
            features: { ...PLAN_CATALOG[DEFAULT_PLAN_CODE].features },
            limits: { ...PLAN_CATALOG[DEFAULT_PLAN_CODE].limits },
            settings: {},
            limits_raw: {},
            subscription: {
                tenant_id: '',
                plan_code: DEFAULT_PLAN_CODE,
                status: 'active',
                trial_ends_at: null,
                current_period_ends_at: null,
                cancel_at_period_end: false,
                canceled_at: null,
                past_due_since: null,
                suspended_at: null,
                provider: null,
                provider_ref: null,
                metadata: {},
            },
        };
    }

    const settings = asObject(row.settings);
    const limitsRaw = asObject(row.limits);

    const rawSubPlanCode = String(subscriptionRow?.plan_code || '').trim().toLowerCase();
    const subscriptionPlanCode = rawSubPlanCode ? normalizePlanCode(rawSubPlanCode) : null;
    const planCode = normalizePlanCode(subscriptionPlanCode || row.plan_code || settings.plan_code);
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
        subscription: {
            tenant_id: subscriptionRow?.tenant_id || row.tenant_id,
            plan_code: subscriptionPlanCode || planCode,
            status: normalizeSubscriptionStatus(subscriptionRow?.status),
            trial_ends_at: subscriptionRow?.trial_ends_at || null,
            current_period_ends_at: subscriptionRow?.current_period_ends_at || null,
            cancel_at_period_end: Boolean(subscriptionRow?.cancel_at_period_end),
            canceled_at: subscriptionRow?.canceled_at || null,
            past_due_since: subscriptionRow?.past_due_since || null,
            suspended_at: subscriptionRow?.suspended_at || null,
            provider: subscriptionRow?.provider || null,
            provider_ref: subscriptionRow?.provider_ref || null,
            metadata: asObject(subscriptionRow?.metadata),
        },
    };
}

export function hasPlanFeature(plan: TenantPlanSnapshot, feature: PlanFeatureKey): boolean {
    return Boolean(plan?.features?.[feature]);
}

export function hasTenantFeatureAccess(plan: TenantPlanSnapshot, feature: PlanFeatureKey): boolean {
    if (!hasPlanFeature(plan, feature)) return false;

    const status = plan?.subscription?.status || 'active';
    if (status === 'suspended' || status === 'canceled') return false;
    if (status === 'past_due' && feature === 'executive_dashboard') return false;

    return true;
}

export function hasWriteAccessBySubscription(plan: TenantPlanSnapshot): boolean {
    const status = plan?.subscription?.status || 'active';
    return status !== 'suspended' && status !== 'canceled';
}

export function getPlanLimit(plan: TenantPlanSnapshot, limit: PlanLimitKey): number | null {
    const value = plan?.limits?.[limit];
    if (value == null) return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return null;
    return Math.floor(num);
}

