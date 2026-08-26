-- 0053_pending_refunds_are_not_paid_back.sql
--
-- registration_balances subtracted PENDING refunds from paid_cents. Money that
-- has not left the ministry was being counted as already returned.
--
-- Found in testing, 26 Aug, on a real registration:
--
--   Fees            $960
--   Scholarship    -$240   → owed $720
--   Received        $960   (a $490 card payment and a $470 bank transfer)
--   Refunds         $470   BOTH PENDING — nothing has actually gone back
--
-- The page said "Paid $490 · Balance $230", and offered the family a
-- "Pay $230.00" button. The ministry was holding all $960 of their money and
-- asking for $230 more. The family is $240 IN CREDIT at that moment.
--
-- The end state was right — once both refunds land, $490 net paid against $720
-- owed really is a $230 balance. The error is one of timing, and timing is the
-- whole point of a balance: it is what is true NOW.
--
-- So paid_cents counts refunds that have SUCCEEDED. Refunds in flight get
-- their own column, so a screen can say "a $470 refund is on its way" without
-- that sentence silently moving what somebody owes.
--
-- NOT CHANGED: payment_refundable (0044) still counts pending refunds against
-- what is left to refund, and must. That view answers "how much of this
-- payment could I still send back", and money already in flight is not
-- available to send twice. The two views count differently because they are
-- answering different questions.

create or replace view public.registration_balances
with (security_invoker = on)
as
select r.id as registration_id,
       r.household_id,
       r.event_id,
       coalesce(f.fee_cents, 0::bigint) as fee_cents,
       coalesce(f.discount_cents, 0::bigint) as discount_cents,
       coalesce(f.scholarship_cents, 0::bigint) as scholarship_cents,
       coalesce(c.coupon_cents, 0::bigint) as coupon_cents,
       -- Money in, less money that has actually gone back out.
       coalesce(p.paid_cents, 0::bigint) - coalesce(rf.refunded_cents, 0::bigint) as paid_cents,
       coalesce(f.fee_cents, 0::bigint)
         - coalesce(f.discount_cents, 0::bigint)
         - coalesce(f.scholarship_cents, 0::bigint)
         - coalesce(c.coupon_cents, 0::bigint)
         - (coalesce(p.paid_cents, 0::bigint) - coalesce(rf.refunded_cents, 0::bigint))
         as balance_cents,
       -- Returned. Was "returned or on its way", which is what caused this.
       coalesce(rf.refunded_cents, 0::bigint) as refunded_cents,
       -- On its way. Shown beside a balance, never inside it.
       coalesce(rp.refund_pending_cents, 0::bigint) as refund_pending_cents
  from registrations r
  left join (
    select rp2.registration_id,
           sum(rp2.fee_cents) as fee_cents,
           sum(rp2.discount_cents) as discount_cents,
           sum(rp2.scholarship_cents) as scholarship_cents
      from registration_participants rp2
     where rp2.status <> 'cancelled'
     group by rp2.registration_id
  ) f on f.registration_id = r.id
  left join (
    select cr.registration_id, sum(cr.applied_cents) as coupon_cents
      from coupon_redemptions cr
     group by cr.registration_id
  ) c on c.registration_id = r.id
  left join (
    select pm.registration_id, sum(pm.amount_cents) as paid_cents
      from payments pm
     where pm.status = any (array['succeeded', 'processing'])
     group by pm.registration_id
  ) p on p.registration_id = r.id
  left join (
    select pr.registration_id, sum(pr.amount_cents) as refunded_cents
      from payment_refunds pr
     where pr.status = 'succeeded'
     group by pr.registration_id
  ) rf on rf.registration_id = r.id
  left join (
    select pr.registration_id, sum(pr.amount_cents) as refund_pending_cents
      from payment_refunds pr
     where pr.status = 'pending'
     group by pr.registration_id
  ) rp on rp.registration_id = r.id;

comment on view public.registration_balances is
  'What each registration owes RIGHT NOW. paid_cents nets off refunds that have succeeded; refunds still in flight are reported separately in refund_pending_cents and deliberately do not move the balance (0053).';
