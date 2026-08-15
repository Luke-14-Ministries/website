// Money helpers. Everything is in integer cents end to end -- floats and money
// do not mix. Safe to import from both server and client code (no secrets here).

export const CARD_PCT = 0.029; // Stripe card: 2.9% + 30c
export const CARD_FLAT = 30;
export const ACH_PCT = 0.008; // Stripe ACH bank transfer: 0.8%, capped at $5
export const ACH_CAP = 500;

// The fee to ADD on top of `net` so that, after Stripe takes its cut, the
// ministry is left with `net` cents. This is what "cover the fee" charges.
// Card is grossed up (fee is charged on the fee too); bank is grossed up but
// never exceeds the $5 cap.
export function coverFeeCents(net, method) {
  if (net <= 0) return 0;
  if (method === 'bank') {
    const gross = Math.ceil(net / (1 - ACH_PCT));
    return Math.min(gross - net, ACH_CAP);
  }
  const gross = Math.ceil((net + CARD_FLAT) / (1 - CARD_PCT));
  return gross - net;
}

export function dollars(cents) {
  return `$${((cents ?? 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
