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

// ============ SQLite ============
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
        muted INTEGER DEFAULT 0,
        banned INTEGER DEFAULT 0,
        selectedGift TEXT,
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
    
    // ========== ЛИЧНЫЕ ДИАЛОГИ ==========
    db.run(`CREATE TABLE IF NOT EXISTS dialogs (
        id TEXT PRIMARY KEY,
        user1 TEXT,
        user2 TEXT,
        lastMessage TEXT,
        lastMessageTime INTEGER,
        updatedAt INTEGER
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
        ts INTEGER,
        read INTEGER DEFAULT 0
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
    
    // ========== NFT ПОДАРКИ (СЕРИЙНЫЕ НОМЕРА) ==========
    db.run(`CREATE TABLE IF NOT EXISTS nft_collections (
        id TEXT PRIMARY KEY,
        name TEXT,
        emoji TEXT,
        type TEXT,
        price INTEGER,
        maxSupply INTEGER,
        fileUrl TEXT,
        backgrounds TEXT,
        upgradePrice INTEGER,
        upgradedModelUrl TEXT,
        upgradedBackgrounds TEXT,
        rarity TEXT,
        minted INTEGER DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS nft_items (
        id TEXT PRIMARY KEY,
        collectionId TEXT,
        serialNumber INTEGER,
        ownerId TEXT,
        isUpgraded INTEGER DEFAULT 0,
        selectedBackground TEXT,
        mintedAt INTEGER
    )`);
    
    // Дефолтные фоны (12 цветов, включая black и onyx black)
    const defaultBackgrounds = JSON.stringify([
        { type: 'color', value: '#000000', probability: 12, name: 'Black' },
        { type: 'color', value: '#0a0a0a', probability: 10, name: 'Onyx Black' },
        { type: 'color', value: '#182533', probability: 10, name: 'Тёмный' },
        { type: 'color', value: '#2b5278', probability: 10, name: 'Синий' },
        { type: 'color', value: '#2b2b52', probability: 8, name: 'Фиолетовый' },
        { type: 'color', value: '#1e3a2f', probability: 8, name: 'Зелёный' },
        { type: 'color', value: '#3d2b1f', probability: 8, name: 'Коричневый' },
        { type: 'color', value: '#2b1f3d', probability: 8, name: 'Пурпурный' },
        { type: 'color', value: '#3d1f2b', probability: 8, name: 'Бордовый' },
        { type: 'color', value: '#1f3d3d', probability: 8, name: 'Бирюзовый' },
        { type: 'color', value: '#3d3d1f', probability: 5, name: 'Оливковый' },
        { type: 'color', value: '#1f1f3d', probability: 5, name: 'Тёмно-синий' }
    ]);
    
    // Дефолтная коллекция
    db.get("SELECT COUNT(*) as count FROM nft_collections", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO nft_collections (id, name, emoji, type, price, maxSupply, fileUrl, backgrounds, upgradePrice, upgradedModelUrl, upgradedBackgrounds, rarity, minted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ['nft1', 'Магический кристалл', '🔮', 'tgs', 100, 1000, '', defaultBackgrounds, 250, '', defaultBackgrounds, 'rare', 0]);
        }
    });
    
    // Дефолтный админ (только в базе, не показывается в мессенджере)
    db.get("SELECT COUNT(*) as count FROM users WHERE username = 'admin'", (err, row) => {
        if (row && row.count === 0) {
            const hash = bcrypt.hashSync('admin2024', 10);
            db.run(`INSERT INTO users (id, name, username, password, stars, createdAt, banned, muted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                ['admin', 'Admin', 'admin', hash, 999999, Date.now(), 0, 0]);
        }
    });
});

// ============ СТРАНИЦЫ ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'messenger.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ============ АУТЕНТИФИКАЦИЯ ==========
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
    
    db.get("SELECT * FROM users WHERE username = ? AND id != 'admin'", [username], async (err, user) => {
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
                stars: user.stars || 0,
                selectedGift: user.selectedGift || null
            }
        });
    });
});

app.get('/api/users', (req, res) => {
    db.all("SELECT id, name, username, avatar, stars, muted, banned, bio, selectedGift FROM users WHERE id != 'admin'", (err, users) => {
        res.json(users || []);
    });
});

