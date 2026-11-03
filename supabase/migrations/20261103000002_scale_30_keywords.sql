-- Scale: 30 keywords instead of 40 (owner's decision, 2026-11-03). Price, mentions and the rest are unchanged.
-- As before, a workspace already over the new allowance keeps its keywords; new ones are refused.

update public.plans set max_keywords = 30 where id = 'scale';
