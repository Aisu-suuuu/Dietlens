-- =============================================================================
-- DietLens: Email invites (Wave 4)
--
-- One row per "I'd like to invite this email" event. The token is the
-- random part of the magic-link redirect; when the invitee returns to
-- /auth/callback?invite=<token>&code=..., we look up this row, insert a
-- MUTUAL follow edge between inviter and the new user, and mark the row
-- accepted.
--
-- (Mutual on invite is the only place where mutuality is enforced — manual
-- follows via FollowButton remain strictly asymmetric per the locked
-- decision in the plan.)
--
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.invites (
  token         text        primary key,
  inviter_id    uuid        not null
                              references auth.users (id)
                              on delete cascade,
  invitee_email text        not null,
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  accepted_by   uuid        references auth.users (id) on delete set null
);

-- Index: list of invites by inviter (for "you've invited 5 people" UI).
create index if not exists invites_inviter_idx
  on public.invites (inviter_id);

-- RLS: enable
alter table public.invites enable row level security;

-- The inviter can read + write rows where they are the inviter.
-- The acceptance path (inserting the mutual follow + marking accepted) runs
-- server-side under the service role and bypasses RLS — that's the only
-- path that touches another user's row, and it's gated by knowledge of the
-- token, which only the invitee receives via email.
drop policy if exists invites_inviter on public.invites;
create policy invites_inviter
  on public.invites
  for all
  using       (auth.uid() = inviter_id)
  with check  (auth.uid() = inviter_id);

-- =============================================================================
-- END OF MIGRATION
-- Verification:
--   -- as user A:
--   insert into public.invites (token, inviter_id, invitee_email)
--     values ('test-token-1', auth.uid(), 'friend@example.com');
--   select * from public.invites where inviter_id = auth.uid();   -- visible
--   -- as user B (different session): same select returns 0 rows.
-- =============================================================================
