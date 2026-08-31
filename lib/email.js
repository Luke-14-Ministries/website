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
// It is registration@ again from 26 Aug, and the address is real: an ALIAS on
// the ministry's one M365 shared mailbox, with several staff on it. Replies now
// reach people who read them.
//
// CORRECTED 31 Aug 2026, from the M365 admin centre rather than from memory.
// This comment said the mailbox was information@ and that info@ was one of its
// aliases. It is the other way round: the mailbox's PRIMARY address is
// info@luke14ministries.net, and information@, camp@, registration@ (and a
// leftover test2@) are aliases on it. lib/site.js had it right all along, so
// the two files contradicted each other for four days.
//
// The practical consequence, and why it is worth more than a comment fix:
// info@ is the address to publish -- it is what the Contact Us page shows and
// what the contact form delivers to. Anything that started using information@
// on the strength of this comment should move back.
//
// Sending never depended on any of that. Resend signs for the whole verified
// domain and sends AS registration@ whether or not a mailbox exists behind it.
// The mailbox only ever mattered for replies -- and now there is one.
//
// One consequence of it being an alias rather than its own mailbox: M365
// RECEIVES on an alias but REPLIES from the mailbox's primary address. So a
// family who writes to registration@ gets an answer from info@ unless the
// sender is switched by hand. Harmless, and better than the bounce it
// replaced, but it is why they will not always match.
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

// `from` and `replyTo` are optional and both default to nothing surprising.
//
// replyTo earns its place on the contact form: that message is written by a
// member of the public, and the useful thing for staff is that Reply goes back
// to THEM rather than to the ministry's own registration address. Without it,
// answering a contact message means copying an address out of the body by hand,
// which is the sort of small friction that turns into "we never replied".
export async function sendEmail({ to, subject, html, from, replyTo }) {
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
      body: JSON.stringify({
        from: from || FROM,
        to,
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
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
            Questions? Reply to this email or write to registration@luke14ministries.net.
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
export function registrationConfirmationEmail({
  origin,
  eventName,
  saved,
  isUpdate,
  // 0 (or missing) means this event asks for no deposit, and the paragraph
  // below is left out entirely rather than talking vaguely about "payment
  // options" on an event that has none.
  //
  // depositCents is the TOTAL for this registration; depositPerPersonCents is
  // the per-head figure it was built from, so the email can show the
  // arithmetic when more than one person is on it. A family of two who reads
  // "$100" with no explanation reasonably wonders where the number came from.
  depositCents = 0,
  depositPerPersonCents = 0,
}) {
  const title = isUpdate ? 'Your registration has been updated' : 'Your registration is in!';

  // The deposit gets a paragraph of its own. It used to be four words at the
  // end of a sentence about medical forms -- "along with your balance and
  // payment options" -- which buried the only time-sensitive thing in the
  // email (26 Aug). A details form can wait until spring; the deposit is what
  // holds the place, and a family who does not know that can lose one while
  // believing they are registered.
  //
  // The offer of help sits in the same paragraph, deliberately. This is the
  // first moment the family sees a real amount attached to their own name,
  // and it is the moment someone decides quietly that they cannot afford to
  // come. The wizard says the same thing at the same moment for the same
  // reason.
  //
  // ⚠ REVISIT AFTER THE DEPOSIT DECISION (Decisions doc, question 9).
  // This wording assumes what is true today: the deposit holds a place and can
  // be paid afterwards, and a registration reaches staff either way. If the
  // deposit becomes REQUIRED before a registration can be submitted, this
  // paragraph is wrong -- it would be describing an optional step that has
  // already blocked them -- and so is the matching line at the foot of the
  // registration wizard. Both change together, and the form has to say it
  // first: learning about a gate from a confirmation email means it was not a
  // gate you could plan for.
  const deposit = depositCents > 0
    ? `
    <p style="margin:0 0 12px;">
      <strong style="color:#ffffff;">Holding your place:</strong> a
      $${(depositCents / 100).toFixed(2)} deposit secures your ${saved === 1 ? 'spot' : 'spots'}${
        saved > 1 && depositPerPersonCents > 0
          ? ` (that is $${(depositPerPersonCents / 100).toFixed(2)} for each of the ${saved} people on this registration)`
          : ''
      }, and you can pay it on your dashboard whenever you're ready. If the fee is difficult, &ldquo;Request help
      with the fee&rdquo; is on the same page.
    </p>`
    : '';

  const bodyHtml = `
    <p style="margin:0 0 12px;">
      Thank you! We ${isUpdate ? 'saved your changes' : 'received your registration'} for
      <strong style="color:#ffffff;">${eventName}</strong>
      — ${saved} ${saved === 1 ? 'person' : 'people'} in all.
      Camp staff will review it and follow up if anything needs attention.
    </p>${deposit}
    <p style="margin:0 0 12px;">
      <strong style="color:#ffffff;">One more thing before camp:</strong> each person
      attending has a short details form — allergies, medications, support needs, and an
      emergency contact. You'll find a link for each of them on your dashboard.
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

// The contact-form notification, sent to the ministry's own shared mailbox.
//
// Deliberately NOT wrapped in emailShell(). That shell exists to reassure a
// family that a message is really from Luke 14 Ministries -- logo, colours, the
// address block. This email travels from the ministry to itself, so all of that
// is noise wrapped around the only thing that matters, which is what a stranger
// took the trouble to type. Staff need it legible and quotable, not branded.
//
// Everything from the form is escaped. It is the one place on this site where
// text written by an unauthenticated member of the public is put into an HTML
// document, and an email client is a browser.
export function contactMessageEmail({ name, email, subject, message }) {
  const esc = (v) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // Newlines survive as line breaks; the paragraph someone wrote should still
  // read as paragraphs on the other end.
  const bodyText = esc(message).replace(/\r?\n/g, '<br/>');

  return {
    subject: `Website contact: ${subject || '(no subject)'}`,
    html: `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f5f5f4;font-family:Helvetica,Arial,sans-serif;color:#1b2427;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #dbe6e8;border-radius:8px;">
    <tr><td style="padding:20px 24px;border-bottom:1px solid #eaf1f2;">
      <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#5b6a6f;">Message from the website contact form</p>
      <p style="margin:6px 0 0;font-size:18px;font-weight:bold;color:#14544A;">${esc(subject) || '(no subject)'}</p>
    </td></tr>
    <tr><td style="padding:16px 24px;font-size:14px;line-height:1.6;">
      <p style="margin:0 0 4px;"><strong>From:</strong> ${esc(name)}</p>
      <p style="margin:0;"><strong>Email:</strong> <a href="mailto:${esc(email)}" style="color:#14606a;">${esc(email)}</a></p>
    </td></tr>
    <tr><td style="padding:4px 24px 22px;">
      <div style="border-left:3px solid #14606a;padding:2px 0 2px 14px;font-size:15px;line-height:1.65;white-space:normal;">${bodyText}</div>
    </td></tr>
    <tr><td style="padding:14px 24px;border-top:1px solid #eaf1f2;font-size:12px;color:#5b6a6f;line-height:1.5;">
      Hit Reply to answer ${esc(name)} directly — this email is set to reply to their address, not to the ministry's.
    </td></tr>
  </table>
</body>
</html>`,
  };
}
