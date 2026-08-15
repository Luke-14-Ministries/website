-- 0006: let the Stripe webhook record payments.
--
-- The stripe-webhook Edge Function writes card/bank payments using the
-- service-role key -- which is what the payments RLS in 0001 always intended
-- ("card and bank payments are written by the Stripe webhook using the service
-- key"). But 0001's least-privilege table grants never actually gave
-- service_role any DML on payments, so the webhook failed with "permission
-- denied for table payments". Grant exactly what recording a payment needs,
-- and nothing else.

grant select, insert, update on public.payments to service_role;
