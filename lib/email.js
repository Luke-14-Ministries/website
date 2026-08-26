// Transactional email, sent through Resend's HTTP API.
//
// Plain fetch, no SDK: one endpoint, one POST, and a dependency the project
// does not carry cannot break it. The key lives in RESEND_API_KEY -- server
// only, never NEXT_PUBLIC_, set in Vercel's env settings and .env.local.
//
// Every send here is FIRE-AND-TOLERATE: an email is a courtesy attached to an
// action that already succeeded, and a mail-provider hiccup must never turn a
// saved registration into an error screen. Callers get back {ok} and may log
// it; they must not throw on it.
//
// Sent as camp@ -- a real, monitored M365 mailbox, so a family hitting Reply
// on their confirmation reaches an actual person. It was registration@, which
// did not exist in M365, so replies to it bounced -- which is why the Stripe
// receipts moved to camp@ on 25 Aug.
//
// It is registration@ again from 26 Aug, deliberately. The address is being
// created in M365 as a forwarding list into the info@ shared mailbox, so
// replies reach a person who reads them. Sending is unaffected either way:
// Resend signs for the whole verified domain, and a From address does not
// need a mailbox behind it. The mailbox only ever mattered for replies, and
// now there is one.
//
// Keeping registration@ is also the better name for what this is. A family
// looking at their inbox six months later can tell a registration
// confirmation from a payment receipt (camp@) and a donation receipt
// (giving@) without opening any of them.
//
// ONE THING TO WATCH: an M365 distribution list rejects external senders by
// default in some tenants. If that is left on, a family's reply bounces
// exactly as it did before, and nothing on our side would show it.

const FROM = 'Luke 14 Ministries <registration@luke14ministries.net>';

export async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Not configured (local dev, or the key not yet added in Vercel): say so
    // in the server log and carry on. The registration itself already saved.
    console.warn('sendEmail: RESEND_API_KEY not set — email not sent:', subject);
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) {
      console.error('sendEmail failed:', res.status, await res.text());
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error('sendEmail error:', err?.message);
    return { ok: false };
  }
}

// The shared shell: logo banner on white over a body card, table-based and
// inline-styled because email clients ignore stylesheets. Modeled on the
// CampSite confirmation families already receive, in the site's own palette.
export function emailShell({ origin, title, bodyHtml, buttonText, buttonHref }) {
  const logo = `${origin}/images/Luke_14_Ministries_Logo__285_x_2_in_29.png`;
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f5f5f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:#ffffff;border-radius:8px 8px 0 0;padding:24px;text-align:center;">
            <img src="${logo}" alt="Luke 14 Ministries" width="220" style="display:inline-block;max-width:220px;height:auto;" />
          </td>
        </tr>
        <tr>
          <td style="background:#14544A;padding:32px 32px 28px;border-radius:0 0 8px 8px;color:#ffffff;font-family:Helvetica,Arial,sans-serif;">
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${title}</h1>
            <div style="font-size:15px;line-height:1.6;color:#e7efed;">${bodyHtml}</div>
            ${
              buttonText
                ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 0;"><tr><td style="border-radius:6px;background:#F7B32B;">
                     <a href="${buttonHref}" style="display:inline-block;padding:13px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#1a1a1a;text-decoration:none;">${buttonText}</a>
                   </td></tr></table>`
                : ''
            }
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#a3a3a3;line-height:1.5;">
            Luke 14 Ministries · 2348 W Andrew Johnson Hwy, #140, Morristown, TN 37814<br/>
            Questions? Reply to this email or write to camp@luke14ministries.net.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// The registration confirmation. `saved` and `eventName` come from the submit
// action; the amounts stay OUT of this email on purpose -- balances change
// (scholarships, deposits, edits), and a stale number in an inbox outranks a
// correct one on the dashboard in every argument a family will ever have
// with it. The dashboard is the number; the email points there.
export function registrationConfirmationEmail({ origin, eventName, saved, isUpdate }) {
  const title = isUpdate ? 'Your registration has been updated' : 'Your registration is in!';
  const bodyHtml = `
    <p style="margin:0 0 12px;">
      Thank you! We ${isUpdate ? 'saved your changes' : 'received your registration'} for
      <strong style="color:#ffffff;">${eventName}</strong>
      — ${saved} ${saved === 1 ? 'person' : 'people'} in all.
      Camp staff will review it and follow up if anything needs attention.
    </p>
    <p style="margin:0 0 12px;">
      <strong style="color:#ffffff;">One more thing before camp:</strong> each person
      attending has a short details form — allergies, medications, support needs, and an
      emergency contact. You'll find a link for each of them on your dashboard, along with
      your balance and payment options.
    </p>`;
  return {
    subject: isUpdate
      ? `Registration updated — ${eventName}`
      : `Registration received — ${eventName}`,
    html: emailShell({
      origin,
      title,
      bodyHtml,
      buttonText: 'Go to My Dashboard',
      buttonHref: `${origin}/account/dashboard/`,
    }),
  };
}
