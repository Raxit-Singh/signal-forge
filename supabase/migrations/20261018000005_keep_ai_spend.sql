-- AI spend survives workspace deletion (additive fix).
-- SignalForge's monthly Gemini limit is checked against ai_usage_records. They
-- cascaded with their workspace, so deleting a workspace erased money already
-- spent from the month's total. Records now stay, detached (workspace_id null);
-- users can't see detached rows (RLS matches on workspace).
alter table public.ai_usage_records alter column workspace_id drop not null;
alter table public.ai_usage_records drop constraint ai_usage_records_workspace_id_fkey;
alter table public.ai_usage_records add constraint ai_usage_records_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces (id) on delete set null;
