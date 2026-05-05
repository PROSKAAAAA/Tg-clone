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
    // ========== ПОЛЬЗОВАТЕЛИ ==========
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
    
    // ========== КАНАЛЫ И ГРУППЫ ==========
    db.run(`CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        type TEXT,
        title TEXT,
        avatar TEXT,
        description TEXT,
        creatorId TEXT,
        members TEXT,
        createdAt INTEGER
    )`);
    
    // ========== СООБЩЕНИЯ ==========
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chatId TEXT,
        fromUserId TEXT,
        type TEXT,
        text TEXT,
        data TEXT,
        fileName TEXT,
        ts INTEGER
    )`);
    
    // ========== ПОДПИСКИ ==========
    db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
        userId TEXT,
        chatId TEXT,
        role TEXT,
        joinedAt INTEGER
    )`);
    
    // ========== ЖАЛОБЫ ==========
    db.run(`CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        fromUserId TEXT,
        againstUserId TEXT,
        reason TEXT,
        comment TEXT,
        status TEXT,
        ts INTEGER
    )`);
    
    // ========== АДМИН (ТОЛЬКО ЕСЛИ НЕТ ПОЛЬЗОВАТЕЛЕЙ) ==========
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (row && row.count === 0) {
            const hash = bcrypt.hashSync('admin2024', 10);
            db.run(`INSERT INTO users (id, name, username, password, stars, createdAt, banned, muted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                ['admin', 'Администратор', 'admin', hash, 999999, Date.now(), 0, 0]);
        }
    });
});

// ============ СТРАНИЦЫ ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'messenger.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ============ АУТЕНТИФИКАЦИЯ ============
app.post('/api/register', async (req, res) => {
    const { name, username, password } = req.body;
    if (!name || !username || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
    
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (user) return res.status(400).json({ error: 'Пользователь уже существует' });
        
        const hashed = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (id, name, username, password, stars, createdAt, banned, muted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, name, username, hashed, 100, Date.now(), 0, 0],
            (err) => {
                if (err) return res.status(500).json({ error: 'Ошибка' });
                res.json({ success: true, user: { id: username, name, username, stars: 100 } });
            });
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
                avatar: user.avatar,
                bio: user.bio,
                stars: user.stars || 0
            }
        });
    });
});

app.get('/api/users', (req, res) => {
    db.all("SELECT id, name, username, avatar, stars, banned, muted, bio FROM users", (err, users) => {
        res.json(users || []);
    });
});

app.get('/api/users/:id', (req, res) => {
    db.get("SELECT id, name, username, avatar, stars, bio FROM users WHERE id = ?", [req.params.id], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Не найден' });
        res.json(user);
    });
});

app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { stars, banned, muted, name, bio, avatar } = req.body;
    
    if (stars !== undefined) db.run("UPDATE users SET stars = ? WHERE id = ?", [stars, id]);
    if (banned !== undefined) db.run("UPDATE users SET banned = ? WHERE id = ?", [banned ? 1 : 0, id]);
    if (muted !== undefined) db.run("UPDATE users SET muted = ? WHERE id = ?", [muted ? 1 : 0, id]);
    if (name !== undefined) db.run("UPDATE users SET name = ? WHERE id = ?", [name, id]);
    if (bio !== undefined) db.run("UPDATE users SET bio = ? WHERE id = ?", [bio, id]);
    if (avatar !== undefined) db.run("UPDATE users SET avatar = ? WHERE id = ?", [avatar, id]);
    
    res.json({ success: true });
});

// ============ ЛИЧНЫЕ СООБЩЕНИЯ ============
app.get('/api/messages/:userId', (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.query.currentUserId;
    const chatId = [currentUserId, userId].sort().join('_');
    
    db.all("SELECT * FROM messages WHERE chatId = ? ORDER BY ts ASC", [chatId], (err, messages) => {
        res.json(messages || []);
    });
});

app.post('/api/messages', (req, res) => {
    const { from, to, type, text } = req.body;
    const chatId = [from, to].sort().join('_');
    const messageId = uuidv4();
    
    db.run(`INSERT INTO messages (id, chatId, fromUserId, type, text, ts) VALUES (?, ?, ?, ?, ?, ?)`,
        [messageId, chatId, from, type, text, Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

// ============ КАНАЛЫ И ГРУППЫ ============
app.post('/api/chats', (req, res) => {
    const { type, title, description, creatorId } = req.body;
    const chatId = uuidv4();
    
    db.run(`INSERT INTO chats (id, type, title, description, creatorId, members, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [chatId, type, title, description, creatorId, JSON.stringify([]), Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, chatId });
        });
});

