-- Mentions, classifications, feedback clusters, daily analytics, AI usage,
-- investigations, notifications and reports. Populated from Milestone 2 on;
-- created now so the schema and RLS are designed and tested as a whole.

create type public.sentiment as enum ('positive', 'negative', 'neutral', 'mixed', 'uncertain');

create type public.feedback_category as enum (
  'bug_report', 'feature_request', 'usability_complaint', 'pricing_complaint',
  'performance_issue', 'security_concern', 'positive_review', 'general_discussion',
  'support_question', 'competitor_comparison'
);

create type public.relevance_status as enum (
  'pending', 'relevant', 'irrelevant', 'user_relevant', 'user_irrelevant'
);

create type public.processing_status as enum (
  'ingested', 'filtered', 'classified', 'failed', 'skipped'
);

create type public.dedup_kind as enum ('original', 'exact_duplicate', 'repost');

create table public.mentions (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  product_id          uuid not null,
  competitor_id       uuid,                       -- set when the mention is about a competitor
  source              public.integration_provider not null,
  external_id         text not null check (char_length(external_id) <= 300),
  source_url          text not null check (source_url ~* '^https://' and char_length(source_url) <= 2048),
  parent_external_id  text check (char_length(parent_external_id) <= 300),  -- thread/story/video
  author_external_id  text check (char_length(author_external_id) <= 300),  -- only where permitted
  author_display      text check (char_length(author_display) <= 200),
  title               text check (char_length(title) <= 500),
  content             text check (char_length(content) <= 20000),        -- permitted excerpt only
  content_hash        text,                                               -- sha256 of normalized content
  language            text check (char_length(language) <= 16),
  published_at        timestamptz not null,
  discovered_at       timestamptz not null default now(),
  engagement          jsonb not null default '{}'::jsonb,   -- {likes, comments, points, views, ...}
  engagement_score    bigint not null default 0 check (engagement_score >= 0),
  matched_terms       text[] not null default '{}',
  relevance_score     real check (relevance_score between 0 and 1),
  relevance_status    public.relevance_status not null default 'pending',
  sentiment           public.sentiment,
  sentiment_confidence real check (sentiment_confidence between 0 and 1),
  feedback_category   public.feedback_category,
  category_confidence real check (category_confidence between 0 and 1),
  dedup_kind          public.dedup_kind not null default 'original',
  canonical_mention_id uuid references public.mentions (id) on delete set null,
  processing_status   public.processing_status not null default 'ingested',
  retain_until        timestamptz,                -- platform / plan retention
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (competitor_id, workspace_id) references public.competitors (id, workspace_id) on delete cascade
);

-- One row per product + source + external item: the core dedup guarantee.
create unique index mentions_external_uniq on public.mentions (product_id, source, external_id);
create index mentions_product_published_idx on public.mentions (product_id, published_at desc);
create index mentions_ws_published_idx on public.mentions (workspace_id, published_at desc);
create index mentions_content_hash_idx on public.mentions (product_id, content_hash) where content_hash is not null;
create index mentions_filters_idx on public.mentions (product_id, relevance_status, sentiment, feedback_category);
create index mentions_retention_idx on public.mentions (retain_until) where retain_until is not null;

create trigger mentions_touch before update on public.mentions
  for each row execute function private.touch_updated_at();

-- Full history of every classification (rules, models, manual corrections).
create table public.mention_classifications (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null,
  mention_id    uuid not null,
  dimension     text not null check (dimension in ('relevance', 'sentiment', 'category')),
  label         text not null,
  confidence    real check (confidence between 0 and 1),
  classifier    text not null,           -- 'rules:v1', 'anthropic:<model>', 'manual'
  rationale     text check (char_length(rationale) <= 2000),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (mention_id, workspace_id) references public.mentions (id, workspace_id) on delete cascade
);

create index mention_classifications_mention_idx on public.mention_classifications (mention_id, created_at desc);

