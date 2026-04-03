#!/usr/bin/env node
/**
 * Seed demo data / demo scenarios MVP
 * - Tenant-safe
 * - Re-runnable (reset + seed)
 * - Oriented to Human Desk / Manager View / Omnichannel Workspace demos
 */

const fs = require('node:fs');
const path = require('node:path');

const SEED_TAG = 'demo-seed-mvp-v1';
const CAMPAIGN_CODE_PREFIX = 'DEMOSEED_';

const DEMO_BLUEPRINT = [
    {
        tenant: { slug: 'eventprolabs-demo-ops', name: 'EventProLabs Demo Ops', plan_code: 'pro' },
        campaigns: [
            {
                code: `${CAMPAIGN_CODE_PREFIX}OPS_WA`,
                name: 'Demo Ops WhatsApp Priority',
                objective: 'Demo end-to-end operativa con foco en SLA/takeover',
                wa_instance: 'eventprolabs-demo-wa',
                wa_business_phone: '51987654321',
                ops_settings: {
                    primary_channel: 'whatsapp',
                    enabled_channels: ['whatsapp', 'webchat'],
                    handoff: { enabled: true, trigger: 'intent_or_no_response', sla_minutes: 10 },
                    flags: { outbound_enabled: true, auto_assign: false, human_override: true },
                },
            },
            {
                code: `${CAMPAIGN_CODE_PREFIX}OPS_WEB`,
                name: 'Demo Ops Web Funnel',
                objective: 'Demo intake/dedup/routing multi-canal en flujo web',
                wa_instance: null,
                wa_business_phone: null,
                ops_settings: {
                    primary_channel: 'webchat',
                    enabled_channels: ['webchat', 'whatsapp', 'voice'],
                    handoff: { enabled: true, trigger: 'intent_or_no_response', sla_minutes: 20 },
                    flags: { outbound_enabled: true, auto_assign: false, human_override: true },
                },
            },
        ],
    },
    {
        tenant: { slug: 'eventprolabs-demo-b2b', name: 'EventProLabs Demo B2B', plan_code: 'basic' },
        campaigns: [
            {
                code: `${CAMPAIGN_CODE_PREFIX}B2B_RET`,
                name: 'Demo B2B Retargeting',
                objective: 'Segundo tenant demo para validar no fuga cross-tenant',
                wa_instance: 'eventprolabs-demo-b2b-wa',
                wa_business_phone: '51981112233',
                ops_settings: {
                    primary_channel: 'whatsapp',
                    enabled_channels: ['whatsapp', 'email'],
                    handoff: { enabled: true, trigger: 'intent_or_no_response', sla_minutes: 30 },
                    flags: { outbound_enabled: true, auto_assign: false, human_override: true },
                },
            },
        ],
    },
];

function loadEnv(relativePath) {
    const filePath = path.resolve(process.cwd(), relativePath);
    if (!fs.existsSync(filePath)) return {};
    const env = {};
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const idx = line.indexOf('=');
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
}

function parseArgs(argv) {
    return {
        noReset: argv.includes('--no-reset'),
    };
}

function toArray(v) {
    return Array.isArray(v) ? v : [];
}

async function reqJson(url, options = {}) {
    const res = await fetch(url, { ...options, cache: 'no-store' });
    const txt = await res.text();
    let body = null;
    try {
        body = txt ? JSON.parse(txt) : null;
    } catch {
        body = txt;
    }
    return { ok: res.ok, status: res.status, body, headers: res.headers };
}

function assertOk(res, label) {
    if (!res.ok) {
        throw new Error(`${label} failed (${res.status}): ${JSON.stringify(res.body)}`);
    }
}

function hApi(token) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function hAuth(anonKey) {
    return { apikey: anonKey, 'Content-Type': 'application/json' };
}

function hCC(token, anonKey) {
    return {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Accept-Profile': 'contact_center',
        'Content-Profile': 'contact_center',
        'Content-Type': 'application/json',
    };
}

function hCCService(serviceKey) {
    return {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: 'application/json',
        'Accept-Profile': 'contact_center',
        'Content-Profile': 'contact_center',
        'Content-Type': 'application/json',
    };
}

function hPlatform(token, anonKey) {
    return {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Accept-Profile': 'platform_core',
        'Content-Profile': 'platform_core',
        'Content-Type': 'application/json',
    };
}

