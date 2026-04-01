-- Migration: 0019_campaign_onboarding_provisioning_defaults
-- Description: default operativo para ops_settings en campañas nuevas (onboarding/provisioning MVP).

ALTER TABLE contact_center.campaigns
    ALTER COLUMN ops_settings SET DEFAULT
    '{
      "primary_channel": "whatsapp",
      "enabled_channels": ["whatsapp"],
      "handoff": {
        "enabled": false,
        "trigger": "intent_or_no_response",
        "sla_minutes": null
      },
      "flags": {
        "outbound_enabled": true,
        "auto_assign": false,
        "human_override": true
      }
    }'::jsonb;

COMMENT ON COLUMN contact_center.campaigns.ops_settings
IS 'MVP SaaS: settings operativos por campaña con defaults de onboarding (channels/handoff/flags).';

