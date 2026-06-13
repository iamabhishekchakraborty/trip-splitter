import { useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import AuthPanel from './components/AuthPanel';
import HomeView from './components/HomeView';
import InviteAcceptPanel from './components/InviteAcceptPanel';
import GroupHeader from './components/GroupHeader';
import MembersPanel from './components/MembersPanel';
import ExpenseForm from './components/ExpenseForm';
import BalancesPanel from './components/BalancesPanel';
import ExpensesList from './components/ExpensesList';
import GroupAccessPanel from './components/GroupAccessPanel';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import { computeMemberSummary, simplifySettlements } from './lib/balances';
import { downloadExpensesCsv, downloadSummaryCsv, exportTripReportPdf } from './lib/exports';
import {
  addLocalExpense,
  addLocalMember,
  addLocalTrip,
  deleteLocalExpense,
  loadLocalHomeData,
  loadLocalTripData,
  updateLocalExpense
} from './lib/localStore';

function mapMembershipRoles(rows) {
  return Object.fromEntries((rows || []).map((item) => [item.trip_id, item.role]));
}

function fallbackDisplayName(email) {
  if (!email) return 'User';
  const [name] = email.split('@');
  return name || 'User';
}

function isMissingDisplayNameColumnError(errorLike) {
  const message = typeof errorLike === 'string' ? errorLike : errorLike?.message || '';
  return message.includes('column user_profiles.display_name does not exist');
}

function isSchemaCacheFunctionError(errorLike, functionName) {
  const message = typeof errorLike === 'string' ? errorLike : errorLike?.message || '';
  return message.includes('schema cache') && message.includes(functionName);
}

function isSchemaCacheError(errorLike) {
  const message = typeof errorLike === 'string' ? errorLike : errorLike?.message || '';
  return message.includes('schema cache');
}

function isMissingColumnError(errorLike, tableName, columnName) {
  const message = typeof errorLike === 'string' ? errorLike : errorLike?.message || '';
  const one = `column ${tableName}.${columnName} does not exist`;
  const two = `column "${columnName}" of relation "${tableName}" does not exist`;
  return message.includes(one) || message.includes(two);
}

function getSchemaCacheObjectHint(message) {
  const tableMatch = message.match(/table '([^']+)'/i);
  if (tableMatch?.[1]) return `Missing table in API cache: ${tableMatch[1]}.`;

  const functionMatch = message.match(/function ([^ ]+)\(/i);
  if (functionMatch?.[1]) return `Missing function in API cache: ${functionMatch[1]}.`;

  return '';
}

function getFriendlyErrorMessage(errorLike) {
  const message = typeof errorLike === 'string' ? errorLike : errorLike?.message || 'Unexpected error.';

  if (message.includes("Could not find the table 'public.trip_memberships' in the schema cache")) {
    return [
      'Database schema is not updated for this app version.',
      'In Supabase SQL Editor, run the latest `supabase/schema.sql` from this repo, then refresh and try again.'
    ].join(' ');
  }

  if (isMissingDisplayNameColumnError(message)) {
    return [
      'Your database is missing the `display_name` column in `user_profiles`.',
      "Run the latest `supabase/schema.sql`, then run `NOTIFY pgrst, 'reload schema';` and refresh localhost."
    ].join(' ');
  }

  if (message.includes('schema cache')) {
    const hint = getSchemaCacheObjectHint(message);
    return [
      'Supabase schema cache looks stale.',
      hint,
      "In SQL Editor run `NOTIFY pgrst, 'reload schema';`, wait a few seconds, then retry.",
      'If it still fails, re-run latest `supabase/schema.sql` in the same Supabase project configured in your `.env`.'
    ].filter(Boolean).join(' ');
  }

  if (message.toLowerCase().includes('stack depth limit exceeded')) {
    return [
      'Database policy recursion was triggered.',
      'Apply the latest `supabase/schema.sql` from this repo (includes RLS recursion fix), then retry.'
    ].join(' ');
  }

  return message;
}

export default function App() {
  const [trips, setTrips] = useState([]);
  const [selectedTripId, setSelectedTripId] = useState('');
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [groupMemberships, setGroupMemberships] = useState([]);
  const [groupInvites, setGroupInvites] = useState([]);
  const [groupPastInvites, setGroupPastInvites] = useState([]);
  const [membershipByTrip, setMembershipByTrip] = useState({});
  const [session, setSession] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const isLocalMode = !hasSupabaseConfig;
  const isGroupView = Boolean(selectedTripId);

  const currentRole = membershipByTrip[selectedTripId] || '';
  const isAdmin = isLocalMode || currentRole === 'owner' || currentRole === 'admin';
  const isOwner = isLocalMode || currentRole === 'owner';
  const canAddExpenses = isLocalMode || Boolean(currentRole);
  const canCreateTrips = isLocalMode || Boolean(session?.user);

  function clearTripState() {
    setSelectedTripId('');
    setSelectedTrip(null);
    setMembers([]);
    setExpenses([]);
    setGroupMemberships([]);
    setGroupInvites([]);
    setGroupPastInvites([]);
  }

  function buildTripSummaries(tripsData, membersData, expensesData, myMembershipRows) {
    const roleMap = mapMembershipRoles(myMembershipRows);
    return (tripsData || []).map((trip) => {
      const tripMembers = (membersData || []).filter((member) => member.trip_id === trip.id);
      const tripExpenses = (expensesData || []).filter((expense) => expense.trip_id === trip.id);
      const accessRole = roleMap[trip.id] || null;

      return {
        ...trip,
        accessRole,
        memberCount: tripMembers.length,
        expenseCount: tripExpenses.length,
        totalSpent: tripExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
      };
    });
  }

  async function loadHomeData() {
    setLoading(true);
    setError('');
    clearTripState();

    if (isLocalMode) {
      const localData = loadLocalHomeData();
      setTrips(localData.trips.map((trip) => ({ ...trip, accessRole: 'owner' })));
      setMembershipByTrip(Object.fromEntries(localData.trips.map((trip) => [trip.id, 'owner'])));
      setLoading(false);
      return;
    }

    if (!session?.user) {
      setTrips([]);
      setMembershipByTrip({});
      setLoading(false);
      return;
    }

    const [tripsRes, membersRes, expensesRes, membershipsRes] = await Promise.all([
      supabase.from('trips').select('*').order('created_at', { ascending: true }),
      supabase.from('members').select('trip_id'),
      supabase.from('expenses').select('trip_id, amount'),
      supabase.from('trip_memberships').select('trip_id, role').eq('user_id', session.user.id)
    ]);

    const firstError = tripsRes.error || membersRes.error || expensesRes.error;
    if (firstError) {
      setError(getFriendlyErrorMessage(firstError));
      setLoading(false);
      return;
    }

    if (membershipsRes.error && !isSchemaCacheError(membershipsRes.error)) {
      setError(getFriendlyErrorMessage(membershipsRes.error));
      setLoading(false);
      return;
    }

    const membershipMap = mapMembershipRoles(membershipsRes.data || []);
    setMembershipByTrip(membershipMap);
    setTrips(buildTripSummaries(tripsRes.data, membersRes.data, expensesRes.data, membershipsRes.data));

    if (membershipsRes.error && isSchemaCacheError(membershipsRes.error)) {
      setInfo(
        "Group roles are temporarily unavailable due to schema cache lag. Run `NOTIFY pgrst, 'reload schema';` in SQL Editor and refresh."
      );
    }
    setLoading(false);
  }

  async function loadCurrentProfile(activeSession = session) {
    if (isLocalMode || !activeSession?.user?.id) {
      setCurrentProfile(null);
      return;
    }

    let profile = null;
    let profileError = null;

    const profileWithDisplayNameRes = await supabase
      .from('user_profiles')
      .select('user_id, email, display_name')
      .eq('user_id', activeSession.user.id)
      .maybeSingle();

    profile = profileWithDisplayNameRes.data;
    profileError = profileWithDisplayNameRes.error;

    if (profileError && isMissingDisplayNameColumnError(profileError)) {
      const fallbackRes = await supabase
        .from('user_profiles')
        .select('user_id, email')
        .eq('user_id', activeSession.user.id)
        .maybeSingle();

      profile = fallbackRes.data ? { ...fallbackRes.data, display_name: null } : null;
      profileError = fallbackRes.error;
    }

    if (profileError) {
      if (isSchemaCacheError(profileError)) {
        setCurrentProfile({
          user_id: activeSession.user.id,
          email: activeSession.user.email || '',
          display_name: fallbackDisplayName(activeSession.user.email || '')
        });
        setInfo(
          "Profile details are temporarily using email fallback because Supabase schema cache is still refreshing."
        );
        return;
      }

      setError(getFriendlyErrorMessage(profileError));
      return;
    }

    if (!profile) {
      setCurrentProfile({
        user_id: activeSession.user.id,
        email: activeSession.user.email || '',
        display_name: fallbackDisplayName(activeSession.user.email || '')
      });
      return;
    }

    setCurrentProfile({
      ...profile,
      display_name: profile.display_name || fallbackDisplayName(profile.email || activeSession.user.email || '')
    });
  }

  async function loadTripData(tripId, knownTrip) {
    setLoading(true);
    setError('');
    setInfo('');

    if (isLocalMode) {
      const localData = loadLocalTripData(tripId);
      if (!localData.trip) {
        setError('Trip not found.');
        setLoading(false);
        return;
      }

      setSelectedTripId(tripId);
      setSelectedTrip(localData.trip);
      setMembers(localData.members);
      setExpenses(localData.expenses);
      setGroupMemberships([]);
      setGroupInvites([]);
      setLoading(false);
      return;
    }

    if (!session?.user) {
      setError('Sign in to open group details.');
      setLoading(false);
      return;
    }

    let activeTrip = knownTrip || trips.find((trip) => trip.id === tripId);
    if (!activeTrip) {
      const { data: tripData, error: tripError } = await supabase
        .from('trips')
        .select('*')
        .eq('id', tripId)
        .single();

      if (tripError) {
        setError(getFriendlyErrorMessage(tripError));
        setLoading(false);
        return;
      }
      activeTrip = tripData;
    }

    const [membersRes, expensesRes, membershipsRes, invitesRes, pastInvitesRes] = await Promise.all([
      supabase.from('members').select('*').eq('trip_id', tripId).order('created_at', { ascending: true }),
      supabase
        .from('expenses')
        .select('id, description, amount, paid_by, split_type, expense_date, created_at, updated_at')
        .eq('trip_id', tripId)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('trip_memberships').select('trip_id, user_id, role, created_at').eq('trip_id', tripId),
      // Active invites: not used, not expired
      supabase
        .from('trip_invitations')
        .select('id, token, invited_email, role, created_at, expires_at, accepted_at')
        .eq('trip_id', tripId)
        .is('revoked_at', null)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
      // Past invites: used or expired, capped at 5
      supabase
        .from('trip_invitations')
        .select('id, token, invited_email, role, created_at, expires_at, accepted_at')
        .eq('trip_id', tripId)
        .is('revoked_at', null)
        .or(`accepted_at.not.is.null,expires_at.lte.${new Date().toISOString()}`)
        .order('created_at', { ascending: false })
        .limit(5)
    ]);

    const firstError = membersRes.error || expensesRes.error;
    if (firstError) {
      setError(getFriendlyErrorMessage(firstError));
      setLoading(false);
      return;
    }

    if (membershipsRes.error && !isSchemaCacheError(membershipsRes.error)) {
      setError(getFriendlyErrorMessage(membershipsRes.error));
      setLoading(false);
      return;
    }

    if (invitesRes.error && !isSchemaCacheError(invitesRes.error)) {
      setError(getFriendlyErrorMessage(invitesRes.error));
      setLoading(false);
      return;
    }

    if (pastInvitesRes.error && !isSchemaCacheError(pastInvitesRes.error)) {
      setError(getFriendlyErrorMessage(pastInvitesRes.error));
      setLoading(false);
      return;
    }

    const membershipRows = membershipsRes.error ? [] : (membershipsRes.data || []);
    const inviteRows = invitesRes.error ? [] : (invitesRes.data || []);
    const pastInviteRows = pastInvitesRes.error ? [] : (pastInvitesRes.data || []);
    const myMembership = membershipRows.find((item) => item.user_id === session.user.id);
    let effectiveMembers = membersRes.data || [];

    if (!myMembership && !membershipsRes.error) {
      const ensured = await ensureCurrentUserMember(tripId);
      if (!ensured) {
        setLoading(false);
        return;
      }

      const { data: refreshedMembers, error: refreshedMembersError } = await supabase
        .from('members')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true });

      if (refreshedMembersError) {
        setError(getFriendlyErrorMessage(refreshedMembersError));
        setLoading(false);
        return;
      }

      effectiveMembers = refreshedMembers || [];
    }

    const profileIds = [...new Set(membershipRows.map((item) => item.user_id))];
    let profileMap = {};
    if (profileIds.length) {
      let profileRows = [];
      let profileError = null;

      const profileWithDisplayNameRes = await supabase
        .from('user_profiles')
        .select('user_id, email, display_name')
        .in('user_id', profileIds);

      profileRows = profileWithDisplayNameRes.data || [];
      profileError = profileWithDisplayNameRes.error;

      if (profileError && isMissingDisplayNameColumnError(profileError)) {
        const fallbackRes = await supabase
          .from('user_profiles')
          .select('user_id, email')
          .in('user_id', profileIds);

        profileRows = (fallbackRes.data || []).map((item) => ({ ...item, display_name: null }));
        profileError = fallbackRes.error;
      }

      if (profileError) {
        if (isSchemaCacheError(profileError)) {
          profileRows = [];
          setInfo(
            "Group user names are temporarily using fallback values because Supabase schema cache is still refreshing."
          );
        } else {
          setError(getFriendlyErrorMessage(profileError));
          setLoading(false);
          return;
        }
      }

      profileMap = Object.fromEntries((profileRows || []).map((profile) => [
        profile.user_id,
        {
          email: profile.email || '',
          display_name: profile.display_name || fallbackDisplayName(profile.email || '')
        }
      ]));
    }

    const expenseRows = expensesRes.data || [];
    const expenseIds = expenseRows.map((expense) => expense.id);

    let splitRows = [];
    if (expenseIds.length) {
      const { data: fetchedSplits, error: splitsError } = await supabase
        .from('expense_splits')
        .select('expense_id, member_id, share_amount')
        .in('expense_id', expenseIds);

      if (splitsError) {
        if (isSchemaCacheError(splitsError)) {
          setInfo(
            "Expense split details are temporarily unavailable because Supabase schema cache is still refreshing."
          );
        } else {
          setError(getFriendlyErrorMessage(splitsError));
          setLoading(false);
          return;
        }
      }

      splitRows = splitsError ? [] : (fetchedSplits || []);
    }

    const splitMap = splitRows.reduce((acc, split) => {
      if (!acc[split.expense_id]) acc[split.expense_id] = [];
      acc[split.expense_id].push({
        member_id: split.member_id,
        share_amount: split.share_amount
      });
      return acc;
    }, {});

    const normalizedExpenses = expenseRows.map((expense) => ({
      ...expense,
      splits: splitMap[expense.id] || []
    }));

    const enrichedMemberships = membershipRows.map((membership) => ({
      ...membership,
      email: profileMap[membership.user_id]?.email || '',
      display_name: profileMap[membership.user_id]?.display_name || ''
    }));

    setSelectedTripId(tripId);
    setSelectedTrip(activeTrip);
    setMembers(effectiveMembers);
    setExpenses(normalizedExpenses);
    setGroupMemberships(enrichedMemberships);
    setGroupInvites(inviteRows);
    setGroupPastInvites(pastInviteRows);
    if (myMembership) {
      setMembershipByTrip((current) => ({ ...current, [tripId]: myMembership.role }));
    } else if (membershipsRes.error) {
      setMembershipByTrip((current) => ({ ...current, [tripId]: current[tripId] || 'member' }));
      setInfo(
        "Group role details are temporarily unavailable due to schema cache lag. Run `NOTIFY pgrst, 'reload schema';` in SQL Editor and refresh."
      );
    }
    setLoading(false);
  }

  useEffect(() => {
    if (isLocalMode) {
      loadHomeData();
      return;
    }

    let active = true;
    setAuthLoading(true);

    supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError) setError(getFriendlyErrorMessage(authError));
      setSession(data.session || null);
      if (data.session) loadCurrentProfile(data.session);
      setAuthLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession || null);
      if (currentSession) {
        loadCurrentProfile(currentSession);
      } else {
        setCurrentProfile(null);
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [isLocalMode]);

  useEffect(() => {
    if (isLocalMode) return;
    loadHomeData();
  }, [isLocalMode, session?.user?.id]);

  useEffect(() => {
    if (isLocalMode || !session?.user?.id) return;
    loadCurrentProfile(session);
  }, [isLocalMode, session?.user?.id]);

  async function handleSendOtp(email) {
    if (isLocalMode) return;
    setError('');
    setInfo('');

    // Preserve ?invite= token through the magic link redirect so auto-join works after sign-in
    const redirectTo = new URL(window.location.origin);
    const inviteToken = new URLSearchParams(window.location.search).get('invite');
    if (inviteToken) redirectTo.searchParams.set('invite', inviteToken);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo.toString() }
    });

    if (otpError) {
      setError(getFriendlyErrorMessage(otpError));
      return;
    }

    setInfo(`Magic link sent to ${email}. Open your inbox to continue.`);
  }

  async function handleLogout() {
    if (isLocalMode) return;
    setError('');
    setInfo('');
    const { error: logoutError } = await supabase.auth.signOut();
    if (logoutError) {
      setError(getFriendlyErrorMessage(logoutError));
      return;
    }
    setInfo('Signed out successfully.');
    clearTripState();
    setCurrentProfile(null);
  }

  async function ensureCurrentUserMember(tripId) {
    if (!session?.user?.id) return true;

    const { error: ensureError } = await supabase.rpc('ensure_trip_member_record', {
      p_trip_id: tripId,
      p_user_id: session.user.id
    });

    if (!ensureError) return true;

    if (!isSchemaCacheFunctionError(ensureError, 'ensure_trip_member_record')) {
      setError(getFriendlyErrorMessage(ensureError));
      return false;
    }

    const { error: fallbackInsertError } = await supabase
      .from('members')
      .insert({
        trip_id: tripId,
        user_id: session.user.id,
        name: currentProfile?.display_name || fallbackDisplayName(session.user.email || '')
      });

    if (fallbackInsertError && isMissingColumnError(fallbackInsertError, 'members', 'user_id')) {
      const { error: legacyInsertError } = await supabase
        .from('members')
        .insert({
          trip_id: tripId,
          name: currentProfile?.display_name || fallbackDisplayName(session.user.email || '')
        });

      if (legacyInsertError && legacyInsertError.code !== '23505') {
        setError(getFriendlyErrorMessage(legacyInsertError));
        return false;
      }

      return true;
    }

    if (fallbackInsertError && fallbackInsertError.code !== '23505') {
      setError(getFriendlyErrorMessage(fallbackInsertError));
      return false;
    }

    return true;
  }

  async function tryUpsertMemberNameForCurrentTrip(displayName) {
    if (!selectedTripId || !session?.user?.id) return;

    const { error: memberUpdateError } = await supabase
      .from('members')
      .update({ name: displayName })
      .eq('trip_id', selectedTripId)
      .eq('user_id', session.user.id);

    if (memberUpdateError) {
      if (isMissingColumnError(memberUpdateError, 'members', 'user_id')) {
        const { error: legacyInsertError } = await supabase
          .from('members')
          .insert({
            trip_id: selectedTripId,
            name: displayName
          });

        if (legacyInsertError && legacyInsertError.code !== '23505') {
          setError(getFriendlyErrorMessage(legacyInsertError));
          return;
        }
      } else {
        setError(getFriendlyErrorMessage(memberUpdateError));
        return;
      }
    }

    await loadTripData(selectedTripId, selectedTrip);
  }

  async function handleUpdateDisplayName(displayName) {
    if (isLocalMode || !session?.user) return;

    const { data: profile, error: profileError } = await supabase
      .rpc('update_my_display_name', { p_display_name: displayName })
      .single();

    if (profileError) {
      const profileMessage = getFriendlyErrorMessage(profileError);
      if (
        profileError.code === '42501' &&
        (profileMessage.includes('user_profiles') || profileMessage.toLowerCase().includes('row-level security'))
      ) {
        setInfo(
          'Display name could not be saved to global profile due to current DB policy state. It will still be used in this session/group.'
        );
        setCurrentProfile((current) => ({
          user_id: session.user.id,
          email: current?.email || session.user.email || '',
          display_name: displayName
        }));
      } else {
        setError(profileMessage);
        return;
      }
    }

    if (profile) {
      setCurrentProfile({
        user_id: session.user.id,
        email: profile.email || session.user.email || '',
        display_name: profile.display_name || displayName
      });
    }

    if (selectedTripId) {
      await tryUpsertMemberNameForCurrentTrip(displayName);
    }
  }

  async function handleAddTrip(name) {
    setError('');
    setInfo('');

    if (isLocalMode) {
      try {
        const trip = addLocalTrip(name);
        await loadTripData(trip.id, trip);
      } catch (localError) {
        setError(localError.message);
      }
      return;
    }

    if (!session?.user) {
      setError('Sign in before creating a group.');
      return;
    }

    const { data: trip, error: tripError } = await supabase.rpc('create_trip_with_owner', {
      trip_name: name
    });

    if (tripError) {
      setError(getFriendlyErrorMessage(tripError));
      return;
    }

    setInfo('Group created. You are the owner.');
    await loadHomeData();
    await loadTripData(trip.id, { ...trip, accessRole: 'owner' });
  }

  async function handleClaimTrip(tripId) {
    if (isLocalMode) return;
    if (!session?.user) {
      setError('Sign in before claiming a group.');
      return;
    }

    setError('');
    setInfo('');
    const { error: claimError } = await supabase.rpc('claim_unowned_trip', {
      p_trip_id: tripId
    });

    if (claimError) {
      setError(getFriendlyErrorMessage(claimError));
      return;
    }

    setInfo('Group claimed successfully.');
    await loadHomeData();
  }

  async function handleAcceptInvite(token) {
    if (isLocalMode) return;
    if (!session?.user) {
      setError('Sign in before accepting invites.');
      return;
    }

    setError('');
    setInfo('');
    const { data: tripId, error: inviteError } = await supabase.rpc('accept_trip_invitation', {
      p_token: token
    });

    if (inviteError) {
      const msg = inviteError.message || '';
      // Already used — user is already a member, navigate them in silently
      if (msg.includes('already used') || msg.includes('already accepted')) {
        setInfo('You have already joined this group.');
        await loadHomeData();
        return;
      }
      setError(getFriendlyErrorMessage(inviteError));
      return;
    }

    setInfo('Invitation accepted.');
    await loadHomeData();
    if (tripId) await loadTripData(tripId);
  }

  async function handleAddMember(name) {
    if (!selectedTripId) {
      setError('Create or select a trip before adding members.');
      return;
    }

    if (!isAdmin) {
      setError('Only owner/admin can add members.');
      return;
    }

    if (isLocalMode) {
      try {
        addLocalMember(selectedTripId, name);
        await loadTripData(selectedTripId);
      } catch (localError) {
        setError(localError.message);
      }
      return;
    }

    const { error: memberError } = await supabase.from('members').insert({ trip_id: selectedTripId, name });
    if (memberError) {
      setError(getFriendlyErrorMessage(memberError));
      return;
    }
    await loadTripData(selectedTripId);
  }

  async function saveExpenseWithRpc(payload, expenseId = null) {
    const { error: saveError } = await supabase.rpc('save_expense_with_splits', {
      p_trip_id: selectedTripId,
      p_description: payload.description,
      p_amount: payload.amount,
      p_paid_by: payload.paid_by,
      p_split_type: payload.split_type,
      p_expense_date: payload.expense_date,
      p_splits: payload.splits,
      p_expense_id: expenseId
    });

    if (saveError) {
      setError(getFriendlyErrorMessage(saveError));
      return false;
    }

    return true;
  }

  async function handleAddExpense(payload) {
    if (!selectedTripId) {
      setError('Create or select a trip before adding expenses.');
      return;
    }

    const totalSplit = payload.splits.reduce((sum, item) => sum + Number(item.share_amount || 0), 0);
    if (Math.abs(totalSplit - payload.amount) > 0.01) {
      setError('Split total must match expense amount.');
      return;
    }

    if (!canAddExpenses) {
      setError('Join this group before adding expenses.');
      return;
    }

    if (isLocalMode) {
      addLocalExpense(selectedTripId, payload);
      await loadTripData(selectedTripId);
      return;
    }

    const didSave = await saveExpenseWithRpc(payload);
    if (!didSave) return;
    await loadTripData(selectedTripId);
  }

  async function handleEditExpense(expenseId, payload) {
    if (!selectedTripId) return false;

    const totalSplit = payload.splits.reduce((sum, item) => sum + Number(item.share_amount || 0), 0);
    if (Math.abs(totalSplit - payload.amount) > 0.01) {
      setError('Split total must match expense amount.');
      return false;
    }

    if (isLocalMode) {
      updateLocalExpense(selectedTripId, expenseId, payload);
      await loadTripData(selectedTripId);
      return true;
    }

    const didSave = await saveExpenseWithRpc(payload, expenseId);
    if (!didSave) return false;
    await loadTripData(selectedTripId);
    return true;
  }

  async function handleDeleteExpense(expenseId) {
    if (!selectedTripId) return;
    if (!window.confirm('Delete this expense? This action cannot be undone.')) return;

    if (isLocalMode) {
      deleteLocalExpense(selectedTripId, expenseId);
      await loadTripData(selectedTripId);
      return;
    }

    const { error: deleteError } = await supabase.rpc('delete_expense_with_permission', {
      p_expense_id: expenseId
    });
    if (deleteError) {
      setError(getFriendlyErrorMessage(deleteError));
      return;
    }
    await loadTripData(selectedTripId);
  }

  function handleDownloadDetailedCsv() {
    if (!expenses.length) {
      setInfo('Add at least one expense before downloading the detailed CSV.');
      return;
    }

    downloadExpensesCsv({
      tripName: selectedTrip?.name || 'Trip group',
      expenses,
      members
    });
    setInfo('Detailed expense CSV downloaded.');
  }

  function handleDownloadSummaryCsv() {
    if (!memberSummary.length) {
      setInfo('Add at least one member before downloading the summary CSV.');
      return;
    }

    downloadSummaryCsv({
      tripName: selectedTrip?.name || 'Trip group',
      totalSpent,
      memberSummary,
      settlements
    });
    setInfo('Settlement summary CSV downloaded.');
  }

  async function handleExportPdf() {
    if (!memberSummary.length && !expenses.length) {
      setInfo('Add members or expenses before exporting the PDF.');
      return;
    }

    setPdfExporting(true);
    setInfo('Generating PDF, please wait...');
    try {
      await exportTripReportPdf({
        tripName: selectedTrip?.name || 'Trip group',
        totalSpent,
        memberSummary,
        settlements,
        expenses,
        members
      });
      setInfo('PDF downloaded successfully.');
    } catch (err) {
      setError('Failed to generate PDF. Please try again.');
    } finally {
      setPdfExporting(false);
    }
  }

  async function handleCreateInvite({ invited_email, role }) {
    if (!selectedTripId || isLocalMode) return;
    if (!isAdmin) {
      setError('Only owner/admin can create invites.');
      return;
    }

    setError('');
    const { data: newInvite, error: inviteError } = await supabase.rpc('create_trip_invitation', {
      p_trip_id: selectedTripId,
      p_invited_email: invited_email,
      p_role: role
    });

    if (inviteError) {
      setError(getFriendlyErrorMessage(inviteError));
      return;
    }

    if (newInvite?.token) {
      const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${newInvite.token}`;
      setInfo(`Invite link created: ${inviteUrl}`);
    }

    await loadTripData(selectedTripId);
  }

  async function handleRemoveTripMember(userId) {
    if (!selectedTripId || isLocalMode) return;
    if (!isAdmin) {
      setError('Only owner/admin can remove users.');
      return;
    }
    const activeTripId = selectedTripId;

    const { error: removeError } = await supabase.rpc('remove_trip_member', {
      p_trip_id: activeTripId,
      p_user_id: userId
    });

    if (removeError) {
      setError(getFriendlyErrorMessage(removeError));
      return;
    }

    await loadHomeData();
    await loadTripData(activeTripId);
  }

  async function handleUpdateRole(userId, role) {
    if (!selectedTripId || isLocalMode) return;
    if (!isOwner) {
      setError('Only owner can change roles.');
      return;
    }

    const { error: roleError } = await supabase.rpc('update_trip_member_role', {
      p_trip_id: selectedTripId,
      p_user_id: userId,
      p_role: role
    });

    if (roleError) {
      setError(getFriendlyErrorMessage(roleError));
      return;
    }

    await loadTripData(selectedTripId);
  }

  const memberSummary = useMemo(() => computeMemberSummary(members, expenses), [members, expenses]);
  const balances = useMemo(
    () => memberSummary.map((member) => ({ ...member, balance: member.balance })),
    [memberSummary]
  );
  const settlements = useMemo(() => simplifySettlements(balances), [balances]);
  const totalSpent = useMemo(() => expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0), [expenses]);
  const memberMap = useMemo(() => Object.fromEntries(members.map((member) => [member.id, member.name])), [members]);
  const headerAccountSlot = !isLocalMode && session?.user ? (
    <AuthPanel
      session={session}
      profile={currentProfile}
      onSendOtp={handleSendOtp}
      onLogout={handleLogout}
      onUpdateDisplayName={handleUpdateDisplayName}
      compact
    />
  ) : null;

  return (
    <div className="app-shell">
      <main className="container stack xl">
        <Header isLocalMode={isLocalMode} accountSlot={headerAccountSlot} />
        {!isLocalMode && !session?.user ? (
          <AuthPanel
            session={session}
            profile={currentProfile}
            onSendOtp={handleSendOtp}
            onLogout={handleLogout}
            onUpdateDisplayName={handleUpdateDisplayName}
          />
        ) : null}
        {isLocalMode ? (
          <div className="info-banner">
            Running in local demo mode. Add Supabase values to <code>.env</code> when you are ready to persist shared trip data.
          </div>
        ) : null}
        {authLoading ? <div className="card"><p>Checking authentication...</p></div> : null}
        {info ? <div className="info-banner">{info}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {loading ? <div className="card"><p>Loading trip data...</p></div> : (
          isGroupView ? (
            <>
              <GroupHeader
                tripName={selectedTrip?.name || 'Trip group'}
                totalSpent={totalSpent}
                role={currentRole}
                onBack={loadHomeData}
                onDownloadDetailedCsv={handleDownloadDetailedCsv}
                onDownloadSummaryCsv={handleDownloadSummaryCsv}
                onExportPdf={handleExportPdf}
                canDownloadDetailedCsv={expenses.length > 0}
                canDownloadSummaryCsv={memberSummary.length > 0}
                canExportPdf={(memberSummary.length > 0 || expenses.length > 0) && !pdfExporting}
                pdfExporting={pdfExporting}
              />
              {!isLocalMode && !currentRole ? (
                <div className="info-banner">
                  This trip is unclaimed. Go back to groups and click <strong>Claim ownership</strong> to manage access.
                </div>
              ) : null}
              <section className="grid-panel main-grid">
                <MembersPanel members={members} onAddMember={handleAddMember} canManageMembers={isAdmin} />
                <ExpenseForm members={members} onAddExpense={handleAddExpense} canAddExpenses={canAddExpenses} />
              </section>
              {!isLocalMode && currentRole ? (
                <GroupAccessPanel
                  session={session}
                  isOwner={isOwner}
                  isAdmin={isAdmin}
                  memberships={groupMemberships}
                  invites={groupInvites}
                  pastInvites={groupPastInvites}
                  onCreateInvite={handleCreateInvite}
                  onRemoveMember={handleRemoveTripMember}
                  onUpdateRole={handleUpdateRole}
                />
              ) : null}
              <BalancesPanel memberSummary={memberSummary} settlements={settlements} />
              <ExpensesList
                expenses={expenses}
                members={members}
                memberMap={memberMap}
                canManageExpenses={canAddExpenses}
                onEditExpense={handleEditExpense}
                onDeleteExpense={handleDeleteExpense}
              />
            </>
          ) : (
            <>
              {!isLocalMode ? (
                <InviteAcceptPanel disabled={!session?.user} onAcceptInvite={handleAcceptInvite} />
              ) : null}
              <HomeView
                trips={trips}
                onAddTrip={handleAddTrip}
                onOpenTrip={loadTripData}
                onClaimTrip={handleClaimTrip}
                canCreateTrips={canCreateTrips}
              />
            </>
          )
        )}
      </main>
    </div>
  );
}