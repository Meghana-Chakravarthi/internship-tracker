const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const session = require('express-session');

const VALID_STATUSES = ['Applied', 'Interview', 'Offer'];
const PASSWORD_KEY_LENGTH = 64;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;

class SqliteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    this.getStatement = database.prepare(
      'SELECT session_data FROM sessions WHERE session_id = ? AND expires_at > ?'
    );
    this.setStatement = database.prepare(`
      INSERT INTO sessions (session_id, session_data, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        session_data = excluded.session_data,
        expires_at = excluded.expires_at
    `);
    this.destroyStatement = database.prepare(
      'DELETE FROM sessions WHERE session_id = ?'
    );
    this.touchStatement = database.prepare(
      'UPDATE sessions SET expires_at = ? WHERE session_id = ?'
    );
    this.deleteExpiredStatement = database.prepare(
      'DELETE FROM sessions WHERE expires_at <= ?'
    );
  }

  get(sessionId, callback) {
    try {
      const row = this.getStatement.get(sessionId, Date.now());
      callback(null, row ? JSON.parse(row.session_data) : null);
    } catch (error) {
      callback(error);
    }
  }

  set(sessionId, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000;
      this.setStatement.run(sessionId, JSON.stringify(sessionData), expiresAt);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sessionId, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000;
      this.touchStatement.run(expiresAt, sessionId);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sessionId, callback = () => {}) {
    try {
      this.destroyStatement.run(sessionId);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  clearExpiredSessions() {
    this.deleteExpiredStatement.run(Date.now());
  }
}

function createApp(options = {}) {
  const dataDirectory = options.dataDirectory || process.env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dataDirectory, { recursive: true });

  const databasePath = options.databasePath || path.join(dataDirectory, 'internship-tracker.sqlite');
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Applied',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS applications_by_user
      ON applications(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      session_data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at);
  `);

  const app = express();
  const publicDirectory = path.join(__dirname, 'public');
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && (!sessionSecret || sessionSecret.length < 32)) {
    database.close();
    throw new Error('SESSION_SECRET must contain at least 32 characters when NODE_ENV=production');
  }
  if (!sessionSecret) {
    console.warn('SESSION_SECRET is unset; sessions will be invalidated when the server restarts.');
  }

  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
  }
  app.use(express.json({ limit: '10kb' }));
  const sessionStore = new SqliteSessionStore(database);
  app.use(session({
    name: 'internship.sid',
    secret: sessionSecret || crypto.randomBytes(48).toString('hex'),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 30 * 24 * 60 * 60 * 1000
    }
  }));

  app.get('/api/health', (req, res) => {
    try {
      database.prepare('SELECT 1').get();
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(503).json({ status: 'error' });
    }
  });

  app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.sendFile(path.join(publicDirectory, 'login.html'));
  });

  app.get('/login.html', (req, res) => res.redirect('/login'));
  app.get('/index.html', (req, res) => res.redirect('/'));

  app.get('/', (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.sendFile(path.join(publicDirectory, 'index.html'));
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = database.prepare('SELECT id, username FROM users WHERE id = ?')
      .get(req.session.userId);
    if (!user) {
      return req.session.destroy(() => {
        res.clearCookie('internship.sid');
        res.status(401).json({ error: 'Authentication required' });
      });
    }
    res.status(200).json({ user });
  });

  app.post('/api/auth/register', async (req, res, next) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!USERNAME_PATTERN.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3–32 characters using letters, numbers, dots, hyphens, or underscores.'
      });
    }
    if (password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be between 10 and 128 characters.' });
    }

    try {
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = await hashPassword(password, salt);
      const user = { id: crypto.randomUUID(), username };

      try {
        database.prepare(`
          INSERT INTO users (id, username, password_salt, password_hash)
          VALUES (?, ?, ?, ?)
        `).run(user.id, user.username, salt, passwordHash.toString('hex'));
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(409).json({ error: 'That username is already taken.' });
        }
        throw error;
      }

      await regenerateSession(req);
      req.session.userId = user.id;
      await saveSession(req);
      res.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const userRecord = database.prepare(`
      SELECT id, username, password_salt, password_hash
      FROM users WHERE username = ? COLLATE NOCASE
    `).get(username);

    try {
      const salt = userRecord?.password_salt || 'invalid-user-login-salt';
      const candidate = await hashPassword(password, salt);
      const expected = userRecord
        ? Buffer.from(userRecord.password_hash, 'hex')
        : Buffer.alloc(PASSWORD_KEY_LENGTH);
      const valid = candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);

      if (!userRecord || !valid) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      await regenerateSession(req);
      req.session.userId = userRecord.id;
      await saveSession(req);
      res.status(200).json({
        user: { id: userRecord.id, username: userRecord.username }
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', (req, res, next) => {
    if (!req.session.userId) {
      res.clearCookie('internship.sid', { sameSite: 'strict' });
      return res.status(204).send();
    }
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('internship.sid', { sameSite: 'strict' });
      res.status(204).send();
    });
  });

  app.use('/api/applications', (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  });

  app.get('/api/applications', (req, res) => {
    const applications = database.prepare(`
      SELECT id, company, role, status
      FROM applications WHERE user_id = ?
      ORDER BY created_at DESC, rowid DESC
    `).all(req.session.userId);
    res.status(200).json(applications);
  });

  app.post('/api/applications', (req, res) => {
    const company = typeof req.body?.company === 'string' ? req.body.company.trim() : '';
    const role = typeof req.body?.role === 'string' ? req.body.role.trim() : '';

    if (!company || !role) {
      return res.status(400).json({ error: 'company and role are required' });
    }
    if (company.length > 120 || role.length > 120) {
      return res.status(400).json({ error: 'company and role must be 120 characters or fewer' });
    }

    const application = {
      id: crypto.randomUUID(),
      company,
      role,
      status: 'Applied'
    };
    database.prepare(`
      INSERT INTO applications (id, user_id, company, role, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(application.id, req.session.userId, company, role, application.status);
    res.status(201).json(application);
  });

  app.put('/api/applications/:id', (req, res) => {
    const status = req.body?.status;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: 'status must be one of: ' + VALID_STATUSES.join(', ')
      });
    }

    const result = database.prepare(`
      UPDATE applications SET status = ?
      WHERE id = ? AND user_id = ?
    `).run(status, req.params.id, req.session.userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const application = database.prepare(`
      SELECT id, company, role, status FROM applications WHERE id = ?
    `).get(req.params.id);
    res.status(200).json(application);
  });

  app.delete('/api/applications/:id', (req, res) => {
    const result = database.prepare(`
      DELETE FROM applications WHERE id = ? AND user_id = ?
    `).run(req.params.id, req.session.userId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }
    res.status(204).send();
  });

  app.use(express.static(publicDirectory, { index: false }));

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    console.error('Request failed:', error);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Server error' });
  });

  const cleanupTimer = setInterval(() => sessionStore.clearExpiredSessions(), 60 * 60 * 1000);
  cleanupTimer.unref();

  return {
    app,
    close() {
      clearInterval(cleanupTimer);
      database.close();
    }
  };
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, PASSWORD_KEY_LENGTH, (error, key) => {
      if (error) return reject(error);
      resolve(key);
    });
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

// Create the Express application
const application = createApp();
const app = application.app;

// Export the Express app for Vercel
module.exports = app;

// Start a normal HTTP server when running locally
if (require.main === module) {
  let application;

  try {
    application = createApp();
  } catch (error) {
    console.error('Unable to start Internship Tracker:', error.message);
    process.exitCode = 1;
  }

  if (application) {
    const PORT = process.env.PORT || 3000;

    const server = application.app.listen(PORT, () => {
      console.log(`Internship Tracker running on port ${PORT}`);
    });

    const shutdown = () => {
      server.close(() => {
        application.close();
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

module.exports = { createApp };