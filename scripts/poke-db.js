
const fs = require('fs');
const path = require('path');

function getEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const k = trimmed.substring(0, eqIdx).trim();
      const v = trimmed.substring(eqIdx + 1).trim().replace(/^"(.*)"$/, '$1');
      env[k] = v;
    }
  });
  return env;
}

async function test() {
  const env1 = getEnv(path.join(__dirname, '../apps/web/.env.local'));
  const env2 = getEnv(path.join(__dirname, '../.env.antigravity.local'));
  const env = { ...env1, ...env2 };
  
  const urlBase = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('--- ENV CHECK ---');
  console.log('ENDPOINT:', urlBase);

  console.log('\n--- TEST 1: platform_core.tenants (SERVICE_ROLE) ---');
  try {
    const res = await fetch(`${urlBase}/rest/v1/tenants?select=*`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Accept-Profile': 'platform_core'
      },
      signal: AbortSignal.timeout(10000)
    });
    console.log('Status:', res.status, res.statusText);
    const data = await res.json();
    console.log('Data (sample):', JSON.stringify(Array.isArray(data) ? data.slice(0, 2) : data, null, 2));
  } catch (e) {
    console.error('Error in Test 1:', e.message);
  }

  console.log('\n--- TEST 2: contact_center.campaigns (ANON) ---');
  try {
    const res = await fetch(`${urlBase}/rest/v1/campaigns?select=*`, {
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Accept-Profile': 'contact_center'
      },
      signal: AbortSignal.timeout(10000)
    });
    console.log('Status:', res.status, res.statusText);
    const data = await res.json();
    console.log('Data (sample):', JSON.stringify(Array.isArray(data) ? data.slice(0, 2) : data, null, 2));
  } catch (e) {
    console.error('Error in Test 2:', e.message);
  }
}

test();