create table public.feedback_clusters (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  product_id      uuid not null,
  category        public.feedback_category not null,
  title           text not null check (char_length(title) <= 200),
  description     text check (char_length(description) <= 4000),
  report_count    integer not null default 0,     -- independent reports only (reposts excluded)
  unique_reporters integer,                        -- null when not measurable
  platforms       public.integration_provider[] not null default '{}',
  sentiment       public.sentiment,
  suggested_priority text check (suggested_priority in ('low', 'medium', 'high', 'critical')),
  confidence      real check (confidence between 0 and 1),
  first_detected_at timestamptz,
  last_detected_at  timestamptz,
  status          text not null default 'open' check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create index feedback_clusters_product_idx on public.feedback_clusters (product_id, last_detected_at desc);

create trigger feedback_clusters_touch before update on public.feedback_clusters
  for each row execute function private.touch_updated_at();

create table public.feedback_cluster_members (
  cluster_id    uuid not null,
  mention_id    uuid not null,
  workspace_id  uuid not null,
  similarity    real check (similarity between 0 and 1),
  added_at      timestamptz not null default now(),
  primary key (cluster_id, mention_id),
  foreign key (cluster_id, workspace_id) references public.feedback_clusters (id, workspace_id) on delete cascade,
  foreign key (mention_id, workspace_id) references public.mentions (id, workspace_id) on delete cascade
);

-- Pre-aggregated daily counts (UTC days). Charts read these, never raw mentions.
create table public.daily_mention_stats (
  workspace_id    uuid not null,
  product_id      uuid not null,
  competitor_id   uuid,
  day             date not null,
  source          public.integration_provider not null,
  mentions        integer not null default 0,
  unique_authors  integer not null default 0,
  positive        integer not null default 0,
  negative        integer not null default 0,
  neutral         integer not null default 0,
  mixed           integer not null default 0,
  uncertain       integer not null default 0,
  engagement      bigint not null default 0,
  computed_at     timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (competitor_id, workspace_id) references public.competitors (id, workspace_id) on delete cascade
);

create unique index daily_mention_stats_uniq
  on public.daily_mention_stats (product_id, competitor_id, day, source) nulls not distinct;
create index daily_mention_stats_ws_day_idx on public.daily_mention_stats (workspace_id, day desc);

-- ---------------------------------------------------------------------------
-- AI usage & investigations
-- ---------------------------------------------------------------------------
create table public.ai_usage_records (
  id              bigint generated always as identity primary key,
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  provider        public.ai_provider not null,
  model           text not null,
  purpose         text not null,           -- 'relevance', 'sentiment', 'cluster', 'investigation', ...
  billed_to       text not null check (billed_to in ('signalforge', 'byok')),
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cached_tokens   integer not null default 0,
  cost_microusd   bigint not null default 0,   -- estimate from configured price table
  success         boolean not null,
  error_code      text,
  cache_key       text,
  created_at      timestamptz not null default now()
);

create index ai_usage_ws_time_idx on public.ai_usage_records (workspace_id, created_at desc);

create table public.ai_investigations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  product_id      uuid not null,
  kind            text not null check (kind in ('bug', 'feature', 'spike_explanation')),
  cluster_id      uuid,
  status          text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'insufficient_data')),
  title           text check (char_length(title) <= 200),
  -- Structured output with explicit evidence tiers:
  -- {confirmed: [...], hypotheses: [...], assumptions: [...], evidence: [{mention_id, url}], ...}
  report          jsonb,
  model           text,
  requested_by    uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (cluster_id, workspace_id) references public.feedback_clusters (id, workspace_id) on delete set null (cluster_id)
);

create index ai_investigations_product_idx on public.ai_investigations (product_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications & reports
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  channel           text not null default 'email' check (channel in ('email', 'slack', 'discord', 'in_app')),
  daily_summary     boolean not null default false,
  weekly_report     boolean not null default true,
  spike_alerts      boolean not null default true,
  negative_sentiment_alerts boolean not null default true,
  bug_alerts        boolean not null default true,
  feature_cluster_alerts boolean not null default false,
  updated_at        timestamptz not null default now(),
  primary key (workspace_id, user_id, channel),
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete cascade,   -- null = all members
  product_id      uuid,
  kind            text not null check (kind in ('spike', 'negative_sentiment', 'bug', 'feature_cluster', 'report_ready', 'integration_error', 'system')),
  title           text not null check (char_length(title) <= 200),
  body            text check (char_length(body) <= 4000),
  link            text check (char_length(link) <= 2048),
  dedupe_key      text not null,
  read_at         timestamptz,
  emailed_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create index notifications_ws_user_idx on public.notifications (workspace_id, user_id, created_at desc);

create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  product_id      uuid not null,
  kind            text not null check (kind in ('weekly', 'daily', 'custom')),
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  status          text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  data            jsonb,       -- numbers computed from daily_mention_stats at generation time
  narrative       jsonb,       -- AI summary with evidence links (optional)
  created_at      timestamptz not null default now(),
  check (period_end > period_start),
  unique (product_id, kind, period_start),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);
