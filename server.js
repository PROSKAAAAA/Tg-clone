const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// ============ SQLite ============
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('tg_clone.db');

// GitHub бэкап (как ты просил)
function backupToGitHub() {
    if (!process.env.GITHUB_TOKEN) return;
    exec(`cd /opt/render/project/src && 
          git config user.name "Render Backup" && 
          git config user.email "backup@render.com" &&
          git add tg_clone.db &&
          git commit -m "Auto-backup: ${new Date().toISOString()}" || echo "Нет изменений" &&
          git push https://${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPO}.git main`,
        (error) => { if (error) console.log('Бэкап не удался'); else console.log('✅ Бэкап сохранён'); });
}
setInterval(backupToGitHub, 300000);

function restoreFromGitHub() {
    exec(`cd /opt/render/project/src && git pull origin main`, (error) => {
        if (!error) console.log('✅ База восстановлена');
    });
}

// ============ СОЗДАНИЕ ТАБЛИЦ ============
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
    
    // Каналы и группы
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
    
    // Личные диалоги
    db.run(`CREATE TABLE IF NOT EXISTS dialogs (
        id TEXT PRIMARY KEY,
        user1 TEXT,
        user2 TEXT,
        lastMessage TEXT,
        lastMessageTime INTEGER,
        updatedAt INTEGER
    )`);
    
    // Сообщения (везде)
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chatId TEXT,
        fromUserId TEXT,
        type TEXT,
        text TEXT,
        data TEXT,
        fileName TEXT,
        ts INTEGER,
        read INTEGER DEFAULT 0
    )`);
    
    // Подписки на каналы/группы
    db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
        userId TEXT,
        chatId TEXT,
        role TEXT,
        joinedAt INTEGER
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
    
    // Подарки (обычные)
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
    
    // NFT-подарки (с серийными номерами)
    db.run(`CREATE TABLE IF NOT EXISTS nft_collections (
        id TEXT PRIMARY KEY,
        name TEXT,
        emoji TEXT,
        type TEXT,
        price INTEGER,
        maxSupply INTEGER,
        fileUrl TEXT,
        rarity TEXT,
        minted INTEGER DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS nft_items (
        id TEXT PRIMARY KEY,
        collectionId TEXT,
        serialNumber TEXT,
        ownerId TEXT,
        mintedAt INTEGER
    )`);
    
    // Улучшения (лутбоксы)
    db.run(`CREATE TABLE IF NOT EXISTS upgrades (
        id TEXT PRIMARY KEY,
        name TEXT,
        price INTEGER,
        chance INTEGER,
        modelUrl TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS upgrade_rewards (
        id TEXT PRIMARY KEY,
        upgradeId TEXT,
        type TEXT,
        value TEXT,
        probability INTEGER
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
    
    // Дефолтные улучшения
    db.get("SELECT COUNT(*) as count FROM upgrades", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO upgrades (id, name, price, chance, modelUrl) VALUES ('up1', 'Космический сундук', 150, 100, '')`);
            db.run(`INSERT INTO upgrade_rewards (id, upgradeId, type, value, probability) VALUES 
                ('ur1', 'up1', 'color', '#FFD700', 30),
                ('ur2', 'up1', 'color', '#FF6B35', 25),
                ('ur3', 'up1', 'background', 'stars', 20),
                ('ur4', 'up1', 'gift', 'g1', 25)`);
        }
    });
});

setTimeout(restoreFromGitHub, 2000);

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
                backupToGitHub();
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
    
    backupToGitHub();
    res.json({ success: true });
});

// ============ ЛИЧНЫЕ ДИАЛОГИ ============
app.post('/api/dialogs', (req, res) => {
    const { user1, user2 } = req.body;
    const dialogId = [user1, user2].sort().join('_');
    
    db.get("SELECT * FROM dialogs WHERE id = ?", [dialogId], (err, existing) => {
        if (!existing) {
            db.run(`INSERT INTO dialogs (id, user1, user2, updatedAt) VALUES (?, ?, ?, ?)`,
                [dialogId, user1, user2, Date.now()], () => backupToGitHub());
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

// ============ ЛИЧНЫЕ СООБЩЕНИЯ ============
app.post('/api/messages', (req, res) => {
    const { from, to, type, text } = req.body;
    const dialogId = [from, to].sort().join('_');
    const messageId = uuidv4();
    
    db.run(`INSERT OR REPLACE INTO dialogs (id, user1, user2, lastMessage, lastMessageTime, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
        [dialogId, from, to, text || '[медиа]', Date.now(), Date.now()]);
    
    db.run(`INSERT INTO messages (id, chatId, fromUserId, type, text, ts) VALUES (?, ?, ?, ?, ?, ?)`,
        [messageId, dialogId, from, type, text, Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            backupToGitHub();
            res.json({ success: true });
        });
});

app.get('/api/messages/:userId', (req, res) => {
    const { userId } = req.params;
    const currentUserId = req.query.currentUserId;
    const dialogId = [currentUserId, userId].sort().join('_');
    
    db.all("SELECT * FROM messages WHERE chatId = ? ORDER BY ts ASC", [dialogId], (err, messages) => {
        res.json(messages || []);
    });
});

// ============ КАНАЛЫ И ГРУППЫ ============
app.post('/api/chats', (req, res) => {
    const { type, title, description, creatorId, avatar } = req.body;
    const chatId = uuidv4();
    
    db.run(`INSERT INTO chats (id, type, title, description, creatorId, members, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [chatId, type, title, description, creatorId, JSON.stringify([creatorId]), Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            db.run(`INSERT INTO subscriptions (userId, chatId, role, joinedAt) VALUES (?, ?, ?, ?)`, [creatorId, chatId, 'creator', Date.now()]);
            backupToGitHub();
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
            backupToGitHub();
        }
        res.json({ success: true });
    });
});

app.get('/api/chats/:id/messages', (req, res) => {
    db.all("SELECT * FROM messages WHERE chatId = ? ORDER BY ts ASC", [req.params.id], (err, messages) => {
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
            backupToGitHub();
            res.json({ success: true });
        });
});

app.get('/api/my/chats/:userId', (req, res) => {
    const userId = req.params.userId;
    db.all("SELECT * FROM subscriptions WHERE userId = ?", [userId], (err, subs) => {
        const chatIds = subs.map(s => s.chatId);
        if (chatIds.length === 0) return res.json([]);
        const placeholders = chatIds.map(() => '?').join(',');
        db.all(`SELECT * FROM chats WHERE id IN (${placeholders})`, chatIds, (err, chats) => {
            res.json(chats || []);
        });
    });
});

// ============ ПОДАРКИ (ОБЫЧНЫЕ) ============
app.get('/api/gifts', (req, res) => {
    db.all("SELECT * FROM gifts", (err, gifts) => {
        res.json(gifts || []);
    });
});

app.post('/api/gifts/buy', (req, res) => {
    const { userId, giftId, toUserId } = req.body;
    
    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        
        db.get("SELECT * FROM gifts WHERE id = ?", [giftId], (err, gift) => {
            if (!gift) return res.status(404).json({ error: 'Подарок не найден' });
            if (user.stars < gift.price) return res.status(400).json({ error: 'Недостаточно звёзд' });
            if (gift.stock <= 0) return res.status(400).json({ error: 'Подарок закончился' });
            
            db.run("UPDATE users SET stars = ? WHERE id = ?", [user.stars - gift.price, userId]);
            db.run("UPDATE gifts SET stock = ? WHERE id = ?", [gift.stock - 1, giftId]);
            
            const dialogId = [userId, toUserId].sort().join('_');
            const messageId = uuidv4();
            db.run(`INSERT INTO messages (id, chatId, fromUserId, type, text, ts) VALUES (?, ?, ?, ?, ?, ?)`,
                [messageId, dialogId, userId, 'gift', `Подарок: ${gift.name} ${gift.emoji}`, Date.now()]);
            
            backupToGitHub();
            res.json({ success: true, stars: user.stars - gift.price });
        });
    });
});

app.post('/api/gifts', (req, res) => {
    const { name, emoji, type, price, stock, fileUrl, rarity } = req.body;
    const giftId = 'g' + Date.now();
    
    db.run(`INSERT INTO gifts (id, name, emoji, type, price, stock, fileUrl, rarity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [giftId, name, emoji, type, price, stock, fileUrl || '', rarity || 'common'],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            backupToGitHub();
            res.json({ success: true });
        });
});

app.delete('/api/gifts/:id', (req, res) => {
    db.run("DELETE FROM gifts WHERE id = ?", [req.params.id], (err) => {
        backupToGitHub();
        res.json({ success: true });
    });
});

// ============ NFT-КОЛЛЕКЦИИ ============
app.get('/api/nft/collections', (req, res) => {
    db.all("SELECT * FROM nft_collections", (err, collections) => {
        res.json(collections || []);
    });
});

app.post('/api/nft/collections', (req, res) => {
    const { name, emoji, type, price, maxSupply, fileUrl, rarity } = req.body;
    const id = 'nft' + Date.now();
    
    db.run(`INSERT INTO nft_collections (id, name, emoji, type, price, maxSupply, fileUrl, rarity, minted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, emoji, type, price, maxSupply || 0, fileUrl || '', rarity || 'common', 0],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            backupToGitHub();
            res.json({ success: true });
        });
});

app.delete('/api/nft/collections/:id', (req, res) => {
    db.run("DELETE FROM nft_collections WHERE id = ?", [req.params.id], (err) => {
        db.run("DELETE FROM nft_items WHERE collectionId = ?", [req.params.id]);
        backupToGitHub();
        res.json({ success: true });
    });
});

app.post('/api/nft/mint', (req, res) => {
    const { collectionId, ownerId } = req.body;
    
    db.get("SELECT * FROM nft_collections WHERE id = ?", [collectionId], (err, collection) => {
        if (!collection) return res.status(404).json({ error: 'Коллекция не найдена' });
        if (collection.maxSupply > 0 && collection.minted >= collection.maxSupply) {
            return res.status(400).json({ error: 'Лимит коллекции исчерпан' });
        }
        
        const serialNumber = `${collectionId.slice(-4)}-${String(collection.minted + 1).padStart(4, '0')}`;
        const itemId = uuidv4();
        
        db.run(`INSERT INTO nft_items (id, collectionId, serialNumber, ownerId, mintedAt) VALUES (?, ?, ?, ?, ?)`,
            [itemId, collectionId, serialNumber, ownerId || null, Date.now()]);
        db.run("UPDATE nft_collections SET minted = minted + 1 WHERE id = ?", [collectionId]);
        
        backupToGitHub();
        res.json({ success: true, serialNumber });
    });
});

app.get('/api/nft/user/:userId', (req, res) => {
    db.all(`SELECT n.*, c.name as collectionName, c.emoji FROM nft_items n 
            JOIN nft_collections c ON n.collectionId = c.id 
            WHERE n.ownerId = ?`, [req.params.userId], (err, items) => {
        res.json(items || []);
    });
});

// ============ УЛУЧШЕНИЯ (ЛУТБОКСЫ) ============
app.get('/api/upgrades', (req, res) => {
    db.all("SELECT * FROM upgrades", (err, upgrades) => {
        if (err) return res.json([]);
        Promise.all(upgrades.map(u => {
            return new Promise((resolve) => {
                db.all("SELECT * FROM upgrade_rewards WHERE upgradeId = ?", [u.id], (err, rewards) => {
                    u.rewards = rewards || [];
                    resolve(u);
                });
            });
        })).then(result => res.json(result));
    });
});

app.post('/api/upgrades/open', (req, res) => {
    const { userId, upgradeId } = req.body;
    
    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        
        db.get("SELECT * FROM upgrades WHERE id = ?", [upgradeId], (err, upgrade) => {
            if (!upgrade) return res.status(404).json({ error: 'Улучшение не найдено' });
            if (user.stars < upgrade.price) return res.status(400).json({ error: 'Недостаточно звёзд' });
            
            db.all("SELECT * FROM upgrade_rewards WHERE upgradeId = ?", [upgradeId], (err, rewards) => {
                if (!rewards.length) return res.status(400).json({ error: 'Нет наград' });
                
                // Рандомная награда по шансам
                let totalChance = rewards.reduce((sum, r) => sum + r.probability, 0);
                let random = Math.random() * totalChance;
                let selected = rewards[0];
                let accum = 0;
                for (let r of rewards) {
                    accum += r.probability;
                    if (random <= accum) { selected = r; break; }
                }
                
                let rewardText = '';
                if (selected.type === 'color') rewardText = `🎨 Цвет: ${selected.value}`;
                else if (selected.type === 'background') rewardText = `🖼️ Фон: ${selected.value}`;
                else if (selected.type === 'gift') rewardText = `🎁 Подарок!`;
                
                db.run("UPDATE users SET stars = ? WHERE id = ?", [user.stars - upgrade.price, userId]);
                backupToGitHub();
                res.json({ success: true, reward: rewardText, stars: user.stars - upgrade.price });
            });
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
            backupToGitHub();
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
        backupToGitHub();
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
                            db.get("SELECT COUNT(*) as count FROM nft_collections", (err, nftCollections) => {
                                db.get("SELECT COUNT(*) as count FROM gifts", (err, gifts) => {
                                    res.json({
                                        users: users?.count || 0,
                                        messages: messages?.count || 0,
                                        reports: reports?.count || 0,
                                        pendingReports: pending?.count || 0,
                                        bannedUsers: banned?.count || 0,
                                        chats: chats?.count || 0,
                                        nftCollections: nftCollections?.count || 0,
                                        gifts: gifts?.count || 0
                                    });
                                });
                            });
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
    db.run("DELETE FROM chats");
    db.run("DELETE FROM subscriptions");
    db.run("DELETE FROM reports");
    db.run("DELETE FROM nft_items");
    db.run("DELETE FROM nft_collections");
    backupToGitHub();
    res.json({ success: true });
});

// ============ ЗАПУСК ============
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📱 Мессенджер: https://tg-clone-zjsn.onrender.com`);
    console.log(`🛡️ Админка: https://tg-clone-zjsn.onrender.com/admin.html`);
});
