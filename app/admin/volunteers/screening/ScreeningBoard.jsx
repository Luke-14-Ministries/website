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
          Export the reports from Checkr and paste the file here. Batches sent from this
          screen match on the address we invited, so somebody who changes their email in
          between still matches. Checks ordered by hand at Checkr carry the{' '}
          <em>orderer&rsquo;s</em> address instead, so those match on name — and the preview
          says which rows did that before anything is written.
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
                {preview.willClear != null && (
                  <span className="font-normal text-neutral-600">
                    {' '}· {preview.willClear} would be marked cleared
                  </span>
                )}
                {preview.willCreate > 0 && (
                  <span className="font-normal text-neutral-600">
                    {' '}· {preview.willCreate} would start a new screening record
                  </span>
                )}
              </p>
              {/* The arithmetic has to close. "Matched 2, applied 1" with no
                  explanation is exactly the kind of quiet gap that makes
                  somebody stop trusting the screen. */}
              {/* A verdict word this importer has never seen is filed as
                  "needs a person to look", which is the safe direction --
                  but silently absorbing a word we do not understand is how a
                  future Checkr change gets missed. Say it. */}
              {preview.unrecognised?.length > 0 && (
                <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  Checkr used {preview.unrecognised.length === 1 ? 'a verdict' : 'verdicts'} this
                  screen has not seen before —{' '}
                  <strong>{preview.unrecognised.join(', ')}</strong>. Those rows are being treated
                  as <strong>needing review</strong>, so nobody is cleared on a word we cannot
                  read. Worth telling whoever maintains the site.
                </p>
              )}
              {preview.superseded > 0 && (
                <p className="mt-1 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">
                  <strong>{preview.superseded}</strong>{' '}
                  {preview.superseded === 1 ? 'row is' : 'rows are'} an{' '}
                  <strong>older report</strong> for somebody who also has a newer one in this
                  file. Checkr keeps every report, so a re-check appears twice. Only the most
                  recent completed report counts — including when the older one is the kinder
                  of the two.
                </p>
              )}
              {preview.byName > 0 && (
                <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  <strong>{preview.byName}</strong> matched on <strong>name</strong>, not on the
                  address we sent. Checkr&rsquo;s export carries whoever ordered the check in the
                  email column, so anything ordered by hand can only be matched by name — read
                  those rows before applying.
                </p>
              )}
              <ul className="mt-1 space-y-0.5 text-neutral-700">
                {preview.matched.map((m, i) => (
                  <li key={i} className={m.superseded ? 'text-neutral-400' : undefined}>
                    {m.name} —{' '}
                    <span
                      className={
                        m.superseded
                          ? 'line-through'
                          : m.cleared
                            ? 'text-green-800'
                            : 'text-red-800 font-semibold'
                      }
                    >
                      {m.verdict}
                    </span>
                    {m.completedOn && (
                      <span className="text-xs text-neutral-500"> · {m.completedOn}</span>
                    )}
                    {m.superseded && (
                      <span className="ml-1 rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-700">
                        superseded by a newer report
                      </span>
                    )}
                    {m.reportState && m.reportState !== 'complete' && (
                      <span className="text-neutral-500"> · report {m.reportState}</span>
                    )}
                    {/* Every search that did not come back clear, named. An
                        overall "consider" does not say which one, and the
                        ministry wants all of them -- sexual offences first,
                        but drink-driving or possession too, because those are
                        things they may want to talk to somebody about. */}
                    {m.flagged?.length > 0 && (
                      <span
                        className={`block pl-4 text-xs ${m.superseded ? 'text-neutral-400' : 'text-red-800'}`}
                      >
                        {m.flagged.join(' · ')}
                      </span>
                    )}
                    {!m.superseded && m.flagged?.length === 0 && m.sexOffender === 'clear' && (
                      <span className="block pl-4 text-xs text-neutral-500">
                        all searches clear
                      </span>
                    )}
                    {m.how === 'name' && (
                      <span className="ml-1 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        by name
                      </span>
                    )}
                    {!m.cleared && !m.superseded && ' · left for a person to look at'}
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
                  {preview.unmatched.map((m, i) => (
                    <li key={i}>
                      {m.name} <span className="text-xs">({m.email})</span> — {m.why}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-neutral-500">
              Only a <strong>finished</strong> report with a <strong>clear</strong> assessment
              marks somebody cleared. Checkr&rsquo;s “Status” column says whether the report
              finished, not what it found — a report that came back “consider” still reads
              “complete” there. Anything that is not a clear verdict is left alone for a person
              to decide. Software must not adjudicate a background check.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
