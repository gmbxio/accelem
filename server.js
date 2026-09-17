require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const session = require('cookie-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');

const app = express();
app.set('trust proxy', 1);
const port = Number(process.env.PORT || 3003);
const dataDirectory = process.env.DATA_DIR || __dirname;
fs.mkdirSync(dataDirectory, { recursive: true });
const database = new Database(path.join(dataDirectory, 'accelem.db'));

database.pragma('journal_mode = WAL');
database.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'admin')),
        business_name TEXT,
        service TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        service TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Planning',
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        due_date TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS project_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`);

function addColumnIfMissing(table, column, definition) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('projects', 'cost_cents', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('projects', 'paid_cents', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('projects', 'payment_due_date', 'TEXT');

database.prepare('PRAGMA foreign_keys = ON').run();

const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminEmail && adminPassword) {
    const passwordHash = bcrypt.hashSync(adminPassword, 12);
    const existingAdmin = database.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
    if (existingAdmin) {
        database.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?').run(passwordHash, 'admin', existingAdmin.id);
    } else {
        database.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run('Accelem owner', adminEmail, passwordHash, 'admin');
    }
    console.log(`Admin account created for ${adminEmail}`);
}

const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
}) : null;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
    name: 'accelem-session',
    keys: [process.env.SESSION_SECRET || 'development-only-secret'],
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7
}));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'basic.html')));
app.use(express.static(__dirname));

function cleanUser(user) {
    if (!user) return null;
    return { id: user.id, name: user.name, email: user.email, role: user.role, businessName: user.business_name, service: user.service };
}

function requireAuth(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ error: 'You must be logged in.' });
    next();
}

function requireAdmin(req, res, next) {
    const user = database.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    next();
}

async function notifyOwner(client) {
    if (!mailer || !process.env.ADMIN_EMAIL) {
        console.log(`New Accelem client: ${client.name} <${client.email}> - ${client.service || 'unspecified service'}`);
        return;
    }
    await mailer.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to: process.env.ADMIN_EMAIL,
        subject: `New Accelem client: ${client.name}`,
        text: `${client.name} (${client.email}) signed up for ${client.service || 'a conversation'}. Business: ${client.businessName || 'Not provided'}.`
    });
}

app.post('/api/auth/signup', async (req, res) => {
    const { name, email, password, businessName, service } = req.body;
    if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Name, email, and a password of at least 8 characters are required.' });
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = database.prepare('INSERT INTO users (name, email, password_hash, business_name, service) VALUES (?, ?, ?, ?, ?)').run(name.trim(), email.trim().toLowerCase(), passwordHash, businessName?.trim() || null, service || null);
        req.session.userId = result.lastInsertRowid;
        const client = database.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
        notifyOwner({ ...client, businessName: client.business_name }).catch((error) => console.error('Email notification failed:', error.message));
        res.status(201).json({ user: cleanUser(client) });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'An account with that email already exists.' });
        res.status(500).json({ error: 'Could not create the account.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = database.prepare('SELECT * FROM users WHERE email = ?').get(email?.trim().toLowerCase());
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    req.session.userId = user.id;
    res.json({ user: cleanUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
    req.session = null;
    res.json({ success: true });
});
app.get('/api/auth/me', (req, res) => res.json({ user: cleanUser(database.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId)) }));
app.post('/api/auth/reset', (req, res) => res.json({ success: true, message: 'If that email exists, reset instructions are on their way.' }));

app.get('/api/projects', requireAuth, (req, res) => {
    const user = database.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    const projects = user.role === 'admin'
        ? database.prepare(`SELECT projects.*, users.name AS client_name, users.email AS client_email, CASE WHEN projects.status = 'Completed' THEN 'old' WHEN projects.status = 'Planning' THEN 'upcoming' ELSE 'current' END AS category FROM projects JOIN users ON users.id = projects.client_id ORDER BY projects.updated_at DESC`).all()
        : database.prepare(`SELECT *, CASE WHEN status = 'Completed' THEN 'old' WHEN status = 'Planning' THEN 'upcoming' ELSE 'current' END AS category FROM projects WHERE client_id = ? ORDER BY updated_at DESC`).all(req.session.userId);
    const summary = projects.reduce((totals, project) => ({ costCents: totals.costCents + project.cost_cents, paidCents: totals.paidCents + project.paid_cents }), { costCents: 0, paidCents: 0 });
    res.json({ projects, summary: { ...summary, dueCents: summary.costCents - summary.paidCents } });
});

app.get('/api/projects/:id/updates', requireAuth, (req, res) => {
    const project = database.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    const currentUser = database.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!project || (currentUser.role !== 'admin' && project.client_id !== req.session.userId)) return res.status(404).json({ error: 'Project not found.' });
    res.json({ updates: database.prepare('SELECT * FROM project_updates WHERE project_id = ? ORDER BY created_at DESC').all(project.id) });
});

app.post('/api/projects', requireAdmin, (req, res) => {
    const { clientId, title, service, dueDate, costCents, paidCents, paymentDueDate } = req.body;
    if (!clientId || !title || !service) return res.status(400).json({ error: 'Client, title, and service are required.' });
    const cost = Math.max(0, Math.round(Number(costCents) || 0));
    const paid = Math.min(cost, Math.max(0, Math.round(Number(paidCents) || 0)));
    const result = database.prepare('INSERT INTO projects (client_id, title, service, due_date, cost_cents, paid_cents, payment_due_date) VALUES (?, ?, ?, ?, ?, ?, ?)').run(clientId, title, service, dueDate || null, cost, paid, paymentDueDate || null);
    res.status(201).json({ project: database.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) });
});

app.patch('/api/projects/:id', requireAdmin, (req, res) => {
    const { status, progress, dueDate, costCents, paidCents, paymentDueDate } = req.body;
    const current = database.prepare('SELECT cost_cents, paid_cents FROM projects WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Project not found.' });
    const cost = costCents === undefined ? current.cost_cents : Math.max(0, Math.round(Number(costCents) || 0));
    const paid = paidCents === undefined ? current.paid_cents : Math.min(cost, Math.max(0, Math.round(Number(paidCents) || 0)));
    const result = database.prepare('UPDATE projects SET status = COALESCE(?, status), progress = COALESCE(?, progress), due_date = COALESCE(?, due_date), cost_cents = ?, paid_cents = ?, payment_due_date = COALESCE(?, payment_due_date), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, progress === undefined ? null : Number(progress), dueDate || null, cost, paid, paymentDueDate || null, req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Project not found.' });
    res.json({ project: database.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id) });
});

app.post('/api/projects/:id/updates', requireAdmin, (req, res) => {
    if (!req.body.message?.trim()) return res.status(400).json({ error: 'An update message is required.' });
    const project = database.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    database.prepare('INSERT INTO project_updates (project_id, message) VALUES (?, ?)').run(project.id, req.body.message.trim());
    database.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(project.id);
    res.status(201).json({ success: true });
});

app.delete('/api/projects/:id', requireAdmin, (req, res) => {
    const result = database.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Project not found.' });
    res.json({ success: true });
});

app.get('/api/admin/clients', requireAdmin, (req, res) => {
    res.json({ clients: database.prepare("SELECT id, name, email, business_name, service, created_at FROM users WHERE role = 'client' ORDER BY created_at DESC").all() });
});

app.delete('/api/admin/clients/:id', requireAdmin, (req, res) => {
    const result = database.prepare("DELETE FROM users WHERE id = ? AND role = 'client'").run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Client not found.' });
    res.json({ success: true });
});

app.post('/api/admin/clients', requireAdmin, async (req, res) => {
    const { name, email, password, businessName, service } = req.body;
    if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Name, email, and a password of at least 8 characters are required.' });
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = database.prepare('INSERT INTO users (name, email, password_hash, business_name, service) VALUES (?, ?, ?, ?, ?)').run(name.trim(), email.trim().toLowerCase(), passwordHash, businessName?.trim() || null, service || null);
        res.status(201).json({ client: database.prepare('SELECT id, name, email, business_name, service, created_at FROM users WHERE id = ?').get(result.lastInsertRowid) });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'An account with that email already exists.' });
        res.status(500).json({ error: 'Could not create the client.' });
    }
});

const server = app.listen(port, () => console.log(`Accelem is running at http://localhost:${port}/basic.html`));
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Change PORT in .env or stop the process using it.`);
        process.exit(1);
    }
    throw error;
});
