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
export default async function RecentChangesPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/changes/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('family_change_log')
    .select(
      `id, household_id, source_table, field, old_value, new_value, changed_at,
       households ( display_name ),
       people ( first_name, last_name ),
       actor:profiles!family_change_log_actor_profile_id_fkey ( first_name, last_name )`
    )
    .is('reviewed_at', null)
    .order('changed_at', { ascending: false })
    .limit(500);

  const byHousehold = new Map();
  for (const r of rows ?? []) {
    const key = r.household_id ?? 'unknown';
    if (!byHousehold.has(key)) {
      byHousehold.set(key, {
        householdId: key,
        household: r.households?.display_name ?? '(household removed)',
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
      person: r.people ? `${r.people.first_name ?? ''} ${r.people.last_name ?? ''}`.trim() : '',
      actor: r.actor ? `${r.actor.first_name ?? ''} ${r.actor.last_name ?? ''}`.trim() : '',
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

      <ChangesList groups={[...byHousehold.values()]} />
    </div>
  );
}
