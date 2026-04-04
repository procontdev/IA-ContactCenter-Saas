import { normalizeOpsSettings } from '@/lib/campaigns/provisioning';
import type { NormalizedIntake } from '@/lib/leads/intake-normalizer';

type Nullable<T> = T | null;

type IntakeSignals = {
    queue_start?: Nullable<string>;
    estado_cliente?: Nullable<string>;
    estado_usuario?: Nullable<string>;
    metadata?: unknown;
};

export type BuildQualificationRoutingInput = {
    normalized: NormalizedIntake;
    campaignCode: string;
    opsSettings?: unknown;
    llmPolicy?: unknown;
    signals?: IntakeSignals;
};

export type LeadQualificationRouting = {
    lead_score: number;
    lead_temperature: 'caliente' | 'tibio' | 'frio';
    priority: 'P1' | 'P2' | 'P3';
    next_best_action: string;
    sla_due_at: string;
    estado_usuario: string;
    queue_start: string;
    quality_flags: string[];
    spam_flags: string[];
    lead_score_reasons: string[];
    handoff_required: boolean;
};

function txt(v: unknown): string {
    return String(v ?? '').trim();
}

function low(v: unknown): string {
    return txt(v).toLowerCase();
}

function isObject(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function hasKeyword(value: unknown, words: string[]): boolean {
    const candidate = low(value);
    if (!candidate) return false;
    return words.some((w) => candidate.includes(w));
}

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

function queueByChannel(channel: NormalizedIntake['channel']) {
    if (channel === 'whatsapp') return 'wow_queue_whatsapp';
    if (channel === 'voice') return 'wow_queue_voice';
    if (channel === 'web' || channel === 'api' || channel === 'import') return 'wow_queue_digital';
    return 'wow_queue_default';
}

function addMinutesIso(minutes: number) {
    const due = new Date(Date.now() + minutes * 60 * 1000);
    return due.toISOString();
}

function pickFallbackChannel(raw: unknown): NormalizedIntake['channel'] {
    const v = low(raw);
    if (v === 'whatsapp') return 'whatsapp';
    if (v === 'voice') return 'voice';
    if (v === 'webchat') return 'web';
    if (v === 'email' || v === 'sms' || v === 'telegram') return 'api';
    return 'unknown';
}

export function buildLeadQualificationRouting(input: BuildQualificationRoutingInput): LeadQualificationRouting {
    const llmPolicy = isObject(input.llmPolicy) ? input.llmPolicy : {};
    const fallbackOps = isObject(llmPolicy.campaign_ops_settings) ? llmPolicy.campaign_ops_settings : null;
    const ops = normalizeOpsSettings(input.opsSettings ?? fallbackOps);

    const campaignCode = txt(input.campaignCode) || 'unknown_campaign';
    const metadata = isObject(input.signals?.metadata) ? input.signals?.metadata : {};
    const initialEstadoUsuario = txt(input.signals?.estado_usuario) || 'nuevo';

    const channel = input.normalized.channel === 'unknown'
        ? pickFallbackChannel(ops.primary_channel)
        : input.normalized.channel;

    const qualityFlags: string[] = [];
    const spamFlags: string[] = [];
    const reasons: string[] = [];

    let score = 50;
    reasons.push('base:50');

    const hasPhone = Boolean(input.normalized.phone_norm);
    const hasEmail = Boolean(input.normalized.email_norm);

    if (hasPhone) {
        score += 15;
        reasons.push('has_phone_norm:+15');
    }
    if (hasEmail) {
        score += 10;
        reasons.push('has_email_norm:+10');
    }
    if (input.normalized.source_id) {
        score += 10;
        reasons.push('has_source_id:+10');
    }
    if (channel === 'whatsapp' || channel === 'web' || channel === 'api') {
        score += 10;
        reasons.push(`channel_${channel}:+10`);
    }
    if (channel === 'unknown') {
        score -= 20;
        reasons.push('channel_unknown:-20');
        qualityFlags.push('unknown_channel');
    }
    if (!hasPhone && !hasEmail) {
        score -= 20;
        reasons.push('missing_contact_data:-20');
        qualityFlags.push('missing_contact_data');
    }

    const estadoCliente = low(input.signals?.estado_cliente);
    if (estadoCliente.startsWith('contesto')) {
        score += 10;
        reasons.push('estado_cliente_contesto:+10');
    } else if (estadoCliente.startsWith('no contesto')) {
        score -= 10;
        reasons.push('estado_cliente_no_contesto:-10');
    }

    if (txt(input.normalized.phone) && !input.normalized.phone_norm) {
        spamFlags.push('invalid_phone_format');
    }

    const metadataHandoff =
        metadata.handoff_required === true ||
        metadata.request_human === true ||
        metadata.handoff === true;
    const manualHandoffKeyword = hasKeyword(input.signals?.estado_usuario, ['handoff', 'humano', 'asesor', 'supervisor']);

    const handoffRequired = metadataHandoff || manualHandoffKeyword;
    if (handoffRequired) {
        qualityFlags.push('handoff_required');
        reasons.push('handoff_required:+priority');
    }

    score = clamp(score, 0, 100);

    const lead_temperature: LeadQualificationRouting['lead_temperature'] =
        score >= 75 ? 'caliente' : score >= 45 ? 'tibio' : 'frio';

    const priority: LeadQualificationRouting['priority'] =
        handoffRequired || score >= 80 ? 'P1' : score >= 55 ? 'P2' : 'P3';

    const prioritySla = priority === 'P1' ? 15 : priority === 'P2' ? 60 : 240;
    const configuredSla = ops.handoff.sla_minutes == null ? null : Math.max(1, Math.floor(ops.handoff.sla_minutes));
    const slaMinutes = handoffRequired && configuredSla ? configuredSla : prioritySla;

    const queue_start = txt(input.signals?.queue_start) || queueByChannel(channel);
    const next_best_action = handoffRequired
        ? 'handoff_humano_prioritario'
        : `primer_contacto_${queue_start.replace(/^wow_queue_/, '')}`;

    return {
        lead_score: score,
        lead_temperature,
        priority,
        next_best_action,
        sla_due_at: addMinutesIso(slaMinutes),
        estado_usuario: initialEstadoUsuario,
        queue_start,
        quality_flags: qualityFlags,
        spam_flags: spamFlags,
        lead_score_reasons: [...reasons, `campaign:${campaignCode}`],
        handoff_required: handoffRequired,
    };
}

