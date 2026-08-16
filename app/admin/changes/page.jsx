import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import ChangesList from './ChangesList';

export const metadata = { title: 'Recent Changes — Staff Admin' };

const fmtWhen = (ts) =>
  ts
    ? new Date(ts).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

// Tracked changes: every edit a FAMILY makes (Manage Household, wizard
// resubmits) is logged field-by-field by database triggers (migration 0013).
// Staff review here without confirmed statuses being disturbed. Support/
// medical change rows are RLS-hidden from staff without the sensitive grant.
//
// Names are looked up in separate simple queries (not nested joins): the log
// table has two links to profiles, and a failed join must never silently
// blank this page. Any query error is shown, not swallowed.
export default async function RecentChangesPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/changes/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('family_change_log')
    .select(
      'id, household_id, person_id, actor_profile_id, source_table, field, old_value, new_value, changed_at'
    )
    .is('reviewed_at', null)
    .order('changed_at', { ascending: false })
    .limit(500);

  const list = rows ?? [];

  // Look up display names for the households, people and actors involved.
  const householdIds = [...new Set(list.map((r) => r.household_id).filter(Boolean))];
  const personIds = [...new Set(list.map((r) => r.person_id).filter(Boolean))];
  const actorIds = [...new Set(list.map((r) => r.actor_profile_id).filter(Boolean))];

  const [{ data: households }, { data: people }, { data: actors }] = await Promise.all([
    householdIds.length
      ? supabase.from('households').select('id, display_name').in('id', householdIds)
      : Promise.resolve({ data: [] }),
    personIds.length
      ? supabase.from('people').select('id, first_name, last_name').in('id', personIds)
      : Promise.resolve({ data: [] }),
    actorIds.length
      ? supabase.from('profiles').select('id, first_name, last_name').in('id', actorIds)
      : Promise.resolve({ data: [] }),
  ]);

  const householdName = new Map((households ?? []).map((h) => [h.id, h.display_name]));
  const personName = new Map(
    (people ?? []).map((p) => [p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()])
  );
  const actorName = new Map(
    (actors ?? []).map((p) => [p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()])
  );

  const byHousehold = new Map();
  for (const r of list) {
    const key = r.household_id ?? 'unknown';
    if (!byHousehold.has(key)) {
      byHousehold.set(key, {
        householdId: key,
        household: householdName.get(r.household_id) ?? '(household removed)',
        changes: [],
      });
    }
    byHousehold.get(key).changes.push({
      id: r.id,
      source: r.source_table,
      field: r.field,
      oldValue: r.old_value,
      newValue: r.new_value,
      when: fmtWhen(r.changed_at),
      person: r.person_id ? personName.get(r.person_id) ?? '' : '',
      actor: r.actor_profile_id ? actorName.get(r.actor_profile_id) ?? '' : '',
    });
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Recent Changes</h2>
      <p className="text-sm text-neutral-500 mb-6">
        Every edit a family makes to their own information, shown old → new. Reviewing here
        doesn&rsquo;t change anyone&rsquo;s status — it just confirms staff have seen it. New
        people added to a registration appear in the &ldquo;Needs review&rdquo; queue on the
        Overview instead.
      </p>

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load the change log: {error.message}
        </p>
      )}

      <ChangesList groups={[...byHousehold.values()]} />
    </div>
  );
}
