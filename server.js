'use strict';
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, scryptSync, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const derive = promisify(scrypt);
const STATUSES = ['Registered', 'Investigating', 'Resolved', 'Closed'];
const ROOT = __dirname;

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  // Same encoding as Werkzeug: existing Python-version accounts remain usable.
  return `scrypt:32768:8:1$${salt}$${hash.toString('hex')}`;
}
async function verifyPassword(stored, password) {
  try {
    const [method, salt, expected] = stored.split('$');
    if (method !== 'scrypt:32768:8:1' || !/^[a-f0-9]{128}$/.test(expected)) return false;
    const actual = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
  } catch { return false; }
}
function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'police.db'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  if (!get('SELECT id FROM officers LIMIT 1')) {
    transaction(() => {
      for (const [name, username, role] of [['Station Administrator', 'admin', 'admin'], ['Asha Rao', 'asha', 'officer'], ['Vikram Singh', 'vikram', 'officer']]) {
        run('INSERT INTO officers(name,username,password,role) VALUES(?,?,?,?)', name, username, hashPassword('Kalman@123'), role);
      }
      const pid = Number(run('INSERT INTO complainants(name,phone) VALUES(?,?)', 'Demo Citizen', '9000000000').lastInsertRowid);
      const cid = Number(run('INSERT INTO complaints(complainant_id,title,description,category,location,officer_id) VALUES(?,?,?,?,?,?)', pid, 'Missing laptop at library', 'Fictional demonstration complaint. Laptop reported missing from a study desk.', 'Theft', 'Central Library', 2).lastInsertRowid);
      run('INSERT INTO status_history(complaint_id,status,note,officer_id) VALUES(?,?,?,?)', cid, 'Registered', 'Demo complaint registered', 1);
    });
  }
  const app = express();
  app.disable('x-powered-by');
  const views = nunjucks.configure(path.join(ROOT, 'templates'), { autoescape: true, express: app, noCache: !!options.testing });
  views.addFilter('reference', value => String(value).padStart(4, '0'));
  app.set('view engine', 'html');
  app.locals.statuses = STATUSES;
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' });
    res.locals.g = { user: null }; res.locals.session = {}; res.locals.flashes = [];
    res.locals.request = { path: req.path };
    next();
  });
  app.use('/static', express.static(path.join(ROOT, 'static')));
  app.use(session({ name: 'kalman.sid', secret: randomBytes(32).toString('hex'), resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 } }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use((req, res, next) => {
    req.user = get('SELECT id,name,username,role,password FROM officers WHERE id=?', req.session.uid || 0) || null;
    req.session.csrf ||= randomBytes(24).toString('hex');
    res.locals.g.user = req.user; res.locals.session = req.session;
    next();
  });
  const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
  const field = (req, key, max = 3000) => {
    const value = typeof req.body?.[key] === 'string' ? req.body[key].trim() : '';
    if (!value || value.length > max) fail(400, `Missing or oversized field: ${key}`);
    return value;
  };
  const id = value => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) fail(404, 'Record not found.'); return n; };
  const officer = req => {
    const oid = Number(req.body?.officer_id);
    if (!Number.isSafeInteger(oid) || !get('SELECT id FROM officers WHERE id=?', oid)) fail(400, 'Choose a valid officer.');
    return oid;
  };
  const auth = (req, res, next) => req.user ? next() : res.redirect('/login');
  const csrf = (req, res, next) => {
    const expected = Buffer.from(req.session.csrf || '');
    const actual = Buffer.from(typeof req.body?.csrf === 'string' ? req.body.csrf : '');
    if (!actual.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return next(Object.assign(new Error('Invalid form token. Reload the page and try again.'), { status: 400 }));
    next();
  };
  app.use((req, res, next) => req.method === 'POST' && !(req.is('multipart/form-data') && /^\/complaints\/[1-9]\d*\/evidence$/.test(req.path)) ? csrf(req, res, next) : next());
  const flash = (req, text, category = 'message') => { (req.session.flashes ||= []).push([category, text]); };
  const render = (req, res, view, values = {}) => {
    res.locals.flashes = req.session.flashes || []; delete req.session.flashes;
    return res.render(view, values);
  };
  const caseRecord = (req, cid, write = false) => {
    const c = get('SELECT c.*,p.name,p.phone,o.name officer FROM complaints c JOIN complainants p ON p.id=c.complainant_id JOIN officers o ON o.id=c.officer_id WHERE c.id=?', id(cid));
    if (!c) fail(404, 'Complaint not found.');
    if (write && req.user.role !== 'admin' && c.officer_id !== req.user.id) fail(403, 'Only the assigned officer or administrator can modify this complaint.');
    return c;
  };
  const caseData = (req, cid) => {
    const c = caseRecord(req, cid);
    const evidence = all('SELECT id,label,kind,filename,sha256,created_at FROM evidence WHERE complaint_id=?', c.id);
    const custody = all('SELECT h.*,e.label,o.name holder,r.name recorder FROM custody h JOIN evidence e ON e.id=h.evidence_id JOIN officers o ON o.id=h.officer_id JOIN officers r ON r.id=h.recorded_by WHERE e.complaint_id=? ORDER BY h.id DESC', c.id);
    const history = all('SELECT h.*,o.name FROM status_history h JOIN officers o ON o.id=h.officer_id WHERE complaint_id=? ORDER BY h.id DESC', c.id);
    const current = {}; for (const h of [...custody].reverse()) current[h.evidence_id] = h;
    return { c, evidence, custody, history, current, officers: all('SELECT id,name,role FROM officers'), can_edit: req.user.role === 'admin' || c.officer_id === req.user.id };
  };
  app.get('/login', (req, res) => render(req, res, 'login.html'));
  app.post('/login', async (req, res, next) => {
    const username = typeof req.body.username === 'string' ? req.body.username : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = get('SELECT * FROM officers WHERE username=?', username);
    if (!user || password.length > 128 || !(await verifyPassword(user.password, password))) {
      flash(req, 'Incorrect username or password.', 'error'); return render(req, res, 'login.html');
    }
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.uid = user.id; req.session.csrf = randomBytes(24).toString('hex');
      res.redirect('/');
    });
  });
  app.post('/logout', (req, res, next) => req.session.destroy(err => err ? next(err) : res.clearCookie('kalman.sid').redirect('/login')));
  app.get('/', auth, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const st = typeof req.query.status === 'string' ? req.query.status : '';
    const reference = q.toUpperCase().replace(/^CMP-/, '').replace(/^0+/, '') || '0';
    const rows = all("SELECT c.*,o.name officer,p.name citizen FROM complaints c JOIN officers o ON o.id=c.officer_id JOIN complainants p ON p.id=c.complainant_id WHERE (c.title LIKE ? OR CAST(c.id AS TEXT)=? OR p.name LIKE ?) AND (?='' OR c.status=?) ORDER BY c.id DESC", `%${q}%`, reference, `%${q}%`, st, st);
    const counts = STATUSES.map(s => [s, get('SELECT COUNT(*) n FROM complaints WHERE status=?', s).n]);
    render(req, res, 'index.html', { rows, counts, q, st });
  });
  app.get('/complaints/new', auth, (req, res) => render(req, res, 'new.html', { c: null, officers: all('SELECT id,name,role FROM officers') }));
  app.post('/complaints/new', auth, (req, res) => {
    const values = [field(req, 'title', 150), field(req, 'description'), field(req, 'category', 60), field(req, 'location', 200), officer(req)];
    const name = field(req, 'name', 100), phone = field(req, 'phone', 30);
    const cid = transaction(() => {
      const pid = Number(run('INSERT INTO complainants(name,phone) VALUES(?,?)', name, phone).lastInsertRowid);
      const cid = Number(run('INSERT INTO complaints(complainant_id,title,description,category,location,officer_id) VALUES(?,?,?,?,?,?)', pid, ...values).lastInsertRowid);
      run('INSERT INTO status_history(complaint_id,status,note,officer_id) VALUES(?,?,?,?)', cid, 'Registered', 'Complaint registered', req.user.id);
      return cid;
    });
    res.redirect(`/complaints/${cid}`);
  });
  app.get('/complaints/:cid', auth, (req, res) => render(req, res, 'detail.html', { ...caseData(req, req.params.cid), tab: ['overview', 'evidence', 'custody', 'history'].includes(req.query.tab) ? req.query.tab : 'overview' }));
  app.post('/complaints/:cid/status', auth, (req, res) => {
    const c = caseRecord(req, req.params.cid, true), status = field(req, 'status'), note = field(req, 'note'), oid = officer(req);
    if (!STATUSES.includes(status)) fail(400, 'Invalid complaint status.');
    if (c.officer_id !== oid && req.user.role !== 'admin') fail(403, 'Only administrators can reassign complaints.');
    transaction(() => {
      run('UPDATE complaints SET status=?,officer_id=? WHERE id=?', status, oid, c.id);
      run('INSERT INTO status_history(complaint_id,status,note,officer_id) VALUES(?,?,?,?)', c.id, status, note + ' — Assigned to ' + get('SELECT name FROM officers WHERE id=?', oid).name, req.user.id);
    });
    flash(req, 'Complaint updated.'); res.redirect(`/complaints/${c.id}`);
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10, fieldSize: 10000, parts: 12 } });
  app.post('/complaints/:cid/evidence', auth, upload.single('file'), csrf, (req, res) => {
    const c = caseRecord(req, req.params.cid, true), label = field(req, 'label', 150), kind = field(req, 'kind', 60), location = field(req, 'location', 200), oid = officer(req);
    if (req.file && !req.file.size) fail(400, 'The attached file is empty.');
    const content = req.file ? req.file.buffer : null;
    const filename = req.file ? (req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'attachment.bin') : null;
    transaction(() => {
      const eid = Number(run('INSERT INTO evidence(complaint_id,label,kind,filename,content,sha256) VALUES(?,?,?,?,?,?)', c.id, label, kind, filename, content, content ? createHash('sha256').update(content).digest('hex') : null).lastInsertRowid);
      run('INSERT INTO custody(evidence_id,officer_id,location,purpose,recorded_by) VALUES(?,?,?,?,?)', eid, oid, location, 'Initial collection', req.user.id);
    });
    flash(req, 'Evidence registered.'); res.redirect(`/complaints/${c.id}?tab=evidence`);
  });
  app.post('/evidence/:eid/transfer', auth, (req, res) => {
    const e = get('SELECT id,complaint_id FROM evidence WHERE id=?', id(req.params.eid));
    if (!e) fail(404, 'Evidence not found.');
    caseRecord(req, e.complaint_id, true);
    run('INSERT INTO custody(evidence_id,officer_id,location,purpose,recorded_by) VALUES(?,?,?,?,?)', e.id, officer(req), field(req, 'location', 200), field(req, 'purpose'), req.user.id);
    flash(req, 'Custody transfer recorded.'); res.redirect(`/complaints/${e.complaint_id}?tab=custody`);
  });
  app.get('/evidence/:eid/download', auth, (req, res) => {
    const e = get('SELECT filename,content,sha256 FROM evidence WHERE id=?', id(req.params.eid));
    if (!e || e.content === null) fail(404, 'Attachment not found.');
    const content = Buffer.from(e.content);
    if (createHash('sha256').update(content).digest('hex') !== e.sha256) fail(409, 'Integrity check failed. The stored file has changed.');
    res.attachment(e.filename).type('application/octet-stream').send(content);
  });
  app.get('/evidence', auth, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rows = all("SELECT e.id,e.complaint_id,e.label,e.kind,e.filename,e.created_at,c.title,o.name holder,h.location FROM evidence e JOIN complaints c ON c.id=e.complaint_id LEFT JOIN custody h ON h.id=(SELECT MAX(id) FROM custody WHERE evidence_id=e.id) LEFT JOIN officers o ON o.id=h.officer_id WHERE e.label LIKE ? OR c.title LIKE ? OR ('EV-' || e.id)=? ORDER BY e.id DESC", `%${q}%`, `%${q}%`, q.toUpperCase());
    render(req, res, 'evidence.html', { rows, q });
  });
  app.get('/complaints/:cid/edit', auth, (req, res) => render(req, res, 'new.html', { c: caseRecord(req, req.params.cid, true), officers: all('SELECT id,name,role FROM officers') }));
  app.post('/complaints/:cid/edit', auth, (req, res) => {
    const c = caseRecord(req, req.params.cid, true);
    const vals = [field(req, 'title', 150), field(req, 'description'), field(req, 'category', 60), field(req, 'location', 200)];
    const name = field(req, 'name', 100), phone = field(req, 'phone', 30);
    transaction(() => {
      run('UPDATE complaints SET title=?,description=?,category=?,location=? WHERE id=?', ...vals, c.id);
      let pid = c.complainant_id;
      if (get('SELECT COUNT(*) n FROM complaints WHERE complainant_id=?', pid).n > 1) pid = Number(run('INSERT INTO complainants(name,phone) VALUES(?,?)', name, phone).lastInsertRowid);
      else run('UPDATE complainants SET name=?,phone=? WHERE id=?', name, phone, pid);
      run('UPDATE complaints SET complainant_id=? WHERE id=?', pid, c.id);
      run('INSERT INTO status_history(complaint_id,status,note,officer_id) VALUES(?,?,?,?)', c.id, c.status, 'Complaint details corrected', req.user.id);
    });
    flash(req, 'Complaint details saved.'); res.redirect(`/complaints/${c.id}`);
  });
  app.get('/complaints/:cid/print', auth, (req, res) => {
    const values = caseData(req, req.params.cid); values.custody.reverse(); values.history.reverse();
    render(req, res, 'print.html', values);
  });
  app.get('/reports.csv', auth, (req, res) => {
    const rows = all('SELECT c.id,c.title,c.status,o.name,COUNT(e.id) evidence_count,c.created_at FROM complaints c JOIN officers o ON o.id=c.officer_id LEFT JOIN evidence e ON e.complaint_id=c.id GROUP BY c.id ORDER BY c.id');
    const cell = value => { let s = String(value); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const data = [['Complaint ID', 'Title', 'Status', 'Officer', 'Evidence count', 'Registered (UTC)'], ...rows.map(r => [r.id, r.title, r.status, r.name, r.evidence_count, r.created_at])];
    res.attachment('complaint-report.csv').type('text/csv').send(data.map(row => row.map(cell).join(',')).join('\r\n'));
  });
  app.get('/officers', auth, (req, res) => render(req, res, 'officers.html', { rows: all("SELECT o.id,o.name,o.username,o.role,COUNT(c.id) assigned FROM officers o LEFT JOIN complaints c ON c.officer_id=o.id AND c.status!='Closed' GROUP BY o.id ORDER BY o.id") }));
  app.post('/officers', auth, (req, res) => {
    if (req.user.role !== 'admin') fail(403, 'Administrator access is required.');
    const name = field(req, 'name', 100), username = field(req, 'username', 40).toLowerCase(), password = field(req, 'password', 128);
    if (password.length < 8) fail(400, 'Use at least 8 characters for the password.');
    if (!/^[a-z0-9_]+$/.test(username)) fail(400, 'Username may contain only letters, numbers and underscores.');
    if (get('SELECT id FROM officers WHERE username=?', username)) fail(400, 'That username is already taken.');
    run('INSERT INTO officers(name,username,password,role) VALUES(?,?,?,?)', name, username, hashPassword(password), 'officer');
    flash(req, 'Officer added. They can now sign in.'); res.redirect('/officers');
  });
  app.get('/account', auth, (req, res) => render(req, res, 'account.html'));
  app.post('/account', auth, async (req, res) => {
    const current = typeof req.body.current === 'string' ? req.body.current : '';
    if (current.length > 128 || !(await verifyPassword(req.user.password, current))) fail(400, 'Current password is incorrect.');
    const password = field(req, 'password', 128);
    if (password.length < 8) fail(400, 'Use at least 8 characters.');
    if (password !== req.body.confirm) fail(400, 'The new passwords do not match.');
    run('UPDATE officers SET password=? WHERE id=?', hashPassword(password), req.user.id);
    flash(req, 'Password changed.'); res.redirect('/account');
  });
  app.use((req, res, next) => next(Object.assign(new Error('Page not found.'), { status: 404 })));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const code = error instanceof multer.MulterError ? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : error.status || 500;
    if (code === 500) console.error(error);
    const message = code === 413 ? 'Choose an attachment no larger than 10 MB.' : code === 500 ? 'An unexpected error occurred. See the terminal for details.' : error.message;
    res.status(code).render('error.html', { code, message });
  });
  return { app, db, close: () => db.close() };
}
module.exports = { createApp, hashPassword, verifyPassword };
