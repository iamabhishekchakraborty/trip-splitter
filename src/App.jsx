import { useEffect, useMemo, useState } from 'react';
import Header from './components/Header';
import HomeView from './components/HomeView';
import GroupHeader from './components/GroupHeader';
import MembersPanel from './components/MembersPanel';
import ExpenseForm from './components/ExpenseForm';
import BalancesPanel from './components/BalancesPanel';
import ExpensesList from './components/ExpensesList';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import { computeBalances, simplifySettlements } from './lib/balances';
import {
  addLocalExpense,
  addLocalMember,
  addLocalTrip,
  loadLocalHomeData,
  loadLocalTripData
} from './lib/localStore';

export default function App() {
  const [trips, setTrips] = useState([]);
  const [selectedTripId, setSelectedTripId] = useState('');
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isLocalMode = !hasSupabaseConfig;
  const isGroupView = Boolean(selectedTripId);

  function buildTripSummaries(tripsData, membersData, expensesData) {
    return (tripsData || []).map((trip) => {
      const tripMembers = (membersData || []).filter((member) => member.trip_id === trip.id);
      const tripExpenses = (expensesData || []).filter((expense) => expense.trip_id === trip.id);

      return {
        ...trip,
        memberCount: tripMembers.length,
        expenseCount: tripExpenses.length,
        totalSpent: tripExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
      };
    });
  }

  async function loadHomeData() {
    setLoading(true);
    setError('');
    setSelectedTripId('');
    setSelectedTrip(null);
    setMembers([]);
    setExpenses([]);

    if (isLocalMode) {
      const localData = loadLocalHomeData();
      setTrips(localData.trips);
      setLoading(false);
      return;
    }

    const { data: tripsData, error: tripsError } = await supabase
      .from('trips')
      .select('*')
      .order('created_at', { ascending: true });

    if (tripsError) {
      setError(tripsError.message);
      setLoading(false);
      return;
    }

    const { data: membersData, error: membersError } = await supabase
      .from('members')
      .select('trip_id');

    if (membersError) {
      setError(membersError.message);
      setLoading(false);
      return;
    }

    const { data: expensesData, error: expensesError } = await supabase
      .from('expenses')
      .select('trip_id, amount');

    if (expensesError) {
      setError(expensesError.message);
      setLoading(false);
      return;
    }

    setTrips(buildTripSummaries(tripsData, membersData, expensesData));
    setLoading(false);
  }

  async function loadTripData(tripId, knownTrip) {
    setLoading(true);
    setError('');

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
        setError(tripError.message);
        setLoading(false);
        return;
      }

      activeTrip = tripData;
    }

    const { data: membersData, error: membersError } = await supabase
      .from('members')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true });

    if (membersError) {
      setError(membersError.message);
      setLoading(false);
      return;
    }

    const { data: expensesData, error: expensesError } = await supabase
      .from('expenses')
      .select('id, description, amount, paid_by, split_type, expense_date, created_at, expense_splits(member_id, share_amount)')
      .eq('trip_id', tripId)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (expensesError) {
      setError(expensesError.message);
      setLoading(false);
      return;
    }

    const normalizedExpenses = (expensesData || []).map((expense) => ({
      ...expense,
      splits: expense.expense_splits || []
    }));

    setSelectedTripId(tripId);
    setSelectedTrip(activeTrip);
    setMembers(membersData || []);
    setExpenses(normalizedExpenses);
    setLoading(false);
  }

  useEffect(() => {
    loadHomeData();
  }, []);

  async function handleAddTrip(name) {
    if (isLocalMode) {
      try {
        const trip = addLocalTrip(name);
        await loadTripData(trip.id, trip);
      } catch (localError) {
        setError(localError.message);
      }
      return;
    }

    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .insert({ name })
      .select()
      .single();

    if (tripError) return setError(tripError.message);
    setTrips((current) => [...current, { ...trip, memberCount: 0, expenseCount: 0, totalSpent: 0 }]);
    await loadTripData(trip.id, trip);
  }

  async function handleAddMember(name) {
    if (!selectedTripId) {
      setError('Create or select a trip before adding members.');
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
    if (memberError) return setError(memberError.message);
    await loadTripData(selectedTripId);
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

    if (isLocalMode) {
      addLocalExpense(selectedTripId, payload);
      await loadTripData(selectedTripId);
      return;
    }

    const { data: expense, error: expenseError } = await supabase
      .from('expenses')
      .insert({
        trip_id: selectedTripId,
        description: payload.description,
        amount: payload.amount,
        paid_by: payload.paid_by,
        split_type: payload.split_type,
        expense_date: payload.expense_date
      })
      .select()
      .single();

    if (expenseError) return setError(expenseError.message);

    const splitsToInsert = payload.splits.map((item) => ({
      expense_id: expense.id,
      member_id: item.member_id,
      share_amount: Number(item.share_amount)
    }));

    const { error: splitError } = await supabase.from('expense_splits').insert(splitsToInsert);
    if (splitError) return setError(splitError.message);
    await loadTripData(selectedTripId);
  }

  const balances = useMemo(() => computeBalances(members, expenses), [members, expenses]);
  const settlements = useMemo(() => simplifySettlements(balances), [balances]);
  const totalSpent = useMemo(() => expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0), [expenses]);
  const memberMap = useMemo(() => Object.fromEntries(members.map((member) => [member.id, member.name])), [members]);

  return (
    <div className="app-shell">
      <main className="container stack xl">
        <Header isLocalMode={isLocalMode} />
        {isLocalMode ? (
          <div className="info-banner">
            Running in local demo mode. Add Supabase values to <code>.env</code> when you are ready to persist shared trip data.
          </div>
        ) : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {loading ? <div className="card"><p>Loading trip data...</p></div> : (
          isGroupView ? (
            <>
              <GroupHeader tripName={selectedTrip?.name || 'Trip group'} totalSpent={totalSpent} onBack={loadHomeData} />
              <section className="grid-panel main-grid">
                <MembersPanel members={members} onAddMember={handleAddMember} />
                <ExpenseForm members={members} onAddExpense={handleAddExpense} />
              </section>
              <BalancesPanel balances={balances} settlements={settlements} />
              <ExpensesList expenses={expenses} memberMap={memberMap} />
            </>
          ) : (
            <HomeView trips={trips} onAddTrip={handleAddTrip} onOpenTrip={loadTripData} />
          )
        )}
      </main>
    </div>
  );
}
