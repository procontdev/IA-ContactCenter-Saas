type Nullable<T> = T | null;

export type DedupMatchKind = 'source_id' | 'email_norm' | 'phone_norm' | 'none';

export type DedupKeyInput = {
    source_id: Nullable<string>;
    email_norm: Nullable<string>;
    phone_norm: Nullable<string>;
};

export type ExistingLeadForMerge = {
    id: string;
    source_id: Nullable<string>;
    form_id: Nullable<string>;
    phone: Nullable<string>;
    phone_norm: Nullable<string>;
    email: Nullable<string>;
    email_norm: Nullable<string>;
    raw: unknown;
};

export type IncomingLeadForMerge = {
    source_id: Nullable<string>;
    form_id: Nullable<string>;
    phone: Nullable<string>;
    phone_norm: Nullable<string>;
    email: Nullable<string>;
    email_norm: Nullable<string>;
    raw: unknown;
};

function hasText(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
}

export function pickDedupMatchKind(keys: DedupKeyInput): DedupMatchKind {
    if (hasText(keys.source_id)) return 'source_id';
    if (hasText(keys.email_norm)) return 'email_norm';
    if (hasText(keys.phone_norm)) return 'phone_norm';
    return 'none';
}

export function mergeLeadFields(existing: ExistingLeadForMerge, incoming: IncomingLeadForMerge) {
    return {
        source_id: existing.source_id ?? incoming.source_id,
        form_id: incoming.form_id ?? existing.form_id,
        phone: incoming.phone ?? existing.phone,
        phone_norm: incoming.phone_norm ?? existing.phone_norm,
        email: incoming.email ?? existing.email,
        email_norm: incoming.email_norm ?? existing.email_norm,
        raw: incoming.raw,
    };
}

