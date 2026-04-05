#!/usr/bin/env node
/**
 * Smoke MVP campaign settings / channel assignment tenant-aware.
 * Requiere:
 * - Next app levantada (por defecto http://localhost:3001)
 * - Supabase URL / keys en .env.antigravity.local (o .env)
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

async function login(baseUrl, anonKey, email, password) {
    const res = await reqJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
            apikey: anonKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
    });

    if (!res.ok || !res.body?.access_token) {
        throw new Error(`Login failed (${email}) status=${res.status} body=${JSON.stringify(res.body)}`);
    }

    return String(res.body.access_token);
}

async function createOrGetUser(baseUrl, serviceKey, email, password) {
    const createRes = await reqJson(`${baseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: { source: 'smoke-campaign-settings' },
            app_metadata: { role: 'agent' },
        }),
    });

    if (createRes.ok && createRes.body?.id) return createRes.body.id;

    const listRes = await reqJson(`${baseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
        },
    });

    const found = listRes.body?.users?.find((u) => String(u.email).toLowerCase() === email.toLowerCase());
    if (found?.id) return found.id;

    throw new Error(`Cannot create/get temp user: ${JSON.stringify(createRes.body)}`);
}

async function main() {
    loadEnv(path.resolve('.env.antigravity.local'));
    loadEnv(path.resolve('.env'));

    const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
    const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost:3001').trim().replace(/\/$/, '');

    const adminEmail = String(process.env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test').trim();
    const adminPassword = String(process.env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!').trim();

    const tempEmail = String(process.env.SMOKE_CAMPAIGN_SETTINGS_AGENT_EMAIL || `demo.campaign.settings.${Date.now()}@local.test`).trim();
    const tempPassword = String(process.env.SMOKE_CAMPAIGN_SETTINGS_AGENT_PASSWORD || 'DemoAgent123!').trim();

    expect(Boolean(supabaseUrl && anonKey), 'Supabase URL/anon key disponibles', { supabaseUrl });
    expect(Boolean(serviceKey), 'SUPABASE_SERVICE_ROLE_KEY disponible para smoke completo');

    const adminToken = await login(supabaseUrl, anonKey, adminEmail, adminPassword);
    const authHeaders = (token) => ({
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    });

    const campaignOptions = await reqJson(`${appBaseUrl}/api/aap/leads/wow-campaigns`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    expect(campaignOptions.ok && Array.isArray(campaignOptions.body?.items), 'listar campañas disponibles para smoke', campaignOptions.body);

    let campaignId = String(campaignOptions.body?.items?.[0]?.id || '');

    // Fallback: si wow-campaigns está vacío, buscamos una campaña del tenant activo directo en contact_center.campaigns.
    if (!campaignId) {
        const tenantCtx = await reqJson(`${supabaseUrl}/rest/v1/rpc/resolve_my_tenant_context`, {
            method: 'POST',
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${adminToken}`,
                'Content-Type': 'application/json',
                'Accept-Profile': 'platform_core',
                'Content-Profile': 'platform_core',
            },
            body: JSON.stringify({}),
        });
        const tenantCtxItem = Array.isArray(tenantCtx.body) ? tenantCtx.body[0] : tenantCtx.body;
        expect(tenantCtx.ok && tenantCtxItem?.tenant_id, 'resolver tenant activo para fallback de campaña', tenantCtx.body);

        const tenantId = String(tenantCtxItem.tenant_id);
        const campaignsFallback = await reqJson(
            `${supabaseUrl}/rest/v1/campaigns?select=id,name,tenant_id&tenant_id=eq.${encodeURIComponent(tenantId)}&order=updated_at.desc&limit=1`,
            {
                method: 'GET',
                headers: {
                    apikey: anonKey,
                    Authorization: `Bearer ${adminToken}`,
                    'Accept-Profile': 'contact_center',
                },
            }
        );
        expect(campaignsFallback.ok && Array.isArray(campaignsFallback.body), 'listar campañas fallback por tenant activo', campaignsFallback.body);
        campaignId = String(campaignsFallback.body?.[0]?.id || '');

        if (!campaignId) {
            const createRes = await reqJson(`${supabaseUrl}/rest/v1/campaigns`, {
                method: 'POST',
                headers: {
                    apikey: anonKey,
                    Authorization: `Bearer ${adminToken}`,
                    'Accept-Profile': 'contact_center',
                    'Content-Profile': 'contact_center',
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation',
                },
                body: JSON.stringify({
                    tenant_id: tenantId,
                    code: `SMOKE-${Date.now()}`,
                    name: 'Smoke Campaign Settings',
                    is_active: true,
                }),
            });
            expect(createRes.ok && Array.isArray(createRes.body), 'crear campaña temporal para smoke', createRes.body);
            campaignId = String(createRes.body?.[0]?.id || '');
        }
    }

    expect(Boolean(campaignId), 'existe al menos 1 campaña para probar settings', { campaignId });
    const get1 = await reqJson(`${appBaseUrl}/api/campaigns/${campaignId}/settings`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    expect(get1.ok && get1.body?.item?.campaign_id === campaignId, 'leer campaign settings (admin)', get1.body);

    const stamp = Date.now();
    const patch = await reqJson(`${appBaseUrl}/api/campaigns/${campaignId}/settings`, {
        method: 'PATCH',
        headers: authHeaders(adminToken),
        body: JSON.stringify({
            primary_channel: 'whatsapp',
            enabled_channels: ['whatsapp', 'voice'],
            handoff: {
                enabled: true,
                trigger: 'intent_or_no_response',
                sla_minutes: 15,
            },
            flags: {
                outbound_enabled: true,
                auto_assign: true,
                human_override: true,
            },
            inbound_enabled: true,
            inbound_default_mode: 'human',
            inbound_llm_text_enabled: true,
            llm_fallback_to_human: true,
            wa_instance: `wa-main-${stamp}`,
            wa_business_phone: '51987654321',
        }),
    });

    expect(
        patch.ok
        && patch.body?.item?.ops_settings?.primary_channel === 'whatsapp'
        && Array.isArray(patch.body?.item?.ops_settings?.enabled_channels)
        && patch.body?.item?.ops_settings?.enabled_channels.includes('voice'),
        'actualizar campaign settings (admin)',
        patch.body
    );

    const get2 = await reqJson(`${appBaseUrl}/api/campaigns/${campaignId}/settings`, {
        method: 'GET',
        headers: authHeaders(adminToken),
    });
    expect(
        get2.ok
        && get2.body?.item?.ops_settings?.handoff?.enabled === true
        && get2.body?.item?.wa_business_phone === '51987654321',
        'persistencia de campaign settings tras actualización',
        get2.body
    );

    const tempUserId = await createOrGetUser(supabaseUrl, serviceKey, tempEmail, tempPassword);
    const addMember = await reqJson(`${appBaseUrl}/api/tenant/members`, {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ email: tempEmail, role: 'agent' }),
    });
    expect(addMember.ok && addMember.body?.item?.user_id, 'preparar usuario no-admin dentro del tenant activo', addMember.body);

    const agentToken = await login(supabaseUrl, anonKey, tempEmail, tempPassword);
    const forbidden = await reqJson(`${appBaseUrl}/api/campaigns/${campaignId}/settings`, {
        method: 'PATCH',
        headers: authHeaders(agentToken),
        body: JSON.stringify({ primary_channel: 'voice' }),
    });
    expect(
        forbidden.status === 403 && String(forbidden.body?.error || '').toLowerCase().includes('forbidden'),
        'bloqueo correcto para usuario sin permisos update campaigns',
        forbidden.body
    );

    const remove = await reqJson(`${appBaseUrl}/api/tenant/members/${tempUserId}`, {
        method: 'DELETE',
        headers: authHeaders(adminToken),
    });
    expect(remove.ok && remove.body?.item?.removed === true, 'limpieza de usuario temporal en tenant', remove.body);

    console.log('\nSmoke campaign settings MVP: OK');
}

main().catch((err) => {
    console.error(String(err?.stack || err));
    process.exit(1);
});

