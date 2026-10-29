const db = require('../src/database');
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const count = db.prepare('SELECT COUNT(*) AS total FROM bookings').get().total;
if (count > 0) {
  console.log('Seed skipped: the database already contains bookings.');
} else {
  const insert = db.prepare(`INSERT INTO bookings (event_name, department, event_date, start_time, end_time, contact_person, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const seed = db.transaction(() => {
    insert.run('Department Project Expo', 'Information Science', addDays(2), '10:00', '12:00', 'Demo Coordinator', 'Demo data for testing the calendar.');
    insert.run('Technical Seminar', 'Computer Science', addDays(2), '14:00', '16:00', 'Demo Coordinator', 'Demo data for testing the calendar.');
    insert.run('Student Club Orientation', 'Student Affairs', addDays(4), '09:30', '11:00', 'Demo Coordinator', 'Demo data for testing the calendar.');
  });
  seed();
  console.log('Added three demo bookings. They are examples only, not real college reservations.');
}
db.close();
