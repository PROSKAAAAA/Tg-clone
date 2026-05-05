const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('tg_clone.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        username TEXT UNIQUE,
        password TEXT,
        avatar TEXT,
        bio TEXT,
        stars INTEGER DEFAULT 100,
        tags TEXT,
        muted INTEGER DEFAULT 0,
        banned INTEGER DEFAULT 0,
        createdAt INTEGER
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chatKey TEXT,
        fromUserId TEXT,
        toUserId TEXT,
        type TEXT,
        text TEXT,
        data TEXT,
        fileName TEXT,
        fileSize TEXT,
        ts INTEGER,
        read INTEGER DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        fromUserId TEXT,
        againstUserId TEXT,
        reason TEXT,
        comment TEXT,
        status TEXT,
        ts INTEGER
    )`);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'messenger.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/register', async (req, res) => {
    const { name, username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (user) return res.status(400).json({ error: 'Пользователь уже существует' });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (id, name, username, password, stars, createdAt, banned, muted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, name, username, hashedPassword, 100, Date.now(), 0, 0],
            (err) => {
                if (err) return res.status(500).json({ error: 'Ошибка' });
                res.json({ success: true, user: { id: username, name, username, stars: 100 } });
            }
        );
    });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
        
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(400).json({ error: 'Неверный пароль' });
        if (user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
        
        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                stars: user.stars || 0
            }
        });
    });
});

app.get('/api/users', (req, res) => {
    db.all("SELECT id, name, username, stars, banned, muted FROM users", (err, users) => {
        if (err) return res.status(500).json([]);
        res.json(users);
    });
});

app.get('/api/users/:id', (req, res) => {
    db.get("SELECT * FROM users WHERE id = ?", [req.params.id], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Не найден' });
        res.json(user);
    });
});

app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { stars, banned, muted, name } = req.body;
    
    if (stars !== undefined) db.run("UPDATE users SET stars = ? WHERE id = ?", [stars, id]);
    if (banned !== undefined) db.run("UPDATE users SET banned = ? WHERE id = ?", [banned ? 1 : 0, id]);
    if (muted !== undefined) db.run("UPDATE users SET muted = ? WHERE id = ?", [muted ? 1 : 0, id]);
    if (name !== undefined) db.run("UPDATE users SET name = ? WHERE id = ?", [name, id]);
    
    res.json({ success: true });
});

app.get('/api/messages/:userId', (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.query.currentUserId;
    const chatKey = [currentUserId, userId].sort().join('_');
    
    db.all("SELECT * FROM messages WHERE chatKey = ? ORDER BY ts ASC", [chatKey], (err, messages) => {
        res.json(messages || []);
    });
});

app.post('/api/messages', (req, res) => {
    const { from, to, type, text } = req.body;
    const chatKey = [from, to].sort().join('_');
    const messageId = uuidv4();
    
    db.run(`INSERT INTO messages (id, chatKey, fromUserId, toUserId, type, text, ts, read)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [messageId, chatKey, from, to, type, text || null, Date.now(), 0],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.get('/api/messages/all', (req, res) => {
    db.all("SELECT * FROM messages ORDER BY ts DESC LIMIT 200", (err, messages) => {
        res.json(messages || []);
    });
});

app.get('/api/reports', (req, res) => {
    db.all("SELECT * FROM reports ORDER BY ts DESC", (err, reports) => {
        res.json(reports || []);
    });
});

app.post('/api/reports', (req, res) => {
    const { from, against, reason, comment } = req.body;
    const reportId = uuidv4();
    
    db.run(`INSERT INTO reports (id, fromUserId, againstUserId, reason, comment, status, ts)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [reportId, from, against, reason, comment || '', 'pending', Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.put('/api/reports/:id', (req, res) => {
    const { id } = req.params;
    const { status, action } = req.body;
    
    db.run("UPDATE reports SET status = ? WHERE id = ?", [status, id], (err) => {
        if (action === 'ban') {
            db.get("SELECT againstUserId FROM reports WHERE id = ?", [id], (err, report) => {
                if (report) db.run("UPDATE users SET banned = 1 WHERE id = ?", [report.againstUserId]);
            });
        }
        if (action === 'mute') {
            db.get("SELECT againstUserId FROM reports WHERE id = ?", [id], (err, report) => {
                if (report) db.run("UPDATE users SET muted = 1 WHERE id = ?", [report.againstUserId]);
            });
        }
        res.json({ success: true });
    });
});

app.get('/api/stats', (req, res) => {
    db.get("SELECT COUNT(*) as count FROM users", (err, users) => {
        db.get("SELECT COUNT(*) as count FROM messages", (err, messages) => {
            db.get("SELECT COUNT(*) as count FROM reports", (err, reports) => {
                db.get("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'", (err, pending) => {
                    db.get("SELECT COUNT(*) as count FROM users WHERE banned = 1", (err, banned) => {
                        res.json({
                            users: users?.count || 0,
                            messages: messages?.count || 0,
                            reports: reports?.count || 0,
                            pendingReports: pending?.count || 0,
                            bannedUsers: banned?.count || 0
                        });
                    });
                });
            });
        });
    });
});

app.post('/api/admin/reset', (req, res) => {
    db.run("DELETE FROM users");
    db.run("DELETE FROM messages");
    db.run("DELETE FROM reports");
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📱 Мессенджер: http://localhost:${PORT}/`);
    console.log(`🛡️ Админка: http://localhost:${PORT}/admin.html`);
    console.log(`🔑 Админ пароль: admin2024`);
});
