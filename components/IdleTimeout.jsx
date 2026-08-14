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
    lastActivity.current = Date.now();
    const now = Date.now();
    if (channelRef.current && now - lastBroadcast.current > 4000) {
      lastBroadcast.current = now;
      channelRef.current.postMessage({ type: 'activity', t: now });
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
      setIdleLimit(isStaff ? STAFF_IDLE : FAMILY_IDLE);
      lastActivity.current = Date.now();
      setEnabled(true);
    }
    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        setEnabled(false);
        setWarning(false);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        init();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

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
        lastActivity.current = Date.now();
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

  function stay() {
    lastActivity.current = Date.now();
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