async function login(baseUrl, anonKey, email, password) {
    const res = await reqJson(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: hAuth(anonKey),
        body: JSON.stringify({ email, password }),
    });
    assertOk(res, `login ${email}`);
    if (!res.body?.access_token) throw new Error(`login ${email}: access_token missing`);
    return String(res.body.access_token);
}

async function getActor(baseUrl, anonKey, token) {
    const res = await reqJson(`${baseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    assertOk(res, 'auth user');
    return {
        userId: String(res.body?.id || '').trim(),
        email: String(res.body?.email || '').trim() || null,
    };
}

async function ensureTenant(baseUrl, anonKey, token, def) {
    const createRes = await reqJson(`${baseUrl}/rest/v1/rpc/create_tenant_with_owner`, {
        method: 'POST',
        headers: hPlatform(token, anonKey),
        body: JSON.stringify({ p_name: def.name, p_slug: def.slug }),
    });
    assertOk(createRes, `create_tenant_with_owner(${def.slug})`);
    const item = toArray(createRes.body)[0] || createRes.body;
    const tenantId = String(item?.tenant_id || '').trim();
    if (!tenantId) throw new Error(`tenant_id missing for ${def.slug}`);
    return { tenantId, slug: def.slug, name: def.name };
}

async function setActiveTenant(baseUrl, anonKey, token, tenantId) {
    const res = await reqJson(`${baseUrl}/rest/v1/rpc/set_active_tenant`, {
        method: 'POST',
        headers: hPlatform(token, anonKey),
        body: JSON.stringify({ p_tenant_id: tenantId }),
    });
    assertOk(res, `set_active_tenant(${tenantId})`);
}

async function setActiveTenantPlan(baseUrl, anonKey, token, planCode) {
    if (!planCode) return;
    const normalized = String(planCode).trim().toLowerCase();
    if (!['basic', 'pro', 'enterprise'].includes(normalized)) return;

    const res = await reqJson(`${baseUrl}/rest/v1/rpc/update_active_tenant_plan`, {
        method: 'POST',
        headers: hPlatform(token, anonKey),
        body: JSON.stringify({ p_plan_code: normalized }),
    });
    assertOk(res, `update_active_tenant_plan(${normalized})`);
}

async function listDemoCampaigns(baseUrl, serviceKey, tenantId) {
    const res = await reqJson(
        `${baseUrl}/rest/v1/campaigns?select=id,tenant_id,code,name&tenant_id=eq.${encodeURIComponent(tenantId)}&order=created_at.desc&limit=2000`,
        { method: 'GET', headers: hCCService(serviceKey) }
    );
    assertOk(res, `list campaigns (${tenantId})`);
    return toArray(res.body).filter((c) => String(c.code || '').startsWith(CAMPAIGN_CODE_PREFIX));
}

function chunk(items, size = 80) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

function toInFilter(ids) {
    return `(${ids.map((id) => String(id)).join(',')})`;
}

async function deleteByIn(baseUrl, serviceKey, table, field, ids) {
    const groups = chunk(ids, 80);
    for (const group of groups) {
        const endpoint = `${baseUrl}/rest/v1/${table}?${field}=in.${toInFilter(group)}`;
        const res = await reqJson(endpoint, {
            method: 'DELETE',
            headers: {
                ...hCCService(serviceKey),
                Prefer: 'return=minimal',
            },
        });
        assertOk(res, `delete ${table} by ${field}`);
    }
}

async function resetTenantDemoDataset(baseUrl, serviceKey, tenantId) {
    const demoCampaigns = await listDemoCampaigns(baseUrl, serviceKey, tenantId);
    const campaignIds = demoCampaigns.map((c) => c.id).filter(Boolean);
    if (!campaignIds.length) return { campaigns: 0, leads: 0, calls: 0, messages: 0, events: 0 };

    const leadRows = [];
    for (const ids of chunk(campaignIds, 60)) {
        const leadsRes = await reqJson(
            `${baseUrl}/rest/v1/leads?select=id,campaign_id&campaign_id=in.${toInFilter(ids)}&tenant_id=eq.${encodeURIComponent(tenantId)}&limit=20000`,
            { method: 'GET', headers: hCCService(serviceKey) }
        );
        assertOk(leadsRes, 'list demo leads');
        leadRows.push(...toArray(leadsRes.body));
    }
    const leadIds = leadRows.map((l) => l.id).filter(Boolean);

    let callIds = [];
    if (leadIds.length) {
        for (const ids of chunk(leadIds, 60)) {
            const callsRes = await reqJson(
                `${baseUrl}/rest/v1/calls?select=id,lead_id&lead_id=in.${toInFilter(ids)}&tenant_id=eq.${encodeURIComponent(tenantId)}&limit=20000`,
                { method: 'GET', headers: hCCService(serviceKey) }
            );
            assertOk(callsRes, 'list demo calls');
            callIds = callIds.concat(toArray(callsRes.body).map((c) => c.id).filter(Boolean));
        }
    }

    if (callIds.length) {
        await deleteByIn(baseUrl, serviceKey, 'call_messages', 'call_id', callIds);
        await deleteByIn(baseUrl, serviceKey, 'calls', 'id', callIds);
    }
    if (leadIds.length) {
        await deleteByIn(baseUrl, serviceKey, 'lead_activity_events', 'lead_id', leadIds);
        await deleteByIn(baseUrl, serviceKey, 'leads', 'id', leadIds);
    }
    await deleteByIn(baseUrl, serviceKey, 'campaigns', 'id', campaignIds);

    return {
        campaigns: campaignIds.length,
        leads: leadIds.length,
        calls: callIds.length,
        messages: callIds.length,
        events: leadIds.length,
    };
}

async function createCampaign(appBaseUrl, token, payload) {
    const res = await reqJson(`${appBaseUrl}/api/campaigns`, {
        method: 'POST',
        headers: hApi(token),
        body: JSON.stringify(payload),
    });
    assertOk(res, `create campaign ${payload.code}`);
    const item = res.body?.item;
    if (!item?.id) throw new Error(`campaign id missing for ${payload.code}`);
    return item;
}

async function intakeLead(appBaseUrl, token, payload) {
    const res = await reqJson(`${appBaseUrl}/api/leads/intake`, {
        method: 'POST',
        headers: hApi(token),
        body: JSON.stringify({ items: [payload] }),
    });
    assertOk(res, `lead intake ${payload.source_id}`);
    const item = res.body?.items?.[0];
    if (!item?.id) throw new Error(`lead id missing for ${payload.source_id}`);
    return item;
}

async function mutateLead(appBaseUrl, token, body) {
    const res = await reqJson(`${appBaseUrl}/api/aap/leads/work-queue/assign`, {
        method: 'POST',
        headers: hApi(token),
        body: JSON.stringify(body),
    });
    assertOk(res, `mutate lead ${body.operation}`);
    return res.body?.item || null;
}

async function forceLeadOverdue(baseUrl, serviceKey, tenantId, leadId) {
    const overdueIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const res = await reqJson(
        `${baseUrl}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=id`,
        {
            method: 'PATCH',
            headers: {
                ...hCCService(serviceKey),
                Prefer: 'return=minimal',
            },
            body: JSON.stringify({ sla_due_at: overdueIso, work_status: 'queued' }),
        }
    );
    assertOk(res, 'force lead overdue');
}

async function createOmnichannelCase(baseUrl, serviceKey, tenantId, lead, campaign) {
    const callInsert = await reqJson(`${baseUrl}/rest/v1/calls`, {
        method: 'POST',
        headers: {
            ...hCCService(serviceKey),
            Prefer: 'return=representation',
        },
        body: JSON.stringify([
            {
                tenant_id: tenantId,
                lead_id: lead.id,
                mode: 'human',
                status: 'open',
                phone: lead.phone,
                assigned_channel: 'whatsapp',
                channel: 'whatsapp',
                assigned_to: 'workspace',
                handoff_at: new Date().toISOString(),
                human_status: 'active',
                human_taken_by: 'demo.workspace@eventprolabs.local',
                human_taken_at: new Date().toISOString(),
                customer_whatsapp_phone: lead.phone,
                metadata: {
                    demo_seed_tag: SEED_TAG,
                    scenario: 'omnichannel_workspace_active',
                },
            },
        ]),
    });
    assertOk(callInsert, 'insert demo call');
    const call = toArray(callInsert.body)[0];
    if (!call?.id) throw new Error('call id missing after insert');

    const msgs = [
        {
            tenant_id: tenantId,
            call_id: call.id,
            role: 'lead',
            channel: 'whatsapp',
            from_id: lead.phone,
            from_name: 'Cliente Demo',
            message_text: 'Necesito ayuda urgente con la propuesta.',
            raw: { demo_seed_tag: SEED_TAG, lane: 'workspace' },
        },
        {
            tenant_id: tenantId,
            call_id: call.id,
            role: 'assistant',
            channel: 'whatsapp',
            from_id: campaign.code,
            from_name: campaign.name,
            message_text: 'Te conecto con un asesor para resolverlo ahora.',
            raw: { demo_seed_tag: SEED_TAG, lane: 'workspace' },
        },
        {
            tenant_id: tenantId,
            call_id: call.id,
            role: 'human',
            channel: 'whatsapp',
            from_id: 'workspace',
            from_name: 'Asesor Demo',
            message_text: 'Hola, ya tomé tu caso y reviso opciones.',
            raw: { demo_seed_tag: SEED_TAG, lane: 'workspace' },
        },
    ];

    const msgInsert = await reqJson(`${baseUrl}/rest/v1/call_messages`, {
        method: 'POST',
        headers: {
            ...hCCService(serviceKey),
            Prefer: 'return=minimal',
        },
        body: JSON.stringify(msgs),
    });
    assertOk(msgInsert, 'insert demo call_messages');
    return call.id;
}

async function seedTenantScenarios({ baseUrl, appBaseUrl, anonKey, serviceKey, token, actor, tenant, campaigns }) {
    await setActiveTenant(baseUrl, anonKey, token, tenant.tenantId);
    await setActiveTenantPlan(baseUrl, anonKey, token, tenant.plan_code || 'pro');

    const createdCampaigns = [];
    for (const c of campaigns) {
        const created = await createCampaign(appBaseUrl, token, {
            code: c.code,
            name: c.name,
            objective: c.objective,
            wa_instance: c.wa_instance,
            wa_business_phone: c.wa_business_phone,
            ops_settings: c.ops_settings,
        });
        createdCampaigns.push(created);
    }

    const primaryCampaign = createdCampaigns[0];
    const webCampaign = createdCampaigns[1] || createdCampaigns[0];
    const sourceBase = `${CAMPAIGN_CODE_PREFIX}${tenant.slug.replace(/-/g, '_').toUpperCase()}`;

    const leadNew = await intakeLead(appBaseUrl, token, {
        campaign_id: primaryCampaign.id,
        source_id: `${sourceBase}_NEW`,
        source: 'whatsapp_ads',
        origin: 'meta_form',
        channel: 'whatsapp',
        phone: '51999001001',
        email: `new.${tenant.slug}@eventprolabs.demo`,
        metadata: { demo_seed_tag: SEED_TAG, scenario: 'lead_new' },
    });

    const dupPayload = {
        campaign_id: webCampaign.id,
        source_id: `${sourceBase}_DEDUP`,
        source: 'web_landing',
        origin: 'landing_form',
        channel: 'web',
        phone: '51999001002',
        email: `dedup.${tenant.slug}@eventprolabs.demo`,
        metadata: { demo_seed_tag: SEED_TAG, scenario: 'lead_duplicate' },
    };
    const leadDupFirst = await intakeLead(appBaseUrl, token, dupPayload);
    await intakeLead(appBaseUrl, token, dupPayload);

    const leadAssigned = await intakeLead(appBaseUrl, token, {
        campaign_id: webCampaign.id,
        source_id: `${sourceBase}_ASSIGNED`,
        source: 'api',
        origin: 'crm_push',
        channel: 'api',
        phone: '51999001003',
        email: `assigned.${tenant.slug}@eventprolabs.demo`,
        metadata: { demo_seed_tag: SEED_TAG, scenario: 'lead_assigned' },
    });
    await mutateLead(appBaseUrl, token, {
        lead_id: leadAssigned.id,
        operation: 'assign',
        assignee_user_id: actor.userId,
    });

    const leadTakeover = await intakeLead(appBaseUrl, token, {
        campaign_id: primaryCampaign.id,
        source_id: `${sourceBase}_TAKEOVER`,
        source: 'whatsapp_chat',
        origin: 'inbox',
        channel: 'whatsapp',
        phone: '51999001004',
        email: `takeover.${tenant.slug}@eventprolabs.demo`,
        metadata: { demo_seed_tag: SEED_TAG, scenario: 'lead_takeover', request_human: true },
    });
    await mutateLead(appBaseUrl, token, { lead_id: leadTakeover.id, operation: 'takeover_take' });

    const leadEscalated = await intakeLead(appBaseUrl, token, {
        campaign_id: primaryCampaign.id,
        source_id: `${sourceBase}_ESCALATED`,
        source: 'voice',
        origin: 'call_center',
        channel: 'voice',
        phone: '51999001005',
        email: `escalated.${tenant.slug}@eventprolabs.demo`,
        metadata: { demo_seed_tag: SEED_TAG, scenario: 'lead_escalated' },
    });
    await forceLeadOverdue(baseUrl, serviceKey, tenant.tenantId, leadEscalated.id);
    await mutateLead(appBaseUrl, token, { lead_id: leadEscalated.id, operation: 'set_status', work_status: 'queued' });

    const leadClosed = await intakeLead(appBaseUrl, token, {
        campaign_id: primaryCampaign.id,
        source_id: `${sourceBase}_CLOSED`,
        source: 'webchat',
        origin: 'chat_widget',
        channel: 'webchat',
        phone: '51999001006',
        email: `closed.${tenant.slug}@eventprolabs.demo`,
        metadata: { demo_seed_tag: SEED_TAG, scenario: 'lead_closed', request_human: true },
    });
    await mutateLead(appBaseUrl, token, { lead_id: leadClosed.id, operation: 'takeover_close' });

    const callId = await createOmnichannelCase(baseUrl, serviceKey, tenant.tenantId, leadTakeover, primaryCampaign);

    return {
        tenant_id: tenant.tenantId,
        tenant_slug: tenant.slug,
        campaigns: createdCampaigns.map((c) => ({ id: c.id, code: c.code, name: c.name })),
        scenarios: {
            lead_new: leadNew.id,
            lead_duplicate: leadDupFirst.id,
            lead_assigned: leadAssigned.id,
            lead_takeover: leadTakeover.id,
            lead_escalated: leadEscalated.id,
            lead_closed: leadClosed.id,
            workspace_call_id: callId,
        },
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const env = {
        ...loadEnv('.env.antigravity.local'),
        ...loadEnv('.env'),
        ...loadEnv('apps/web/.env.local'),
        ...process.env,
    };

    const baseUrl = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = String(env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const appBaseUrl = String(env.APP_BASE_URL || env.SMOKE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');

    const adminEmail = String(env.DEMO_ADMIN_EMAIL || 'demo.admin@local.test').trim();
    const adminPassword = String(env.DEMO_ADMIN_PASSWORD || 'DemoAdmin123!').trim();

    if (!baseUrl || !anonKey || !serviceKey) {
        throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');
    }

    const token = await login(baseUrl, anonKey, adminEmail, adminPassword);
    const actor = await getActor(baseUrl, anonKey, token);
    if (!actor.userId) throw new Error('Cannot resolve demo admin user id');

    const seeded = [];
    const resetSummary = [];

    for (const block of DEMO_BLUEPRINT) {
        const tenant = await ensureTenant(baseUrl, anonKey, token, block.tenant);
        await setActiveTenant(baseUrl, anonKey, token, tenant.tenantId);

        if (!args.noReset) {
            const removed = await resetTenantDemoDataset(baseUrl, serviceKey, tenant.tenantId);
            resetSummary.push({ tenant_slug: tenant.slug, removed });
        }

        const data = await seedTenantScenarios({
            baseUrl,
            appBaseUrl,
            anonKey,
            serviceKey,
            token,
            actor,
            tenant,
            campaigns: block.campaigns,
        });
        seeded.push(data);
    }

    console.log(
        JSON.stringify(
            {
                ok: true,
                seed_tag: SEED_TAG,
                reset_performed: !args.noReset,
                reset_summary: resetSummary,
                seeded,
                usage_hints: {
                    manager_view: '/leads/manager',
                    human_desk: '/leads/desk',
                    workspace: '/leads/workspace?leadId=<lead_id>&callId=<call_id>',
                    inbox: '/inbox',
                },
            },
            null,
            2
        )
    );
}

main().catch((err) => {
    console.error(
        JSON.stringify(
            {
                ok: false,
                error: err?.message || String(err),
            },
            null,
            2
        )
    );
    process.exit(1);
});

