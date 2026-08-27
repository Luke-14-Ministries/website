'use client';

// The bulk-screening screen. Three things, in the order they happen:
// who is due, send the batch, bring the results back.

import { useMemo, useState, useTransition } from 'react';
import { markBatchOrdered, importCheckrResults } from './actions';

const money = (n) => `$${n.toFixed(2)}`;
const PER_CHECK = 26.5; // Basic Plus $25.49 plus the passthrough fees actually invoiced.

const STATUS_PILL = {
  clear: ['Cleared', 'bg-green-100 text-green-800'],
  invited: ['Invited — waiting', 'bg-amber-100 text-amber-800'],
  pending: ['Running at Checkr', 'bg-amber-100 text-amber-800'],
  consider: ['Needs review', 'bg-red-100 text-red-800'],
  suspended: ['Checkr needs more from them', 'bg-amber-100 text-amber-800'],
  dispute: ['Disputed', 'bg-red-100 text-red-800'],
  canceled: ['Cancelled', 'bg-neutral-200 text-neutral-600'],
  not_started: ['Never checked', 'bg-neutral-200 text-neutral-700'],
};

export default function ScreeningBoard({ candidates }) {
  const [picked, setPicked] = useState(() => new Set());
  const [busy, start] = useTransition();
  const [result, setResult] = useState(null);
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState(null);

  // Anyone the site cannot order is shown but cannot be selected. Hiding them
  // would be worse: "why is Sarah not on the list" is a question with an
  // answer, and the answer is a missing field somebody can go and fill in.
  const orderable = useMemo(
    () => candidates.filter((c) => !c.blockedBecause),
    [candidates]
  );
  const blocked = useMemo(
    () => candidates.filter((c) => c.blockedBecause),
    [candidates]
  );

  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const allPicked = orderable.length > 0 && picked.size === orderable.length;

  function orderBatch() {
    setResult(null);
    start(async () => {
      const batch = new Date().toISOString();
      const r = await markBatchOrdered([...picked], batch, 'volunteer');
      setResult(r);
      if (r.ok && r.csv) {
        // Handed straight to the browser. The file never goes near a server
        // we control, which is the point: it holds email addresses.
        const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = r.filename;
        a.click();
        URL.revokeObjectURL(url);
        setPicked(new Set());
      }
    });
  }

  function doPreview() {
    setPreview(null);
    start(async () => setPreview(await importCheckrResults(csvText, { dryRun: true })));
  }

  function doImport() {
    start(async () => {
      const r = await importCheckrResults(csvText, { dryRun: false });
      setPreview(r);
      if (r.ok) setCsvText('');
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">1 · Who is due</h2>
        <p className="mt-1 mb-4 max-w-prose text-sm text-neutral-500">
          Adult volunteers with no check on file, or whose check has expired.
          Nothing here has been ordered yet and nothing is charged until you
          upload the file to Checkr.
        </p>

        {orderable.length === 0 ? (
          <p className="rounded border border-green-200 bg-green-50 px-4 py-3 text-green-900">
            Nobody is due. Every adult volunteer has a check on file that is still in date.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  setPicked(allPicked ? new Set() : new Set(orderable.map((c) => c.personId)))
                }
                className="btn-outline !py-1.5 text-sm"
              >
                {allPicked ? 'Select none' : `Select all ${orderable.length}`}
              </button>
              <span className="text-sm text-neutral-600">
                {picked.size} selected
                {picked.size > 0 && (
                  <>
                    {' '}· about <strong>{money(picked.size * PER_CHECK)}</strong> at Basic Plus
                  </>
                )}
              </span>
            </div>

            <ul className="divide-y divide-neutral-100 border-y border-neutral-100">
              {orderable.map((c) => (
                <li key={c.personId} className="flex flex-wrap items-center gap-3 py-2.5">
                  <input
                    type="checkbox"
                    id={`p-${c.personId}`}
                    checked={picked.has(c.personId)}
                    onChange={() => toggle(c.personId)}
                    className="h-4 w-4"
                  />
                  <label htmlFor={`p-${c.personId}`} className="flex-1 min-w-0">
                    <span className="font-semibold">{c.name}</span>
                    <span className="text-neutral-500"> · {c.email}</span>
                    <span className="block text-xs text-neutral-500">
                      {c.eventName}
                      {c.reason ? ` — ${c.reason}` : ''}
                    </span>
                  </label>
                  {(() => {
                    const [label, cls] = STATUS_PILL[c.status] ?? STATUS_PILL.not_started;
                    return (
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
                        {label}
                      </span>
                    );
                  })()}
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={orderBatch}
              disabled={busy || picked.size === 0}
              className="btn-primary mt-4 disabled:opacity-50"
            >
              {busy ? 'Working…' : `Download CSV for ${picked.size} and mark as sent`}
            </button>
            <p className="mt-1.5 text-xs text-neutral-500">
              One button on purpose. Downloading the file and recording that it went
              out are the same act — otherwise the next batch invites these people
              again, at about {money(PER_CHECK)} each.
            </p>
          </>
        )}

        {blocked.length > 0 && (
          <div className="mt-5 rounded border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="font-semibold text-amber-900">
              {blocked.length} {blocked.length === 1 ? 'person cannot' : 'people cannot'} be ordered yet
            </p>
            <ul className="mt-1.5 space-y-1 text-sm text-amber-900">
              {blocked.map((c) => (
                <li key={c.personId}>
                  <strong>{c.name}</strong> — {c.blockedBecause}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">2 · Upload it to Checkr</h2>
        <ol className="mt-2 max-w-prose list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>
            Open{' '}
            <a
              href="https://dashboard.checkr.com/order-background-check"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              Order background check
            </a>{' '}
            at Checkr and choose the bulk option.
          </li>
          <li>Upload the file you just downloaded and pick the <strong>Basic Plus</strong> package.</li>
          <li>
            Checkr emails each person a link. They type their own Social Security
            number into <em>Checkr&rsquo;s</em> form — it never reaches us, which is the
            whole reason this is done by invitation rather than on paper.
          </li>
        </ol>
        {result?.ok && (
          <p className="mt-3 rounded border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-900">
            {result.ordered} recorded as sent. The file is in your downloads.
          </p>
        )}
        {result && !result.ok && (
          <p className="mt-3 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
            {result.error}
          </p>
        )}
        {result?.skipped?.length > 0 && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <p className="font-semibold">Left out of the file:</p>
            <ul className="mt-1 space-y-0.5">
              {result.skipped.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">3 · Bring the results back</h2>
        <p className="mt-1 mb-3 max-w-prose text-sm text-neutral-500">
          Export the reports from Checkr and paste the file here. Matching is on the
          email address we sent, not the one on file today — so somebody who changes
          their address between ordering and result still matches.
        </p>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={5}
          placeholder="Paste the whole CSV, heading row and all"
          className="w-full rounded border border-neutral-300 px-3 py-2 font-mono text-xs"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={doPreview}
            disabled={busy || !csvText.trim()}
            className="btn-outline !py-2 disabled:opacity-50"
          >
            Check the file first
          </button>
          {preview?.ok && preview.dryRun && preview.willUpdate > 0 && (
            <button type="button" onClick={doImport} disabled={busy} className="btn-primary !py-2">
              Apply {preview.willUpdate} {preview.willUpdate === 1 ? 'result' : 'results'}
            </button>
          )}
        </div>

        {preview && !preview.ok && (
          <p className="mt-3 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
            {preview.error}
          </p>
        )}

        {preview?.ok && (
          <div className="mt-4 space-y-3 text-sm">
            {!preview.dryRun && (
              <p className="rounded border border-green-200 bg-green-50 px-4 py-2 text-green-900">
                {preview.updated} updated.
              </p>
            )}
            <div>
              <p className="font-semibold">
                Matched {preview.matched.length}
                {preview.dryRun ? ' — nothing written yet' : ''}
              </p>
              <ul className="mt-1 space-y-0.5 text-neutral-700">
                {preview.matched.map((m, i) => (
                  <li key={i}>
                    {m.email} —{' '}
                    <span className={m.cleared ? 'text-green-800' : 'text-red-800 font-semibold'}>
                      {m.status || 'no status in file'}
                    </span>
                    {!m.cleared && ' · left for a person to look at'}
                  </li>
                ))}
              </ul>
            </div>
            {preview.unmatched.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-amber-900">
                <p className="font-semibold">{preview.unmatched.length} row(s) matched nobody</p>
                <p className="mt-0.5 text-xs">
                  Usually somebody ordered before this screen existed. Listed so a short
                  import is visible rather than silent.
                </p>
                <ul className="mt-1 space-y-0.5">
                  {preview.unmatched.map((m, i) => <li key={i}>{m.email}</li>)}
                </ul>
              </div>
            )}
            <p className="text-xs text-neutral-500">
              Only a clear result marks somebody cleared. Anything else — “consider”, a
              dispute, a blank — is left alone for a person to decide. Software must not
              adjudicate a background check.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
