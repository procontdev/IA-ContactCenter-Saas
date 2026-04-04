#!/usr/bin/env node
/**
 * Smoke: automation rules / operational triggers MVP
 */

const fs = require('fs');
const path = require('path');

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const idx = t.indexOf('=');
        if (idx < 0) continue;
        const key = t.slice(0, idx).trim();
        const val = t.slice(idx + 1).trim();
        if (!(key in process.env)) process.env[key] = val;
    }
}

async function reqJson(url, init) {
    const res = await fetch(url, init);
    const txt = await res.text();
    let body = null;
    try {
        body = txt ? JSON.parse(txt) : null;
    } catch {
        body = txt;
    }
    return { ok: res.ok, status: res.status, body };
}

function expect(ok, message, details) {
    if (!ok) {
        const extra = details ? `\nDETAILS: ${JSON.stringify(details, null, 2)}` : '';
        throw new Error(`[FAIL] ${message}${extra}`);
    }
    console.log(`[OK] ${message}`);
}

function authHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

async function login(baseUrl, anonKey, email, password) {
    const res = await reqJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok || !res.body?.access_token) {
        throw new Error(`Login failed (${email}) status=${res.status} body=${JSON.stringify(res.body)}`);
    }
    return String(res.body.access_token);
}

async function resolveAppBaseUrl(preferred, token) {
    const raw = [
        preferred,
        'http://localhost:3000',
        'http://localhost:3001',
    ]
        .map((x) => String(x || '').trim().replace(/\/+$/, ''))
        .filter(Boolean);

    const dedup = [...new Set(raw)];
    for (const base of dedup) {
        const probe = await reqJson(`${base}/api/tenant/memberships`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (probe.status !== 404) return base;
    }

    return dedup[0] || 'http://localhost:3001';
}

async function main() {
    loadEnv(path.resolve('.env.antigravity.local'));
    loadEnv(path.resolve('.env'));

    const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
    const appBaseUrlFromEnv = String(process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    const adminEmail = String(process.env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test');
    const adminPassword = String(process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!');

    expect(Boolean(supabaseUrl && anonKey), 'Supabase URL/anon key disponibles', { supabaseUrl });
    const adminToken = await login(supabaseUrl, anonKey, adminEmail, adminPassword);
    const appBaseUrl = await resolveAppBaseUrl(appBaseUrlFromEnv, adminToken);

    const campaignsRes = await reqJson(
        `${supabaseUrl}/rest/v1/campaigns?select=id,code,tenant_id&order=created_at.desc&limit=1`,
        { method: 'GET', headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Accept-Profile': 'contact_center' } }
    );
    expect(campaignsRes.ok && Array.isArray(campaignsRes.body) && campaignsRes.body.length > 0, 'existe campaña para tenant activo', campaignsRes.body);
    const campaign = campaignsRes.body[0];

    const seed = Date.now();
    const intake = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({
            items: [{
                campaign_id: campaign.id,
                source_id: `SMK-AUTO-${seed}`,
                source: 'meta_ads',
                origin: 'landing_form',
                channel: 'web',
                phone: '999654399',
                email: `lead.auto.${seed}@mailinator.com`,
                metadata: { smoke: true, lane: 'lead-automation-triggers-mvp' },
            }],
        }),
    });

    const lead = intake.body?.items?.[0];
    expect(intake.ok && lead?.id, 'intake crea lead para automation MVP', intake.body);

    const backdatedIso = new Date(Date.now() - 7 * 60 * 1000).toISOString();
    const forceOverdue = await reqJson(
        `${supabaseUrl}/rest/v1/leads?id=eq.${encodeURIComponent(lead.id)}&tenant_id=eq.${encodeURIComponent(campaign.tenant_id)}&select=id`,
        {
            method: 'PATCH',
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${adminToken}`,
                'Accept-Profile': 'contact_center',
                'Content-Profile': 'contact_center',
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
            },
            body: JSON.stringify({ sla_due_at: backdatedIso, work_status: 'queued' }),
        }
    );
    expect(forceOverdue.ok, 'precondición SLA overdue aplicada', forceOverdue.body);

    const overdueEval = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'set_status', work_status: 'queued' }),
    });

    const afterOverdue = overdueEval.body?.item;
    const overdueRules = Array.isArray(overdueEval.body?.automation?.applied_rules) ? overdueEval.body.automation.applied_rules : [];
    const hadPriorityRaiseRule = overdueRules.some((r) => r.rule_id === 'auto_priority_raise_on_sla_overdue');
    expect(
        overdueEval.ok
        && afterOverdue?.sla_status === 'overdue'
        && afterOverdue?.sla_is_escalated === true
        && String(afterOverdue?.priority || '').toUpperCase() === 'P1'
        && String(afterOverdue?.next_best_action || '').toLowerCase() === 'escalacion_sla_humana'
        && (hadPriorityRaiseRule || String(lead?.priority || '').toUpperCase() === 'P1'),
        'trigger SLA overdue aplica auto-escalate + auto-priority + auto-NBA',
        overdueEval.body
    );

    const take = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'takeover_take' }),
    });
    expect(take.ok && take.body?.item?.human_takeover_status === 'taken', 'takeover tomado para disparar secuencia operacional', take.body);

    const release = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'takeover_release' }),
    });

    const releaseRules = Array.isArray(release.body?.automation?.applied_rules) ? release.body.automation.applied_rules : [];
    expect(
        release.ok
        && release.body?.item?.human_takeover_status === 'released'
        && release.body?.item?.work_status === 'queued'
        && String(release.body?.item?.next_best_action || '').toLowerCase() === 'retomar_contacto_post_takeover'
        && releaseRules.some((r) => r.rule_id === 'auto_nba_on_takeover_release'),
        'trigger takeover_release devuelve a cola y actualiza NBA automáticamente',
        release.body
    );

    const close = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ lead_id: lead.id, operation: 'takeover_close' }),
    });
    expect(close.ok && close.body?.item?.work_status === 'done', 'flujo manual takeover_close sigue funcionando', close.body);

    const persistedLead = await reqJson(
        `${supabaseUrl}/rest/v1/leads?select=id,tenant_id,priority,sla_status,sla_is_escalated,next_best_action,work_status,human_takeover_status&` +
        `id=eq.${encodeURIComponent(lead.id)}&tenant_id=eq.${encodeURIComponent(campaign.tenant_id)}&limit=1`,
        { method: 'GET', headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Accept-Profile': 'contact_center' } }
    );
    const row = Array.isArray(persistedLead.body) ? persistedLead.body[0] : null;
    expect(
        persistedLead.ok && row && row.tenant_id === campaign.tenant_id,
        'persistencia tenant-safe de efectos automáticos',
        persistedLead.body
    );

    const eventsRes = await reqJson(
        `${supabaseUrl}/rest/v1/lead_activity_events?select=event_type,payload,tenant_id,lead_id&` +
        `lead_id=eq.${encodeURIComponent(lead.id)}&tenant_id=eq.${encodeURIComponent(campaign.tenant_id)}&order=event_at.desc&limit=30`,
        { method: 'GET', headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}`, 'Accept-Profile': 'contact_center' } }
    );

    const events = Array.isArray(eventsRes.body) ? eventsRes.body : [];
    const hasAutomationEvent = events.some((e) => String(e.event_type || '') === 'lead.automation.rule_applied');
    const appliedRuleIds = events
        .filter((e) => String(e.event_type || '') === 'lead.automation.rule_applied')
        .map((e) => String(e.payload?.rule_id || ''));

    expect(
        eventsRes.ok
        && hasAutomationEvent
        && (appliedRuleIds.includes('auto_priority_raise_on_sla_overdue') || appliedRuleIds.includes('auto_nba_on_sla_overdue'))
        && appliedRuleIds.includes('auto_nba_on_takeover_release'),
        'timeline/audit registra reglas automáticas aplicadas',
        { count: events.length, appliedRuleIds }
    );

    console.log('\nSmoke automation rules / operational triggers MVP: OK');
}

main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exit(1);
});

