const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validateBooking(input) {
  const errors = [];
  const required = ['event_name', 'department', 'event_date', 'start_time', 'end_time', 'contact_person'];
  for (const field of required) {
    if (typeof input[field] !== 'string' || input[field].trim() === '') {
      errors.push(`${field} is required.`);
    }
  }
  if (input.event_date && !VALID_DATE.test(input.event_date)) errors.push('event_date must use YYYY-MM-DD format.');
  if (input.start_time && !VALID_TIME.test(input.start_time)) errors.push('start_time must use 24-hour HH:MM format.');
  if (input.end_time && !VALID_TIME.test(input.end_time)) errors.push('end_time must use 24-hour HH:MM format.');
  if (input.start_time && input.end_time && VALID_TIME.test(input.start_time) && VALID_TIME.test(input.end_time) && input.start_time >= input.end_time) {
    errors.push('end_time must be later than start_time.');
  }
  for (const field of ['event_name', 'department', 'contact_person']) {
    if (typeof input[field] === 'string' && input[field].trim().length > 100) errors.push(`${field} must be 100 characters or fewer.`);
  }
  if (typeof input.notes === 'string' && input.notes.length > 500) errors.push('notes must be 500 characters or fewer.');
  return errors;
}

// Two intervals overlap when each starts before the other one ends.
// A booking ending at 11:00 does not conflict with one starting at 11:00.
function findConflict(db, booking, excludeId = null) {
  const sql = `
    SELECT id, event_name, department, event_date, start_time, end_time
    FROM bookings
    WHERE event_date = ? AND status = 'APPROVED'
      AND (? IS NULL OR id != ?)
      AND start_time < ? AND end_time > ?
    ORDER BY start_time
    LIMIT 1
  `;
  return db.prepare(sql).get(
    booking.event_date,
    excludeId,
    excludeId,
    booking.end_time,
    booking.start_time
  );
}

module.exports = { validateBooking, findConflict };
