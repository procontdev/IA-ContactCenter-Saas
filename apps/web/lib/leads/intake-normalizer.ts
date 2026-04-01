type Nullable<T> = T | null;

export type NormalizedIntake = {
    source_id: Nullable<string>;
    form_id: Nullable<string>;
    email: Nullable<string>;
    email_norm: Nullable<string>;
    source: string;
    origin: string;
    channel: 'whatsapp' | 'voice' | 'web' | 'api' | 'import' | 'unknown';
    phone: Nullable<string>;
    phone_norm: Nullable<string>;
};

function safeText(v: unknown): string {
    return String(v ?? '').trim();
}

function low(v: unknown): string {
    return safeText(v).toLowerCase();
}

export function normalizePhoneE164(raw: unknown): Nullable<string> {
    const txt = safeText(raw);
    if (!txt) return null;

    const digits = txt.replace(/[^\d]/g, '');
    if (!digits) return null;

    if (txt.startsWith('+') && digits.length >= 8) return `+${digits}`;
    if (digits.length === 9 && digits.startsWith('9')) return `+51${digits}`;
    if (digits.length === 11 && digits.startsWith('51')) return `+${digits}`;
    if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;

    return null;
}

export function normalizePhoneDigits(raw: unknown): Nullable<string> {
    const digits = safeText(raw).replace(/[^\d]/g, '');
    if (!digits) return null;
    if (digits.length < 8) return null;
    return digits;
}

export function normalizeEmail(raw: unknown): Nullable<string> {
    const txt = safeText(raw);
    if (!txt) return null;

    const lowEmail = txt.toLowerCase();
    const simpleEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!simpleEmailRegex.test(lowEmail)) return null;
    return lowEmail;
}

export function mapIntakeChannel(input: { source?: unknown; origin?: unknown; channel?: unknown }): NormalizedIntake['channel'] {
    const c = low(input.channel);
    const s = low(input.source);
    const o = low(input.origin);
    const all = `${c} ${s} ${o}`;

    if (all.includes('whatsapp') || all.includes('wa') || all.includes('wsp')) return 'whatsapp';
    if (all.includes('import') || all.includes('csv') || all.includes('xlsx') || all.includes('sheet')) return 'import';
    if (all.includes('api') || all.includes('webhook') || all.includes('n8n')) return 'api';
    if (
        all.includes('call') ||
        all.includes('voice') ||
        all.includes('dialer') ||
        all.includes('outbound') ||
        all.includes('inbound')
    ) {
        return 'voice';
    }
    if (all.includes('web') || all.includes('form') || all.includes('landing') || all.includes('meta') || all.includes('facebook')) {
        return 'web';
    }

    return 'unknown';
}

export function normalizeLeadIntake(input: {
    source_id?: unknown;
    form_id?: unknown;
    email?: unknown;
    source?: unknown;
    origin?: unknown;
    channel?: unknown;
    phone?: unknown;
}): NormalizedIntake {
    const source = safeText(input.source) || 'unknown';
    const origin = safeText(input.origin) || 'unknown';
    const channel = mapIntakeChannel(input);
    const phone = normalizePhoneE164(input.phone);
    const phone_norm = normalizePhoneDigits(input.phone ?? phone);
    const email_norm = normalizeEmail(input.email);
    const email = email_norm;

    const source_id = safeText(input.source_id) || null;
    const form_id = safeText(input.form_id) || null;

    return {
        source_id,
        form_id,
        email,
        email_norm,
        source,
        origin,
        channel,
        phone,
        phone_norm,
    };
}

export function buildIntakeRaw(existingRaw: unknown, input: { source: string; origin: string; channel: string; metadata?: unknown }) {
    const rawObj = existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw) ? (existingRaw as Record<string, unknown>) : {};

    const currentHistory = Array.isArray(rawObj.intake_history) ? rawObj.intake_history : [];
    const latestEntry = {
        source: input.source,
        origin: input.origin,
        channel: input.channel,
        mapped_at: new Date().toISOString(),
        metadata: input.metadata ?? null,
        version: 1,
    };

    const intake_history = [...currentHistory, latestEntry].slice(-20);

    return {
        ...rawObj,
        intake: latestEntry,
        intake_history,
    };
}

