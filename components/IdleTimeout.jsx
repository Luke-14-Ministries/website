'use client';

// Idle auto-logout. For a site that holds medical and support information, a
// browser left open on a shared or office computer is a real exposure -- this
// closes it by signing the session out after a period of no activity, with a
// warning first.
//
// Policy (tiered): staff, who can see every family's records, time out sooner
// than families, who only ever see their own. A two-minute warning with a
// "Stay signed in" button comes first, so nobody loses half-typed work without
// a chance to keep going.
//
// This is a convenience control, not the security boundary -- row-level
// security and two-factor are that. It reduces the "walked away from the desk"
// risk, which those do not.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

const MIN = 60 * 1000;
const WARN_MS = 2 * MIN; // how long the warning shows before logout
const STAFF_IDLE = 15 * MIN;
const FAMILY_IDLE = 30 * MIN;

// Passive signals that someone is still at the keyboard. mousemove is throttled
// hard below so it does not become a busy loop.
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

// WHY THE LAST-ACTIVITY TIME IS WRITTEN TO STORAGE -- do not remove.
//
// Reported 24 Aug 2026: a phone opened on yesterday's session was still signed
// in. The reason was that idleness was measured entirely by a live clock in
// memory. `lastActivity` was a React ref and the check ran in a setInterval, so
// the moment the tab closed -- or the phone locked, or the browser froze a
// background tab, which mobile browsers do aggressively -- the clock simply
// stopped. On reopening, the component started fresh and stamped "last active:
// now", and the eighteen hours in between were invisible. Supabase had
// meanwhile kept the session alive and refreshed it, exactly as configured.
//
// So the control only ever worked for a tab left open. The case it was written
// for -- someone walks away and comes back later, or somebody else picks up the
// device -- was the case it missed.
//
// Persisting the timestamp fixes it: elapsed real time is compared on every
// load, on tab focus, and on restore from the back/forward cache. Note the
// consequence, which is intended rather than a side effect: returning to the
// site after the idle window now signs you out, because there is no way to tell
// the person who walked away from the person who picked up their phone.
const LAST_KEY = 'l14_last_activity';

function readLastActivity(userId) {
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.t !== 'number') return null;
    // A stamp belonging to a different account is not evidence about this one.
    if (userId && v.u && v.u !== userId) return null;
    return v.t;
  } catch {
    return null;
  }
}

function writeLastActivity(userId, t) {
  try {
    window.localStorage.setItem(LAST_KEY, JSON.stringify({ u: userId, t }));
  } catch {
    /* private mode, storage full, storage disabled -- the in-memory clock
       still works for an open tab, which is where we were before. */
  }
}

