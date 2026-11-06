-- Optional official PKCE email-link delivery alongside the existing numeric OTP flow.
-- Retain all users/projects and the default-deny server-only action ledger.
begin;
alter table public.inkstrip_account_actions
 add column email_hash text check(email_hash is null or email_hash ~ '^[a-f0-9]{64}$');
alter table public.inkstrip_account_actions drop constraint inkstrip_account_actions_kind_check;
alter table public.inkstrip_account_actions add constraint inkstrip_account_actions_kind_check
 check(kind in ('oauth_signin','oauth_reauth','oauth_link','recovery','fresh','email_signup','email_recovery'));
alter table public.inkstrip_account_actions add constraint inkstrip_email_intent_target
 check(kind not in ('email_signup','email_recovery') or email_hash is not null);
commit;
