export const CHANNELS = ['whatsapp', 'voice', 'webchat', 'email', 'sms', 'telegram'] as const;

export type CampaignChannel = (typeof CHANNELS)[number];

export const CHANNEL_SET = new Set<string>(CHANNELS);

export type NormalizedOpsSettings = {
    primary_channel: CampaignChannel | string;
    enabled_channels: string[];
    handoff: {
        enabled: boolean;
        trigger: string;
        sla_minutes: number | null;
    };
    flags: {
        outbound_enabled: boolean;
        auto_assign: boolean;
        human_override: boolean;
    };
};

export const DEFAULT_OPS_SETTINGS: NormalizedOpsSettings = {
    primary_channel: 'whatsapp',
    enabled_channels: ['whatsapp'],
    handoff: {
        enabled: false,
        trigger: 'intent_or_no_response',
        sla_minutes: null,
    },
    flags: {
        outbound_enabled: true,
        auto_assign: false,
        human_override: true,
    },
};

export function isObject(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeChannelList(v: unknown): string[] {
    if (!Array.isArray(v)) return [];

    const dedup = new Set<string>();
    for (const raw of v) {
        const item = String(raw || '').trim().toLowerCase();
        if (!item || !CHANNEL_SET.has(item)) continue;
        dedup.add(item);
    }
    return Array.from(dedup.values());
}

export function normalizeOpsSettings(raw: unknown): NormalizedOpsSettings {
    const base = isObject(raw) ? raw : {};

    const primary = String(base.primary_channel || '').trim().toLowerCase();
    const enabledFromInput = normalizeChannelList(base.enabled_channels);
    const enabled = enabledFromInput.length > 0 ? enabledFromInput : primary ? [primary] : [...DEFAULT_OPS_SETTINGS.enabled_channels];
    const primaryChannel = CHANNEL_SET.has(primary)
        ? primary
        : (enabled[0] || DEFAULT_OPS_SETTINGS.primary_channel);

    const handoff = isObject(base.handoff) ? base.handoff : {};
    const flags = isObject(base.flags) ? base.flags : {};

    return {
        primary_channel: primaryChannel,
        enabled_channels: enabled,
        handoff: {
            enabled: handoff.enabled === true,
            trigger: String(handoff.trigger || DEFAULT_OPS_SETTINGS.handoff.trigger).trim() || DEFAULT_OPS_SETTINGS.handoff.trigger,
            sla_minutes:
                handoff.sla_minutes == null || Number.isNaN(Number(handoff.sla_minutes))
                    ? null
                    : Math.max(1, Math.min(180, Number(handoff.sla_minutes))),
        },
        flags: {
            outbound_enabled: flags.outbound_enabled !== false,
            auto_assign: flags.auto_assign === true,
            human_override: flags.human_override !== false,
        },
    };
}