export default function IdleTimeout() {
  const supabase = createClient();

  const [enabled, setEnabled] = useState(false);
  const [idleLimit, setIdleLimit] = useState(FAMILY_IDLE);
  const [warning, setWarning] = useState(false);
  const [remaining, setRemaining] = useState(WARN_MS);

  const lastActivity = useRef(Date.now());
  const warningRef = useRef(false);
  const channelRef = useRef(null);
  const lastBroadcast = useRef(0);
  const userIdRef = useRef(null);
  const idleLimitRef = useRef(FAMILY_IDLE);

  useEffect(() => {
    idleLimitRef.current = idleLimit;
  }, [idleLimit]);

  useEffect(() => {
    warningRef.current = warning;
  }, [warning]);

  // Sign out THIS browser only (scope: 'local') -- an idle desktop should not
  // knock the same person off their phone. Then hand them to the login page
  // with a note about why.
  const doLogout = useCallback(
    async (broadcast = true) => {
      if (broadcast && channelRef.current) {
        channelRef.current.postMessage({ type: 'logout' });
      }
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        /* even if the network call fails, still leave the page */
      }
      window.location.href = '/account/?timeout=1';
    },
    [supabase]
  );

  // Mark activity now, and tell the other tabs (throttled). Local passive
  // activity is ignored WHILE the warning is up, so a returning person makes a
  // deliberate choice -- but activity arriving from another tab still counts,
  // because it means the person is genuinely still working somewhere.
  const registerLocalActivity = useCallback(() => {
    if (warningRef.current) return;
    const now = Date.now();
    lastActivity.current = now;
    // Throttled: the same 4-second gate covers the cross-tab message and the
    // storage write, so a mousemove does not touch localStorage sixty times a
    // second. Four seconds of staleness is nothing against a 15-minute window,
    // and it means whatever is on disk when a tab dies is close enough.
    if (now - lastBroadcast.current > 4000) {
      lastBroadcast.current = now;
      writeLastActivity(userIdRef.current, now);
      if (channelRef.current) {
        channelRef.current.postMessage({ type: 'activity', t: now });
      }
    }
  }, []);

  // Figure out whether we're logged in and, if so, which tier applies.
  useEffect(() => {
    let active = true;
    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!active) return;
      if (!session?.user) {
        setEnabled(false);
        setWarning(false);
        return;
      }
      const { data: staffRow } = await supabase
        .from('staff')
        .select('role, active')
        .eq('profile_id', session.user.id)
        .maybeSingle();
      if (!active) return;
      const isStaff = Boolean(staffRow && staffRow.active);
      const limit = isStaff ? STAFF_IDLE : FAMILY_IDLE;
      userIdRef.current = session.user.id;

      // THE FIX. Before starting a clock, ask how long it has actually been.
      // A stored stamp older than the limit means this session was idle
      // through a closed tab, a locked phone, or overnight -- so end it now
      // rather than starting a fresh countdown and pretending the gap did not
      // happen.
      const stored = readLastActivity(session.user.id);
      const now = Date.now();
      if (stored != null && now - stored >= limit) {
        doLogout(true);
        return;
      }

      // Keep the stored stamp when there is one: the countdown continues from
      // where the person actually left off, rather than restarting because
      // they loaded a page.
      lastActivity.current = stored ?? now;
      writeLastActivity(session.user.id, lastActivity.current);
      setIdleLimit(limit);
      setEnabled(true);
    }
    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setEnabled(false);
        setWarning(false);
      } else if (event === 'SIGNED_IN') {
        // A fresh login IS activity, and it may be a different person on a
        // shared device — so clear any stamp left by the last one before init
        // reads it, or they would inherit somebody else's countdown.
        if (session?.user?.id) writeLastActivity(session.user.id, Date.now());
        init();
      } else if (event === 'TOKEN_REFRESHED') {
        // NOT activity. A refresh happens on a timer with nobody present, and
        // treating it as presence is how a session lives forever.
        init();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase, doLogout]);

  // Cross-tab coordination: one active tab keeps the others awake, and a logout
  // (manual, timed, or from another tab) ends them all.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('luke14-idle');
    channelRef.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'activity' && typeof msg.t === 'number') {
        lastActivity.current = Math.max(lastActivity.current, msg.t);
        if (warningRef.current) setWarning(false); // someone is active elsewhere
      } else if (msg.type === 'stay') {
        const now = Date.now();
        lastActivity.current = now;
        writeLastActivity(userIdRef.current, now);
        setWarning(false);
      } else if (msg.type === 'logout') {
        doLogout(false);
      }
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [doLogout]);

  // The clock. One interval checks how long it has been since activity and
  // decides: nothing, warn, or log out.
  useEffect(() => {
    if (!enabled) return;

    const onActivity = () => registerLocalActivity();
    ACTIVITY_EVENTS.forEach((ev) =>
      window.addEventListener(ev, onActivity, { passive: true })
    );

    const interval = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= idleLimit) {
        doLogout(true);
      } else if (idle >= idleLimit - WARN_MS) {
        setRemaining(idleLimit - idle);
        setWarning(true);
      } else if (warningRef.current) {
        setWarning(false);
      }
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      clearInterval(interval);
    };
  }, [enabled, idleLimit, registerLocalActivity, doLogout]);

  // Waking up. The interval above only ticks while the page is running, so a
  // phone that was locked for an hour learns nothing from it. These are the
  // three moments a frozen page comes back to life:
  //
  //   visibilitychange -> the tab is looked at again, or the phone unlocks
  //   pageshow         -> restored from the back/forward cache, where the
  //                       component is NOT re-mounted and init never re-runs,
  //                       which is precisely how a stale page slips through
  //   focus            -> the window is returned to on a desktop
  //
  // All three ask the same question of the stored stamp: has too much real
  // time passed?
  useEffect(() => {
    if (!enabled) return;

    const recheck = () => {
      const stored = readLastActivity(userIdRef.current);
      if (stored != null && Date.now() - stored >= idleLimitRef.current) {
        doLogout(true);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [enabled, doLogout]);

  function stay() {
    const now = Date.now();
    lastActivity.current = now;
    writeLastActivity(userIdRef.current, now);
    setWarning(false);
    if (channelRef.current) channelRef.current.postMessage({ type: 'stay' });
  }

  if (!enabled || !warning) return null;

  const secs = Math.max(0, Math.ceil(remaining / 1000));
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-title"
    >
      <div className="w-full max-w-sm rounded-lg bg-white shadow-xl p-6">
        <h2 id="idle-title" className="text-xl font-bold mb-2">
          Are you still there?
        </h2>
        <p className="text-neutral-700">
          For security, you&rsquo;ll be signed out in{' '}
          <strong className="tabular-nums">
            {mm}:{ss}
          </strong>{' '}
          because of inactivity.
        </p>
        <div className="mt-5 flex gap-3">
          <button onClick={stay} className="btn-primary">
            Stay signed in
          </button>
          <button onClick={() => doLogout(true)} className="btn-outline">
            Log out now
          </button>
        </div>
      </div>
    </div>
  );
}
