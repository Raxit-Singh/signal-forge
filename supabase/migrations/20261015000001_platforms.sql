-- Milestone 2.5: new platforms. Enum values must be committed before they are
-- used, so they live in their own migration.
alter type public.integration_provider add value if not exists 'bluesky';
alter type public.integration_provider add value if not exists 'dev';
alter type public.integration_provider add value if not exists 'app_store';
alter type public.integration_provider add value if not exists 'threads';
alter type public.integration_provider add value if not exists 'tiktok';
alter type public.integration_provider add value if not exists 'substack';
alter type public.integration_provider add value if not exists 'web';
alter type public.integration_provider add value if not exists 'news';
alter type public.integration_provider add value if not exists 'trustpilot';
