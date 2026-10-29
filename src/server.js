require('dotenv').config();
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const db = require('./database');
const { validateBooking, findConflict } = require('./scheduling');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const COOKIE_NAME = 'campus_session';

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function safeUser(user) {
  return { id: user.id, username: user.username, display_name: user.display_name, role: user.role };
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [scheme, salt, hex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function cookieValue(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index >= 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}
function setSessionCookie(res, token, secure) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`);
}
function clearSessionCookie(res, secure) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
}
function requireAuth(req, res, next) {
  const token = cookieValue(req, COOKIE_NAME);
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  const row = db.prepare(`SELECT u.id,u.username,u.display_name,u.role,u.active,s.token_hash
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(hashToken(token), Math.floor(Date.now() / 1000));
  if (!row || !row.active) {
    if (row) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(row.token_hash);
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
  req.user = safeUser(row);
  req.sessionTokenHash = row.token_hash;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    next();
  };
}
function cleanBooking(body) {
  return {
    event_name: typeof body.event_name === 'string' ? body.event_name.trim() : body.event_name,
    department: typeof body.department === 'string' ? body.department.trim() : body.department,
    event_date: typeof body.event_date === 'string' ? body.event_date.trim() : body.event_date,
    start_time: typeof body.start_time === 'string' ? body.start_time.trim() : body.start_time,
    end_time: typeof body.end_time === 'string' ? body.end_time.trim() : body.end_time,
    contact_person: typeof body.contact_person === 'string' ? body.contact_person.trim() : body.contact_person,
    notes: typeof body.notes === 'string' ? body.notes.trim() : (body.notes === undefined ? '' : body.notes)
  };
}
function cleanUserFields(body) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const display_name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error('Username must be 3–40 characters and use letters, numbers, dots, underscores or hyphens.');
  if (display_name.length < 2 || display_name.length > 80) throw new Error('Display name must be between 2 and 80 characters.');
  if (!['student','faculty','principal'].includes(role)) throw new Error('Choose a valid user role.');
  if (password.length < 10 || password.length > 128) throw new Error('Password must be at least 10 characters long.');
  return { username, display_name, role, password };
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/setup-status', (_req, res) => res.json({ needsSetup: !db.prepare("SELECT id FROM users WHERE role='principal' LIMIT 1").get() }));
app.post('/api/setup', async (req, res) => {
  if (db.prepare("SELECT id FROM users WHERE role='principal' LIMIT 1").get()) return res.status(409).json({ error: 'Initial setup is already complete. Ask the principal to create accounts.' });
  const setupKey = String(process.env.SETUP_KEY || '');
  if (!setupKey || !req.body || typeof req.body.setup_key !== 'string' || !crypto.timingSafeEqual(crypto.createHash('sha256').update(req.body.setup_key).digest(), crypto.createHash('sha256').update(setupKey).digest())) {
    return res.status(401).json({ error: 'The initial setup key is incorrect. Check SETUP_KEY in your .env file.' });
  }
  try {
    const fields = cleanUserFields({ ...req.body, role: 'principal' });
    const password_hash = await hashPassword(fields.password);
    const result = db.prepare('INSERT INTO users(username,display_name,role,password_hash) VALUES(?,?,?,?)').run(fields.username, fields.display_name, 'principal', password_hash);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hashToken(token), user.id, Math.floor(Date.now()/1000)+SESSION_TTL_SECONDS, Math.floor(Date.now()/1000));
    setSessionCookie(res, token, req.secure);
    res.status(201).json({ user: safeUser(user), message: 'Principal account created. You are now signed in.' });
  } catch (error) {
    if (String(error.code || '').includes('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'That username is already in use.' });
    res.status(400).json({ error: error.message || 'Could not create principal account.' });
  }
});
app.post('/api/login', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const requestedRole = typeof req.body?.role === 'string' ? req.body.role : '';
  const user = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1').get(username);
  if (!user || !(await verifyPassword(password, user.password_hash)) || user.role !== requestedRole) {
    return res.status(401).json({ error: 'The username, password or selected role is incorrect.' });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now()/1000);
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hashToken(token), user.id, now+SESSION_TTL_SECONDS, now);
  setSessionCookie(res, token, req.secure);
  res.json({ user: safeUser(user), message: `Welcome, ${user.display_name}.` });
});
app.post('/api/logout', (req, res) => {
  const token = cookieValue(req, COOKIE_NAME);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
  clearSessionCookie(res, req.secure);
  res.json({ message: 'You have signed out.' });
});
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));
app.post('/api/change-password', requireAuth, async (req, res) => {
  const current = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
  const next = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!(await verifyPassword(current, user.password_hash))) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (next.length < 10 || next.length > 128) return res.status(400).json({ error: 'New password must be at least 10 characters long.' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(next), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
  clearSessionCookie(res, req.secure);
  res.json({ message: 'Password changed. Please sign in again.' });
});

app.get('/api/users', requireAuth, requireRole('principal'), (_req, res) => {
  const users = db.prepare('SELECT id,username,display_name,role,active,created_at FROM users ORDER BY role,display_name').all();
  res.json({ users });
});
app.post('/api/users', requireAuth, requireRole('principal'), async (req, res) => {
  try {
    const fields = cleanUserFields(req.body || {});
    const password_hash = await hashPassword(fields.password);
    const result = db.prepare('INSERT INTO users(username,display_name,role,password_hash) VALUES(?,?,?,?)').run(fields.username, fields.display_name, fields.role, password_hash);
    const user = db.prepare('SELECT id,username,display_name,role,active,created_at FROM users WHERE id=?').get(result.lastInsertRowid);
    res.status(201).json({ user, message: 'User account created.' });
  } catch (error) {
    if (String(error.code || '').includes('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'That username is already in use.' });
    res.status(400).json({ error: error.message || 'Could not create user.' });
  }
});
app.patch('/api/users/:id/active', requireAuth, requireRole('principal'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id === req.user.id) return res.status(400).json({ error: 'Choose a valid account other than your own.' });
  const active = req.body?.active === true ? 1 : req.body?.active === false ? 0 : null;
  if (active === null) return res.status(400).json({ error: 'Active must be true or false.' });
  const result = db.prepare('UPDATE users SET active=? WHERE id=?').run(active, id);
  if (!result.changes) return res.status(404).json({ error: 'User not found.' });
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  res.json({ message: active ? 'Account enabled.' : 'Account disabled.' });
});

app.delete('/api/users/:id', requireAuth, requireRole('principal'), (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  const user = db.prepare(
    'SELECT id, role FROM users WHERE id=?'
  ).get(id);

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (user.role === 'principal') {
    return res.status(403).json({
      error: 'Principal accounts cannot be deleted here.'
    });
  }

  const linkedRequests = db.prepare(
    'SELECT COUNT(*) AS count FROM booking_requests WHERE user_id=?'
  ).get(id).count;

  if (linkedRequests > 0) {
    return res.status(409).json({
      error: 'This user has booking request records. Disable the account instead to preserve those records.'
    });
  }

  const removeUser = db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    return db.prepare(
      'DELETE FROM users WHERE id=? AND role IN (?, ?)'
    ).run(id, 'student', 'faculty').changes;
  });

  const deleted = removeUser();

  if (!deleted) {
    return res.status(404).json({ error: 'User not found.' });
  }

  res.json({ message: 'User account deleted successfully.' });
});

