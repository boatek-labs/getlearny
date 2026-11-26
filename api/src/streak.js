// Pure streak helpers. Kept separate from the route so they can be unit tested without a database.
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// PostgreSQL date values can arrive as strings or Date objects depending on the driver configuration.
export function normalizeStudyDays(rows) {
  return rows
    .map((row) => {
      const raw = row?.study_day;
      const value = raw instanceof Date
        ? (Number.isNaN(raw.getTime()) ? '' : raw.toISOString().slice(0, 10))
        : String(raw ?? '').slice(0, 10);
      return DAY_PATTERN.test(value) ? value : '';
    })
    .filter(Boolean);
}

function shiftDay(day, delta) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// `days` must be unique YYYY-MM-DD strings sorted newest first.
export function computeStreak(days, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const yesterday = shiftDay(today, -1);
  let current = 0;
  let check = days.includes(today) ? today : days.includes(yesterday) ? yesterday : null;
  if (check) {
    for (const day of days) {
      if (day !== check) break;
      current += 1;
      check = shiftDay(check, -1);
    }
  }
  let longest = 0;
  let run = 0;
  let previous = null;
  for (const day of [...days].sort()) {
    run = previous && day === shiftDay(previous, 1) ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  return { current, longest, activeDays: days.length, lastStudyDay: days[0] || null };
}
