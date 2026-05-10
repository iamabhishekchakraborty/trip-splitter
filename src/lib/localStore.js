const STORAGE_KEY = 'trip-splitter:data';

const seedData = {
  trips: [
    { id: 'trip-goa-2026', name: 'Goa2026', created_at: '2026-05-08T08:40:00.000Z' },
    { id: 'trip-darjeeling-2026', name: 'Darjeeling2026', created_at: '2026-05-08T08:41:00.000Z' }
  ],
  members: [
    { id: 'local-abhishek-goa', trip_id: 'trip-goa-2026', name: 'Abhishek', created_at: '2026-05-08T08:45:00.000Z' },
    { id: 'local-kazi-goa', trip_id: 'trip-goa-2026', name: 'Kazi', created_at: '2026-05-08T08:46:00.000Z' },
    { id: 'local-sayantan-goa', trip_id: 'trip-goa-2026', name: 'Sayantan', created_at: '2026-05-08T08:47:00.000Z' },
    { id: 'local-snehasish-darjeeling', trip_id: 'trip-darjeeling-2026', name: 'Snehasish', created_at: '2026-05-08T08:48:00.000Z' },
    { id: 'local-abhishek-darjeeling', trip_id: 'trip-darjeeling-2026', name: 'Abhishek', created_at: '2026-05-08T08:49:00.000Z' }
  ],
  expenses: []
};

function createId(prefix) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = normalizeData(JSON.parse(saved));
      writeData(parsed);
      return parsed;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  writeData(seedData);
  return seedData;
}

function writeData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function normalizeData(data) {
  if (Array.isArray(data.trips)) return data;

  const legacySeedNames = ['Amit', 'Priya', 'Rahul'];
  const memberNames = (data.members || []).map((member) => member.name).sort();
  const isUntouchedLegacySeed =
    !(data.expenses || []).length &&
    legacySeedNames.length === memberNames.length &&
    legacySeedNames.every((name, index) => name === memberNames[index]);

  if (isUntouchedLegacySeed) return seedData;

  const defaultTrip = {
    id: 'trip-default',
    name: 'First Trip',
    created_at: new Date().toISOString()
  };

  return {
    trips: [defaultTrip],
    members: (data.members || []).map((member) => ({ ...member, trip_id: defaultTrip.id })),
    expenses: (data.expenses || []).map((expense) => ({ ...expense, trip_id: defaultTrip.id }))
  };
}

function getTripSummaries(data) {
  return [...data.trips]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((trip) => {
      const tripMembers = data.members.filter((member) => member.trip_id === trip.id);
      const tripExpenses = data.expenses.filter((expense) => expense.trip_id === trip.id);

      return {
        ...trip,
        memberCount: tripMembers.length,
        expenseCount: tripExpenses.length,
        totalSpent: tripExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0)
      };
    });
}

export function loadLocalHomeData() {
  const data = readData();
  return {
    trips: getTripSummaries(data)
  };
}

export function loadLocalTripData(tripId) {
  const data = readData();
  const trip = data.trips.find((item) => item.id === tripId);

  return {
    trip,
    members: data.members
      .filter((member) => member.trip_id === tripId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    expenses: data.expenses
      .filter((expense) => expense.trip_id === tripId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  };
}

export function addLocalTrip(name) {
  const data = readData();
  const normalizedName = name.trim();
  const existing = data.trips.some((trip) => trip.name.toLowerCase() === normalizedName.toLowerCase());
  if (existing) throw new Error('That trip already exists.');

  const trip = {
    id: createId('trip'),
    name: normalizedName,
    created_at: new Date().toISOString()
  };

  writeData({
    ...data,
    trips: [...data.trips, trip]
  });

  return trip;
}

export function addLocalMember(tripId, name) {
  const data = readData();
  const normalizedName = name.trim();
  const existing = data.members.some(
    (member) => member.trip_id === tripId && member.name.toLowerCase() === normalizedName.toLowerCase()
  );
  if (existing) throw new Error('That member already exists in this trip.');

  writeData({
    ...data,
    members: [
      ...data.members,
      {
        id: createId('member'),
        trip_id: tripId,
        name: normalizedName,
        created_at: new Date().toISOString()
      }
    ]
  });
}

export function addLocalExpense(tripId, payload) {
  const data = readData();
  const expense = {
    id: createId('expense'),
    trip_id: tripId,
    description: payload.description,
    amount: Number(payload.amount),
    paid_by: payload.paid_by,
    split_type: payload.split_type,
    created_at: new Date().toISOString(),
    splits: payload.splits.map((split) => ({
      member_id: split.member_id,
      share_amount: Number(split.share_amount)
    }))
  };

  writeData({
    ...data,
    expenses: [expense, ...data.expenses]
  });
}