app.get('/api/bookings', (req, res) => {
  const { date, department } = req.query;
  let sql = `SELECT id, event_name, department, event_date, start_time, end_time, contact_person, notes, status, created_at, updated_at FROM bookings WHERE status = 'APPROVED'`;
  const params = [];
  if (date) { sql += ' AND event_date = ?'; params.push(date); }
  if (department) { sql += ' AND department LIKE ?'; params.push(`%${String(department).slice(0, 100)}%`); }
  sql += ' ORDER BY event_date, start_time';
  res.json({ bookings: db.prepare(sql).all(...params) });
});
app.get('/api/availability', (req, res) => {
  const { date, start_time, end_time } = req.query;
  if (!date || !start_time || !end_time) return res.status(400).json({ error: 'Provide date, start_time and end_time.' });
  const errors = validateBooking({ event_name: 'Availability check', department: 'Availability check', event_date: date, start_time, end_time, contact_person: 'Availability check', notes: '' });
  if (errors.length) return res.status(400).json({ error: 'Invalid availability request.', details: errors });
  const conflict = findConflict(db, { event_date: date, start_time, end_time });
  res.json({ available: !conflict, message: conflict ? `This time overlaps with "${conflict.event_name}" (${conflict.start_time}–${conflict.end_time}).` : 'No conflicting approved booking is currently recorded for this time. Final permission still belongs to authorized college staff.', conflict: conflict || null, disclaimer: 'Availability reflects the latest bookings recorded in this system; it is not an approval or guarantee.' });
});

