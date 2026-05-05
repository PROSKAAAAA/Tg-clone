const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============ БАЗА ДАННЫХ ============
const db = new sqlite3.Database('tg_clone.db');

db.serialize(() => {
    // Пользователи
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
    
    // Сообщения
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
        giftName TEXT,
        giftEmoji TEXT,
        ts INTEGER,
        read INTEGER DEFAULT 0
    )`);
    
    // Жалобы
    db.run(`CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        fromUserId TEXT,
        againstUserId TEXT,
        reason TEXT,
        comment TEXT,
        status TEXT,
        ts INTEGER
    )`);
    
    // Подарки
    db.run(`CREATE TABLE IF NOT EXISTS gifts (
        id TEXT PRIMARY KEY,
        name TEXT,
        emoji TEXT,
        type TEXT,
        price INTEGER,
        stock INTEGER
    )`);
    
    // Добавляем подарки если пусто
    db.get("SELECT COUNT(*) as count FROM gifts", (err, row) => {
        if (row.count === 0) {
            const gifts = [
                ['g1', 'Сердечко', '❤️', 'emoji', 50, 100],
                ['g2', 'Корона', '👑', 'emoji', 200, 50],
                ['g3', 'Звезда', '⭐', 'emoji', 100, 200],
                ['g4', 'Ракета', '🚀', 'gif', 150, 75],
                ['g5', 'Торт', '🎂', 'emoji', 80, 120],
                ['g6', 'Бриллиант', '💎', 'tgs', 500, 20]
            ];
            const stmt = db.prepare("INSERT INTO gifts VALUES (?, ?, ?, ?, ?, ?)");
            gifts.forEach(g => stmt.run(g));
            stmt.finalize();
        }
    });
});

// ============ API РОУТЫ ============

// ----- Аутентификация -----
app.post('/api/register', async (req, res) => {
    const { name, username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (user) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = username;
        const now = Date.now();
        
        db.run(`INSERT INTO users (id, name, username, password, stars, createdAt, banned, muted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, name, username, hashedPassword, 100, now, 0, 0],
            (err) => {
                if (err) return res.status(500).json({ error: 'Ошибка' });
                res.json({ success: true, user: { id: userId, name, username, stars: 100 } });
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
                avatar: user.avatar,
                stars: user.stars,
                bio: user.bio,
                tags: user.tags ? JSON.parse(user.tags) : []
            }
        });
    });
});

// ----- Получить всех пользователей -----
app.get('/api/users', (req, res) => {
    db.all("SELECT id, name, username, avatar, stars, tags, banned, muted, bio FROM users", (err, users) => {
        users.forEach(u => {
            if (u.tags) u.tags = JSON.parse(u.tags);
        });
        res.json(users);
    });
});

// ----- Обновить пользователя (админ) -----
app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const updates = [];
    const values = [];
    
    if (req.body.name !== undefined) { updates.push("name = ?"); values.push(req.body.name); }
    if (req.body.bio !== undefined) { updates.push("bio = ?"); values.push(req.body.bio); }
    if (req.body.avatar !== undefined) { updates.push("avatar = ?"); values.push(req.body.avatar); }
    if (req.body.tags !== undefined) { updates.push("tags = ?"); values.push(JSON.stringify(req.body.tags)); }
    if (req.body.banned !== undefined) { updates.push("banned = ?"); values.push(req.body.banned ? 1 : 0); }
    if (req.body.muted !== undefined) { updates.push("muted = ?"); values.push(req.body.muted ? 1 : 0); }
    if (req.body.stars !== undefined) { updates.push("stars = ?"); values.push(req.body.stars); }
    
    if (updates.length === 0) return res.json({ success: true });
    
    values.push(id);
    db.run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ----- Сообщения -----
app.get('/api/messages/:userId', (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.query.currentUserId;
    const chatKey = [currentUserId, userId].sort().join('_');
    
    db.all("SELECT * FROM messages WHERE chatKey = ? ORDER BY ts ASC", [chatKey], (err, messages) => {
        if (err) return res.status(500).json([]);
        res.json(messages);
    });
});

app.post('/api/messages', (req, res) => {
    const { from, to, type, text, data, fileName, fileSize, giftName, giftEmoji } = req.body;
    const chatKey = [from, to].sort().join('_');
    const messageId = uuidv4();
    
    db.run(`INSERT INTO messages (id, chatKey, fromUserId, toUserId, type, text, data, fileName, fileSize, giftName, giftEmoji, ts, read)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [messageId, chatKey, from, to, type, text || null, data || null, fileName || null, fileSize || null, giftName || null, giftEmoji || null, Date.now(), 0],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: { id: messageId, from, to, type, text, ts: Date.now() } });
        }
    );
});

app.delete('/api/messages', (req, res) => {
    const { chatKey, messageId } = req.body;
    db.run("DELETE FROM messages WHERE id = ? AND chatKey = ?", [messageId, chatKey], (err) => {
        res.json({ success: true });
    });
});

// ----- Жалобы -----
app.get('/api/reports', (req, res) => {
    db.all("SELECT * FROM reports ORDER BY ts DESC", (err, reports) => {
        res.json(reports);
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
        if (err) return res.status(500).json({ error: err.message });
        
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

// ----- Подарки -----
app.get('/api/gifts', (req, res) => {
    db.all("SELECT * FROM gifts", (err, gifts) => {
        res.json(gifts);
    });
});

app.post('/api/gifts/buy', (req, res) => {
    const { userId, giftId } = req.body;
    
    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
        
        db.get("SELECT * FROM gifts WHERE id = ?", [giftId], (err, gift) => {
            if (!gift) return res.status(400).json({ error: 'Подарок не найден' });
            
            if (user.stars < gift.price) {
                return res.status(400).json({ error: 'Недостаточно звёзд' });
            }
            
            if (gift.stock <= 0) {
                return res.status(400).json({ error: 'Подарок закончился' });
            }
            
            db.run("UPDATE users SET stars = ? WHERE id = ?", [user.stars - gift.price, userId]);
            db.run("UPDATE gifts SET stock = ? WHERE id = ?", [gift.stock - 1, giftId]);
            
            res.json({ success: true, stars: user.stars - gift.price });
        });
    });
});

// Статистика для админки
app.get('/api/stats', (req, res) => {
    db.get("SELECT COUNT(*) as users FROM users", (err, userCount) => {
        db.get("SELECT COUNT(*) as messages FROM messages", (err, msgCount) => {
            db.get("SELECT COUNT(*) as reports FROM reports", (err, reportCount) => {
                db.get("SELECT COUNT(*) as pending FROM reports WHERE status = 'pending'", (err, pending) => {
                    db.get("SELECT COUNT(*) as banned FROM users WHERE banned = 1", (err, banned) => {
                        db.get("SELECT COUNT(*) as gifts FROM gifts", (err, giftCount) => {
                            res.json({
                                users: userCount?.users || 0,
                                messages: msgCount?.messages || 0,
                                reports: reportCount?.reports || 0,
                                pendingReports: pending?.pending || 0,
                                bannedUsers: banned?.banned || 0,
                                gifts: giftCount?.gifts || 0
                            });
                        });
                    });
                });
            });
        });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Сервер запущен на порту ${PORT}`);
    console.log(`📱 Мессенджер: http://localhost:${PORT}/messenger.html`);
    console.log(`🛡️ Админка: http://localhost:${PORT}/admin.html\n`);
});
