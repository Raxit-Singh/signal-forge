-- Additive: let the development-only routine stand-in be stored as a routine URL.
-- The application accepts that URL only outside production (parseFireUrl / mockAllowed);
-- every other routine URL must still be https.
alter table public.agent_connections drop constraint agent_connections_fire_url_check;
alter table public.agent_connections add constraint agent_connections_fire_url_check check (
  char_length(fire_url) <= 300 and (
    fire_url ~ '^https://'
    or fire_url ~ '^http://(localhost|127\.0\.0\.1):[0-9]{2,5}/api/dev/mock-routine/trig_[A-Za-z0-9]{8,64}/fire$'
  )
);