app.post('/api/booking-requests', requireAuth, requireRole('faculty'), (req, res) => {
  const booking = cleanBooking(req.body || {});
  const errors = validateBooking(booking);
  if (errors.length) return res.status(400).json({ error: 'Please correct the booking details.', details: errors });
  const conflict = findConflict(db, booking);
  if (conflict) return res.status(409).json({ error: `This request conflicts with "${conflict.event_name}" (${conflict.start_time}–${conflict.end_time}).`, conflict });
  const result = db.prepare(`INSERT INTO booking_requests(user_id,event_name,department,event_date,start_time,end_time,contact_person,notes) VALUES(@user_id,@event_name,@department,@event_date,@start_time,@end_time,@contact_person,@notes)`).run({ ...booking, user_id: req.user.id });
  res.status(201).json({ id: result.lastInsertRowid, message: 'Booking request submitted for principal review.' });
});
app.get('/api/booking-requests', requireAuth, (req, res) => {
  const rows = req.user.role === 'principal'
    ? db.prepare(`SELECT r.*,u.display_name AS requester_name,u.username AS requester_username FROM booking_requests r JOIN users u ON u.id=r.user_id ORDER BY CASE r.status WHEN 'PENDING' THEN 0 ELSE 1 END,r.created_at DESC`).all()
    : req.user.role === 'faculty'
      ? db.prepare('SELECT * FROM booking_requests WHERE user_id=? ORDER BY created_at DESC').all(req.user.id)
      : [];
  res.json({ requests: rows });
});
app.post('/api/booking-requests/:id/decision', requireAuth, requireRole('principal'), (req, res) => {
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  if (!Number.isInteger(id) || id < 1 || !['approve','reject'].includes(decision)) return res.status(400).json({ error: 'Invalid request or decision.' });
  const request = db.prepare("SELECT * FROM booking_requests WHERE id=? AND status='PENDING'").get(id);
  if (!request) return res.status(404).json({ error: 'Pending booking request not found.' });
  if (decision === 'approve') {
    const booking = { event_name:request.event_name, department:request.department, event_date:request.event_date, start_time:request.start_time, end_time:request.end_time, contact_person:request.contact_person, notes:request.notes };
    const errors = validateBooking(booking);
    const conflict = errors.length ? null : findConflict(db, booking);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    if (conflict) return res.status(409).json({ error: `Cannot approve because it conflicts with "${conflict.event_name}" (${conflict.start_time}–${conflict.end_time}).` });
    db.prepare(`INSERT INTO bookings(event_name,department,event_date,start_time,end_time,contact_person,notes) VALUES(@event_name,@department,@event_date,@start_time,@end_time,@contact_person,@notes)`).run(booking);
  }
  db.prepare('UPDATE booking_requests SET status=?,decision_note=?,decided_by=?,updated_at=datetime(\'now\') WHERE id=?').run(decision === 'approve' ? 'APPROVED' : 'REJECTED', typeof req.body.note === 'string' ? req.body.note.trim().slice(0,300) : '', req.user.id, id);
  res.json({ message: decision === 'approve' ? 'Request approved and added to the official schedule.' : 'Request rejected.' });
});

app.post('/api/bookings', requireAuth, requireRole('principal'), (req, res) => {
  const booking = cleanBooking(req.body || {});
  const errors = validateBooking(booking);
  if (errors.length) return res.status(400).json({ error: 'Please correct the booking details.', details: errors });
  const conflict = findConflict(db, booking);
  if (conflict) return res.status(409).json({ error: `Booking conflicts with "${conflict.event_name}" (${conflict.start_time}–${conflict.end_time}).`, conflict });
  const result = db.prepare(`INSERT INTO bookings(event_name,department,event_date,start_time,end_time,contact_person,notes) VALUES(@event_name,@department,@event_date,@start_time,@end_time,@contact_person,@notes)`).run(booking);
  const created = db.prepare('SELECT * FROM bookings WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json({ booking: created, message: 'Official booking added.' });
});
app.put('/api/bookings/:id', requireAuth, requireRole('principal'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Booking ID must be a positive integer.' });
  const existing = db.prepare("SELECT * FROM bookings WHERE id=? AND status='APPROVED'").get(id);
  if (!existing) return res.status(404).json({ error: 'Approved booking not found.' });
  const booking = cleanBooking(req.body || {});
  const errors = validateBooking(booking);
  if (errors.length) return res.status(400).json({ error: 'Please correct the booking details.', details: errors });
  const conflict = findConflict(db, booking, id);
  if (conflict) return res.status(409).json({ error: `Updated booking conflicts with "${conflict.event_name}" (${conflict.start_time}–${conflict.end_time}).`, conflict });
  db.prepare(`UPDATE bookings SET event_name=@event_name,department=@department,event_date=@event_date,start_time=@start_time,end_time=@end_time,contact_person=@contact_person,notes=@notes,updated_at=datetime('now') WHERE id=@id`).run({ ...booking, id });
  res.json({ booking: db.prepare('SELECT * FROM bookings WHERE id=?').get(id), message: 'Booking updated.' });
});
app.delete('/api/bookings/:id', requireAuth, requireRole('principal'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Booking ID must be a positive integer.' });
  const result = db.prepare("UPDATE bookings SET status='CANCELLED',updated_at=datetime('now') WHERE id=? AND status='APPROVED'").run(id);
  if (!result.changes) return res.status(404).json({ error: 'Approved booking not found.' });
  res.json({ message: 'Booking cancelled. It is no longer shown as an approved booking.' });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
if (require.main === module) app.listen(PORT, () => console.log(`Auditorium Coordination System running at http://localhost:${PORT}`));
module.exports = { app, db };
