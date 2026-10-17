-- Product Insights (additive): three more on-demand analyses stored like the others.
--   feature_evaluation  AI, cited: needs, use cases, workarounds, concerns of a feature request
--   issue_draft         AI, cited: a GitHub issue draft the user files on GitHub themselves
--   github_duplicates   no AI: existing issues in the product's public repository that may match
alter table public.ai_investigations drop constraint ai_investigations_kind_check;
alter table public.ai_investigations add constraint ai_investigations_kind_check
  check (kind in ('bug', 'feature', 'spike_explanation', 'cluster_summary', 'feature_evaluation', 'issue_draft', 'github_duplicates'));
