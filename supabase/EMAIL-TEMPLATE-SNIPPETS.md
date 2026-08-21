# Supabase email templates — the paste-in for the button-on-POST fix

Where: **Supabase dashboard → Authentication → Emails (templates)**.
Two templates change. Deploy the site first (so `/auth/confirm/` exists), then paste these.
While you're in the dashboard: **Authentication → Providers → Email → "Email OTP Expiration" → 86400** raises the link lifetime to 24 hours.

The only functional change in each template is the link target: it now points at
`/auth/confirm/` (a page with a button) instead of performing the confirmation
itself. The extra wording also helps deliverability — the current one-line,
one-link emails are close to a textbook spam profile.

---

## 1 · "Confirm sign up" template

```html
<h2>Welcome to Luke 14 Ministries</h2>

<p>This email address was used to create a family account on the
Luke&nbsp;14&nbsp;Ministries registration site. To finish setting it up,
confirm that this address is yours:</p>

<p><a href="{{ .SiteURL }}/auth/confirm/?token_hash={{ .TokenHash }}&type=email&redirect_to={{ .RedirectTo }}">Confirm my email address</a></p>

<p>The link opens a page with a single button — your address is only
confirmed when you click it there.</p>

<p>If you didn't create this account, you can safely ignore this email —
nothing happens without the click, and the link expires on its own.</p>

<p>— Luke 14 Ministries<br>
registration@luke14ministries.net</p>
```

## 2 · "Reset password" template

```html
<h2>Reset your password</h2>

<p>A password reset was requested for your Luke&nbsp;14&nbsp;Ministries
account. To choose a new password:</p>

<p><a href="{{ .SiteURL }}/auth/confirm/?token_hash={{ .TokenHash }}&type=recovery&redirect_to={{ .RedirectTo }}">Continue to password reset</a></p>

<p>If you didn't request this, ignore this email — your password is
unchanged and the link expires on its own.</p>

<p>— Luke 14 Ministries<br>
registration@luke14ministries.net</p>
```

---

## Why these exact pieces

- `{{ .TokenHash }}` puts the one-time token in the URL **without** consuming
  it — consumption only happens when the button's form POSTs to the server.
- `type=email` / `type=recovery` tells the page which button copy to show and
  which verification type to submit.
- `{{ .RedirectTo }}` carries the signup form's onward destination
  (e.g. `?next=/register/family/`) so a family that started registering lands
  back in the registration wizard, not on a generic dashboard.
- `{{ .SiteURL }}` is the Site URL from Authentication → URL Configuration, so
  the same template keeps working when the domain changes at launch.
- Do **not** use `{{ .ConfirmationURL }}` in these templates — that is the old
  self-confirming link, and using it reintroduces the scanner problem.

## After pasting — the test that proves it

1. Sign up with a fresh address on **one device**.
2. Open the email on a **different device** — see the button page.
3. Click the button **once** — should land signed in.
4. Click the emailed link again — the button page still renders; pressing the
   button again should bounce to "That link didn't work" (already used), which
   is correct.

Old emails sent before this change still use the previous `/auth/callback/`
links, which keep working — nothing to clean up.
