const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { validateBooking, findConflict } = require('../src/scheduling');

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE bookings (
    id INTEGER PRIMARY KEY, event_name TEXT, department TEXT, event_date TEXT,
    start_time TEXT, end_time TEXT, status TEXT
  )`);
  return db;
}
const valid = { event_name:'Project Expo', department:'ISE', event_date:'2026-11-05', start_time:'10:00', end_time:'11:00', contact_person:'Asha', notes:'' };

test('accepts a valid booking', () => assert.deepEqual(validateBooking(valid), []));
test('rejects missing required fields', () => assert.ok(validateBooking({ ...valid, event_name:'' }).some(e => e.includes('event_name is required'))));
test('rejects invalid time range', () => assert.ok(validateBooking({ ...valid, start_time:'12:00', end_time:'11:00' }).some(e => e.includes('end_time must be later'))));
test('detects an overlapping approved booking', () => {
  const db = memoryDb();
  db.prepare(`INSERT INTO bookings VALUES (1,'Seminar','CSE','2026-11-05','10:30','11:30','APPROVED')`).run();
  assert.equal(findConflict(db, valid).event_name, 'Seminar'); db.close();
});
test('allows bookings that touch but do not overlap', () => {
  const db = memoryDb();
  db.prepare(`INSERT INTO bookings VALUES (1,'Seminar','CSE','2026-11-05','11:00','12:00','APPROVED')`).run();
  assert.equal(findConflict(db, valid), undefined); db.close();
});
test('ignores cancelled bookings when checking conflicts', () => {
  const db = memoryDb();
  db.prepare(`INSERT INTO bookings VALUES (1,'Cancelled event','CSE','2026-11-05','10:30','11:30','CANCELLED')`).run();
  assert.equal(findConflict(db, valid), undefined); db.close();
});
test('can exclude the booking being edited', () => {
  const db = memoryDb();
  db.prepare(`INSERT INTO bookings VALUES (1,'Project Expo','ISE','2026-11-05','10:00','11:00','APPROVED')`).run();
  assert.equal(findConflict(db, valid, 1), undefined); db.close();
});