app.get('/api/users/:id', (req, res) => {
    db.get("SELECT id, name, username, avatar, stars, bio, selectedGift FROM users WHERE id = ? AND id != 'admin'", [req.params.id], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Не найден' });
        res.json(user);
    });
});

app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { stars, banned, muted, name, bio, avatar, selectedGift } = req.body;
    
    if (stars !== undefined) db.run("UPDATE users SET stars = ? WHERE id = ?", [stars, id]);
    if (banned !== undefined) db.run("UPDATE users SET banned = ? WHERE id = ?", [banned ? 1 : 0, id]);
    if (muted !== undefined) db.run("UPDATE users SET muted = ? WHERE id = ?", [muted ? 1 : 0, id]);
    if (name !== undefined) db.run("UPDATE users SET name = ? WHERE id = ?", [name, id]);
    if (bio !== undefined) db.run("UPDATE users SET bio = ? WHERE id = ?", [bio, id]);
    if (avatar !== undefined) db.run("UPDATE users SET avatar = ? WHERE id = ?", [avatar, id]);
    if (selectedGift !== undefined) db.run("UPDATE users SET selectedGift = ? WHERE id = ?", [selectedGift, id]);
    
    res.json({ success: true });
});

// ============ ЛИЧНЫЕ ДИАЛОГИ ==========
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

