-- 0035_conditional_agreements.sql
--
-- The scholarship and payment-by-check agreements leave the registration
-- form's required block (decision 24 Aug, reversing the interim
-- everyone-signs-everything parity with CampSite). An "Agree" from a family
-- paying by card who never requested aid is a signature on terms that do not
-- bind them, and it trains people to click past legal text.
--
-- The AGREEMENTS remain, versioned and untouched -- only where they are
-- presented changes. The scholarship agreement is now signed inside the
-- Help-with-the-fee form, at the moment it starts to apply. Payment-by-check
-- becomes information shown in the payment area (the mailing address), not a
-- signature: check is not a site payment method, and its terms are
-- instructions, not obligations.
--
-- Signatures already collected against these agreements are untouched: they
-- were validly given under the rules in force at the time.

delete from public.agreement_requirements r
using public.agreements a
where r.agreement_id = a.id
  and a.key in ('scholarship_agreement', 'payment_by_check');
