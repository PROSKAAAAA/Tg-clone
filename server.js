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

// ============ ПЕРСИСТЕНТНОЕ ХРАНИЛИЩЕ ============
// Render сохранит папку /data между деплоями
const DATA_DIR = process.env.RENDER ? '/data' : '.';
const DB_PATH = path.join(DATA_DIR, 'tg_clone.db');

console.log(`📁 База данных: ${DB_PATH}`);

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(DB_PATH);
// ... остальной код сервера без изменений ...
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const sqlite3 = require('sqlite3').verbose();
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
        muted INTEGER DEFAULT 0,
        banned INTEGER DEFAULT 0,
        createdAt INTEGER
    )`);
    
    // Личные чаты (диалоги)
    db.run(`CREATE TABLE IF NOT EXISTS dialogs (
        id TEXT PRIMARY KEY,
        user1 TEXT,
        user2 TEXT,
        lastMessage TEXT,
        lastMessageTime INTEGER,
        updatedAt INTEGER
    )`);
    
    // Сообщения
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        dialogId TEXT,
        fromUserId TEXT,
        toUserId TEXT,
        type TEXT,
        text TEXT,
        ts INTEGER,
        read INTEGER DEFAULT 0
    )`);
    
    // Подарки (NFT)
    db.run(`CREATE TABLE IF NOT EXISTS gifts (
        id TEXT PRIMARY KEY,
        name TEXT,
        emoji TEXT,
        type TEXT,
        price INTEGER,
        stock INTEGER,
        fileUrl TEXT,
        rarity TEXT
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
    
    // Дефолтный админ
    db.get("SELECT COUNT(*) as count FROM users WHERE username = 'admin'", (err, row) => {
        if (row && row.count === 0) {
            const hash = bcrypt.hashSync('admin2024', 10);
            db.run(`INSERT INTO users (id, name, username, password, stars, createdAt, banned, muted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                ['admin', 'Администратор', 'admin', hash, 999999, Date.now(), 0, 0]);
        }
    });
    
    // Дефолтные подарки
    db.get("SELECT COUNT(*) as count FROM gifts", (err, row) => {
        if (row && row.count === 0) {
            const gifts = [
                ['g1', 'Сердечко', '❤️', 'emoji', 50, 100, '', 'common'],
                ['g2', 'Корона', '👑', 'emoji', 200, 50, '', 'rare'],
                ['g3', 'Звезда', '⭐', 'emoji', 100, 200, '', 'common'],
                ['g4', 'Алмаз', '💎', 'tgs', 500, 20, '', 'legendary']
            ];
            const stmt = db.prepare("INSERT INTO gifts VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            gifts.forEach(g => stmt.run(g));
            stmt.finalize();
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
    db.all("SELECT id, name, username, avatar, stars, muted, banned, bio FROM users", (err, users) => {
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

// ============ ДИАЛОГИ ============
app.post('/api/dialogs', (req, res) => {
    const { user1, user2 } = req.body;
    const dialogId = [user1, user2].sort().join('_');
    
    db.get("SELECT * FROM dialogs WHERE id = ?", [dialogId], (err, existing) => {
        if (!existing) {
            db.run(`INSERT INTO dialogs (id, user1, user2, updatedAt) VALUES (?, ?, ?, ?)`,
                [dialogId, user1, user2, Date.now()]);
        }
        res.json({ success: true, dialogId });
    });
});

app.get('/api/dialogs/:userId', (req, res) => {
    const userId = req.params.userId;
    db.all(`SELECT * FROM dialogs WHERE user1 = ? OR user2 = ? ORDER BY updatedAt DESC`, [userId, userId], (err, dialogs) => {
        res.json(dialogs || []);
    });
});

// ============ СООБЩЕНИЯ ============
app.post('/api/messages', (req, res) => {
    const { from, to, type, text } = req.body;
    const dialogId = [from, to].sort().join('_');
    const messageId = uuidv4();
    
    // Обновляем диалог
    db.run(`INSERT OR REPLACE INTO dialogs (id, user1, user2, lastMessage, lastMessageTime, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
        [dialogId, from, to, text || '[медиа]', Date.now(), Date.now()]);
    
    db.run(`INSERT INTO messages (id, dialogId, fromUserId, toUserId, type, text, ts, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [messageId, dialogId, from, to, type, text, Date.now(), 0],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.get('/api/messages/:userId', (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.query.currentUserId;
    const dialogId = [currentUserId, userId].sort().join('_');
    
    db.all("SELECT * FROM messages WHERE dialogId = ? ORDER BY ts ASC", [dialogId], (err, messages) => {
        res.json(messages || []);
    });
});

// ============ ПОДАРКИ ============
app.get('/api/gifts', (req, res) => {
    db.all("SELECT * FROM gifts", (err, gifts) => {
        res.json(gifts || []);
    });
});

app.post('/api/gifts/buy', async (req, res) => {
    const { userId, giftId, toUserId } = req.body;
    
    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        
        db.get("SELECT * FROM gifts WHERE id = ?", [giftId], (err, gift) => {
            if (!gift) return res.status(404).json({ error: 'Подарок не найден' });
            if (user.stars < gift.price) return res.status(400).json({ error: 'Недостаточно звёзд' });
            if (gift.stock <= 0) return res.status(400).json({ error: 'Подарок закончился' });
            
            db.run("UPDATE users SET stars = ? WHERE id = ?", [user.stars - gift.price, userId]);
            db.run("UPDATE gifts SET stock = ? WHERE id = ?", [gift.stock - 1, giftId]);
            
            // Отправляем сообщение о подарке
            const dialogId = [userId, toUserId].sort().join('_');
            const messageId = uuidv4();
            db.run(`INSERT INTO messages (id, dialogId, fromUserId, toUserId, type, text, ts, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [messageId, dialogId, userId, toUserId, 'gift', `Подарок: ${gift.name} ${gift.emoji}`, Date.now(), 0]);
            
            res.json({ success: true, stars: user.stars - gift.price });
        });
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
    db.run("DELETE FROM users WHERE username != 'admin'");
    db.run("DELETE FROM messages");
    db.run("DELETE FROM dialogs");
    db.run("DELETE FROM reports");
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📱 Мессенджер: http://localhost:${PORT}/`);
    console.log(`🛡️ Админка: http://localhost:${PORT}/admin.html`);
});
