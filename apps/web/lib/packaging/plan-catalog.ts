export type PlanCode = 'basic' | 'pro' | 'enterprise';

export type PlanFeatureKey =
    | 'manager_view'
    | 'executive_dashboard'
    | 'omnichannel_workspace'
    | 'playbooks_nba';

export type PlanLimitKey = 'max_active_campaigns' | 'max_members';

export type PlanDefinition = {
    code: PlanCode;
    name: string;
    rank: number;
    features: Record<PlanFeatureKey, boolean>;
    limits: Record<PlanLimitKey, number | null>;
};

export const DEFAULT_PLAN_CODE: PlanCode = 'pro';

export const PLAN_CATALOG: Record<PlanCode, PlanDefinition> = {
    basic: {
        code: 'basic',
        name: 'Basic',
        rank: 10,
        features: {
            manager_view: false,
            executive_dashboard: false,
            omnichannel_workspace: false,
            playbooks_nba: false,
        },
        limits: {
            max_active_campaigns: 2,
            max_members: 3,
        },
    },
    pro: {
        code: 'pro',
        name: 'Pro',
        rank: 20,
        features: {
            manager_view: true,
            executive_dashboard: true,
            omnichannel_workspace: true,
            playbooks_nba: true,
        },
        limits: {
            max_active_campaigns: 10,
            max_members: 20,
        },
    },
    enterprise: {
        code: 'enterprise',
        name: 'Enterprise',
        rank: 30,
        features: {
            manager_view: true,
            executive_dashboard: true,
            omnichannel_workspace: true,
            playbooks_nba: true,
        },
        limits: {
            max_active_campaigns: null,
            max_members: null,
        },
    },
};

export function isPlanCode(value: unknown): value is PlanCode {
    const code = String(value || '').trim().toLowerCase();
    return code === 'basic' || code === 'pro' || code === 'enterprise';
}

export function normalizePlanCode(value: unknown): PlanCode {
    const code = String(value || '').trim().toLowerCase();
    if (isPlanCode(code)) return code;
    return DEFAULT_PLAN_CODE;
}