app.get('/api/chats', (req, res) => {
    db.all("SELECT * FROM chats ORDER BY createdAt DESC", (err, chats) => {
        res.json(chats || []);
    });
});

app.get('/api/chats/:id', (req, res) => {
    db.get("SELECT * FROM chats WHERE id = ?", [req.params.id], (err, chat) => {
        if (!chat) return res.status(404).json({ error: 'Не найден' });
        res.json(chat);
    });
});

app.post('/api/chats/:id/join', (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    
    db.get("SELECT * FROM chats WHERE id = ?", [id], (err, chat) => {
        if (!chat) return res.status(404).json({ error: 'Чат не найден' });
        
        let members = [];
        try { members = JSON.parse(chat.members); } catch(e) {}
        if (!members.includes(userId)) {
            members.push(userId);
            db.run("UPDATE chats SET members = ? WHERE id = ?", [JSON.stringify(members), id]);
            db.run("INSERT INTO subscriptions (userId, chatId, role, joinedAt) VALUES (?, ?, ?, ?)", [userId, id, 'member', Date.now()]);
        }
        res.json({ success: true });
    });
});

app.get('/api/chats/:id/messages', (req, res) => {
    const { id } = req.params;
    db.all("SELECT * FROM messages WHERE chatId = ? ORDER BY ts ASC", [id], (err, messages) => {
        res.json(messages || []);
    });
});

app.post('/api/chats/:id/messages', (req, res) => {
    const { id } = req.params;
    const { fromUserId, type, text } = req.body;
    const messageId = uuidv4();
    
    db.run(`INSERT INTO messages (id, chatId, fromUserId, type, text, ts) VALUES (?, ?, ?, ?, ?, ?)`,
        [messageId, id, fromUserId, type, text, Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

// ============ ЖАЛОБЫ ============
app.get('/api/reports', (req, res) => {
    db.all("SELECT * FROM reports ORDER BY ts DESC", (err, reports) => {
        res.json(reports || []);
    });
});

app.post('/api/reports', (req, res) => {
    const { from, against, reason, comment } = req.body;
    const reportId = uuidv4();
    
    db.run(`INSERT INTO reports (id, fromUserId, againstUserId, reason, comment, status, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [reportId, from, against, reason, comment || '', 'pending', Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
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

// ============ СТАТИСТИКА ============
app.get('/api/stats', (req, res) => {
    db.get("SELECT COUNT(*) as count FROM users", (err, users) => {
        db.get("SELECT COUNT(*) as count FROM messages", (err, messages) => {
            db.get("SELECT COUNT(*) as count FROM reports", (err, reports) => {
                db.get("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'", (err, pending) => {
                    db.get("SELECT COUNT(*) as count FROM users WHERE banned = 1", (err, banned) => {
                        db.get("SELECT COUNT(*) as count FROM chats", (err, chats) => {
                            res.json({
                                users: users?.count || 0,
                                messages: messages?.count || 0,
                                reports: reports?.count || 0,
                                pendingReports: pending?.count || 0,
                                bannedUsers: banned?.count || 0,
                                chats: chats?.count || 0
                            });
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
    db.run("DELETE FROM chats");
    db.run("DELETE FROM subscriptions");
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});
