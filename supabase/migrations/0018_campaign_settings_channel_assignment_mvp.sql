-- Migration: 0018_campaign_settings_channel_assignment_mvp
-- Description: agrega contenedor JSONB por campaña para channel assignment / settings operativos MVP.

ALTER TABLE contact_center.campaigns
    ADD COLUMN IF NOT EXISTS ops_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'campaigns_ops_settings_is_object'
    ) THEN
        ALTER TABLE contact_center.campaigns
            ADD CONSTRAINT campaigns_ops_settings_is_object
            CHECK (jsonb_typeof(ops_settings) = 'object');
    END IF;
END;
$$;

COMMENT ON COLUMN contact_center.campaigns.ops_settings
IS 'MVP SaaS: settings operativos por campaña (primary_channel, enabled_channels, handoff, flags).';