// ============ СООБЩЕНИЯ ==========
app.post('/api/messages', (req, res) => {
    const { from, to, type, text, data, fileName } = req.body;
    const dialogId = [from, to].sort().join('_');
    const messageId = uuidv4();
    
    db.run(`INSERT OR REPLACE INTO dialogs (id, user1, user2, lastMessage, lastMessageTime, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
        [dialogId, from, to, text || data || '[медиа]', Date.now(), Date.now()]);
    
    db.run(`INSERT INTO messages (id, chatId, fromUserId, type, text, data, fileName, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [messageId, dialogId, from, type, text || null, data || null, fileName || null, Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
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

// ============ КАНАЛЫ И ГРУППЫ ==========
app.post('/api/chats', (req, res) => {
    const { type, title, description, creatorId, avatar } = req.body;
    const chatId = uuidv4();
    
    db.run(`INSERT INTO chats (id, type, title, description, creatorId, members, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [chatId, type, title, description, creatorId, JSON.stringify([creatorId]), Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            db.run(`INSERT INTO subscriptions (userId, chatId, role, joinedAt) VALUES (?, ?, ?, ?)`, [creatorId, chatId, 'creator', Date.now()]);
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

app.delete('/api/chats/:id', (req, res) => {
    db.run("DELETE FROM chats WHERE id = ?", [req.params.id], (err) => {
        db.run("DELETE FROM subscriptions WHERE chatId = ?", [req.params.id]);
        res.json({ success: true });
    });
});

// ============ NFT ПОДАРКИ ==========
app.get('/api/nft/collections', (req, res) => {
    db.all("SELECT * FROM nft_collections", (err, collections) => {
        res.json(collections || []);
    });
});

app.post('/api/nft/collections', (req, res) => {
    const { name, emoji, type, price, maxSupply, fileUrl, backgrounds, upgradePrice, upgradedModelUrl, upgradedBackgrounds, rarity } = req.body;
    const id = 'nft' + Date.now();
    
    db.run(`INSERT INTO nft_collections (id, name, emoji, type, price, maxSupply, fileUrl, backgrounds, upgradePrice, upgradedModelUrl, upgradedBackgrounds, rarity, minted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, emoji, type, price, maxSupply || 0, fileUrl || '', backgrounds || '[]', upgradePrice || 0, upgradedModelUrl || '', upgradedBackgrounds || '[]', rarity || 'common', 0],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.put('/api/nft/collections/:id', (req, res) => {
    const { id } = req.params;
    const { name, emoji, type, price, maxSupply, fileUrl, backgrounds, upgradePrice, upgradedModelUrl, upgradedBackgrounds, rarity } = req.body;
    
    db.run(`UPDATE nft_collections SET name = ?, emoji = ?, type = ?, price = ?, maxSupply = ?, fileUrl = ?, backgrounds = ?, upgradePrice = ?, upgradedModelUrl = ?, upgradedBackgrounds = ?, rarity = ? WHERE id = ?`,
        [name, emoji, type, price, maxSupply, fileUrl, backgrounds, upgradePrice, upgradedModelUrl, upgradedBackgrounds, rarity, id],
        (err) => { res.json({ success: true }); });
});

app.delete('/api/nft/collections/:id', (req, res) => {
    db.run("DELETE FROM nft_collections WHERE id = ?", [req.params.id], (err) => {
        db.run("DELETE FROM nft_items WHERE collectionId = ?", [req.params.id]);
        res.json({ success: true });
    });
});

app.post('/api/nft/mint', (req, res) => {
    const { collectionId, ownerId, isUpgraded, selectedBackground } = req.body;
    
    db.get("SELECT * FROM nft_collections WHERE id = ?", [collectionId], (err, collection) => {
        if (!collection) return res.status(404).json({ error: 'Коллекция не найдена' });
        if (collection.maxSupply > 0 && collection.minted >= collection.maxSupply) {
            return res.status(400).json({ error: 'Лимит коллекции исчерпан' });
        }
        
        const serialNumber = collection.minted + 1;
        const itemId = uuidv4();
        
        db.run(`INSERT INTO nft_items (id, collectionId, serialNumber, ownerId, isUpgraded, selectedBackground, mintedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [itemId, collectionId, serialNumber, ownerId || null, isUpgraded ? 1 : 0, selectedBackground || null, Date.now()]);
        db.run("UPDATE nft_collections SET minted = minted + 1 WHERE id = ?", [collectionId]);
        
        res.json({ success: true, serialNumber });
    });
});

app.post('/api/nft/buy', async (req, res) => {
    const { userId, collectionId } = req.body;
    
    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        
        db.get("SELECT * FROM nft_collections WHERE id = ?", [collectionId], (err, collection) => {
            if (!collection) return res.status(404).json({ error: 'Коллекция не найдена' });
            if (user.stars < collection.price) return res.status(400).json({ error: 'Недостаточно звёзд' });
            if (collection.maxSupply > 0 && collection.minted >= collection.maxSupply) {
                return res.status(400).json({ error: 'Лимит коллекции исчерпан' });
            }
            
            // Выбираем случайный фон из collection.backgrounds
            let backgrounds = [];
            try { backgrounds = JSON.parse(collection.backgrounds); } catch(e) {}
            let selectedBackground = null;
            if (backgrounds.length > 0) {
                let totalChance = backgrounds.reduce((sum, b) => sum + (b.probability || 0), 0);
                let random = Math.random() * totalChance;
                let accum = 0;
                for (let bg of backgrounds) {
                    accum += (bg.probability || 0);
                    if (random <= accum) {
                        selectedBackground = bg;
                        break;
                    }
                }
            }
            
            const serialNumber = collection.minted + 1;
            const itemId = uuidv4();
            
            db.run("UPDATE users SET stars = ? WHERE id = ?", [user.stars - collection.price, userId]);
            db.run(`INSERT INTO nft_items (id, collectionId, serialNumber, ownerId, isUpgraded, selectedBackground, mintedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [itemId, collectionId, serialNumber, userId, 0, JSON.stringify(selectedBackground), Date.now()]);
            db.run("UPDATE nft_collections SET minted = minted + 1 WHERE id = ?", [collectionId]);
            
            res.json({ success: true, gift: { id: itemId, serialNumber, name: collection.name, emoji: collection.emoji, fileUrl: collection.fileUrl, background: selectedBackground, isUpgraded: false } });
        });
    });
});

app.post('/api/nft/upgrade', (req, res) => {
    const { userId, itemId } = req.body;
    
    db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
        
        db.get("SELECT * FROM nft_items WHERE id = ? AND ownerId = ?", [itemId, userId], (err, item) => {
            if (!item) return res.status(404).json({ error: 'Предмет не найден' });
            if (item.isUpgraded) return res.status(400).json({ error: 'Уже улучшен' });
            
            db.get("SELECT * FROM nft_collections WHERE id = ?", [item.collectionId], (err, collection) => {
                if (!collection) return res.status(404).json({ error: 'Коллекция не найдена' });
                if (user.stars < collection.upgradePrice) return res.status(400).json({ error: 'Недостаточно звёзд' });
                
                // Выбираем случайный улучшенный фон
                let upgradedBackgrounds = [];
                try { upgradedBackgrounds = JSON.parse(collection.upgradedBackgrounds); } catch(e) {}
                let selectedBackground = null;
                if (upgradedBackgrounds.length > 0) {
                    let totalChance = upgradedBackgrounds.reduce((sum, b) => sum + (b.probability || 0), 0);
                    let random = Math.random() * totalChance;
                    let accum = 0;
                    for (let bg of upgradedBackgrounds) {
                        accum += (bg.probability || 0);
                        if (random <= accum) {
                            selectedBackground = bg;
                            break;
                        }
                    }
                }
                
                db.run("UPDATE users SET stars = ? WHERE id = ?", [user.stars - collection.upgradePrice, userId]);
                db.run(`UPDATE nft_items SET isUpgraded = 1, selectedBackground = ? WHERE id = ?`, [JSON.stringify(selectedBackground), itemId]);
                
                res.json({ success: true, stars: user.stars - collection.upgradePrice, gift: { id: itemId, name: collection.name, emoji: collection.emoji, upgradedModelUrl: collection.upgradedModelUrl, background: selectedBackground } });
            });
        });
    });
});

app.get('/api/nft/user/:userId', (req, res) => {
    db.all(`SELECT n.*, c.name as collectionName, c.emoji, c.fileUrl, c.upgradedModelUrl, c.rarity 
            FROM nft_items n 
            JOIN nft_collections c ON n.collectionId = c.id 
            WHERE n.ownerId = ?`, [req.params.userId], (err, items) => {
        res.json(items || []);
    });
});

app.get('/api/nft/item/:itemId', (req, res) => {
    db.get(`SELECT n.*, c.name as collectionName, c.emoji, c.fileUrl, c.upgradedModelUrl, c.rarity, c.price, c.upgradePrice
            FROM nft_items n 
            JOIN nft_collections c ON n.collectionId = c.id 
            WHERE n.id = ?`, [req.params.itemId], (err, item) => {
        if (!item) return res.status(404).json({ error: 'Не найден' });
        res.json(item);
    });
});

app.post('/api/nft/select', (req, res) => {
    const { userId, itemId } = req.body;
    db.run("UPDATE users SET selectedGift = ? WHERE id = ?", [itemId, userId], (err) => {
        res.json({ success: true });
    });
});

// ============ ЖАЛОБЫ ==========
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

// ============ СТАТИСТИКА ==========
app.get('/api/stats', (req, res) => {
    db.get("SELECT COUNT(*) as count FROM users WHERE id != 'admin'", (err, users) => {
        db.get("SELECT COUNT(*) as count FROM messages", (err, messages) => {
            db.get("SELECT COUNT(*) as count FROM reports", (err, reports) => {
                db.get("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'", (err, pending) => {
                    db.get("SELECT COUNT(*) as count FROM users WHERE banned = 1 AND id != 'admin'", (err, banned) => {
                        db.get("SELECT COUNT(*) as count FROM chats", (err, chats) => {
                            db.get("SELECT COUNT(*) as count FROM nft_collections", (err, nftCollections) => {
                                db.get("SELECT COUNT(*) as count FROM nft_items", (err, nftItems) => {
                                    res.json({
                                        users: users?.count || 0,
                                        messages: messages?.count || 0,
                                        reports: reports?.count || 0,
                                        pendingReports: pending?.count || 0,
                                        bannedUsers: banned?.count || 0,
                                        chats: chats?.count || 0,
                                        nftCollections: nftCollections?.count || 0,
                                        nftItems: nftItems?.count || 0
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
    db.run("DELETE FROM users WHERE id != 'admin'");
    db.run("DELETE FROM messages");
    db.run("DELETE FROM dialogs");
    db.run("DELETE FROM chats");
    db.run("DELETE FROM subscriptions");
    db.run("DELETE FROM reports");
    db.run("DELETE FROM nft_items");
    db.run("DELETE FROM nft_collections");
    res.json({ success: true });
});

// ============ ЗАПУСК ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📱 Мессенджер: http://localhost:${PORT}/`);
    console.log(`🛡️ Админка: http://localhost:${PORT}/admin.html`);
    console.log(`🔑 Админ пароль: admin2024`);
});
