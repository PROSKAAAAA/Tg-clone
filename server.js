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
        spamBlocked INTEGER DEFAULT 0,
        spamReason TEXT,
        spamUntil INTEGER,
        banned INTEGER DEFAULT 0,
        frozen INTEGER DEFAULT 0,
        tags TEXT,
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
    
    // ========== АПЕЛЛЯЦИИ ==========
    db.run(`CREATE TABLE IF NOT EXISTS appeals (
        id TEXT PRIMARY KEY,
        userId TEXT,
        reason TEXT,
        status TEXT,
        adminComment TEXT,
        ts INTEGER
    )`);
    
    // ========== NFT ПОДАРКИ ==========
    db.run(`CREATE TABLE IF NOT EXISTS nft_collections (
        id TEXT PRIMARY KEY,
        name TEXT,
        emoji TEXT,
        type TEXT,
        price INTEGER,
        maxSupply INTEGER,
        models TEXT,
        backgrounds TEXT,
        upgradePrice INTEGER,
        upgradedModels TEXT,
        upgradedBackgrounds TEXT,
        rarity TEXT,
        minted INTEGER DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS nft_items (
        id TEXT PRIMARY KEY,
        collectionId TEXT,
        serialNumber TEXT,
        ownerId TEXT,
        isUpgraded INTEGER DEFAULT 0,
        selectedModel TEXT,
        selectedBackground TEXT,
        mintedAt INTEGER
    )`);
    
    // ========== СИСТЕМНЫЙ БОТ ==========
    db.run(`CREATE TABLE IF NOT EXISTS bot_messages (
        id TEXT PRIMARY KEY,
        userId TEXT,
        title TEXT,
        message TEXT,
        read INTEGER DEFAULT 0,
        ts INTEGER
    )`);
    
    // Дефолтные модели и фоны
    const defaultModels = JSON.stringify([
        { url: '', probability: 70, name: 'Обычная' },
        { url: '', probability: 20, name: 'Редкая' },
        { url: '', probability: 10, name: 'Легендарная' }
    ]);
    
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
            db.run(`INSERT INTO nft_collections (id, name, emoji, type, price, maxSupply, models, backgrounds, upgradePrice, upgradedModels, upgradedBackgrounds, rarity, minted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ['nft1', 'Магический кристалл', '🔮', 'tgs', 100, 1000, defaultModels, defaultBackgrounds, 250, defaultModels, defaultBackgrounds, 'rare', 0]);
        }
    });
    
    // Дефолтный админ
    db.get("SELECT COUNT(*) as count FROM users WHERE username = 'admin'", (err, row) => {
        if (row && row.count === 0) {
            const hash = bcrypt.hashSync('admin2024', 10);
            db.run(`INSERT INTO users (id, name, username, password, stars, tags, createdAt, banned, spamBlocked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ['admin', 'Admin', 'admin', hash, 999999, JSON.stringify(['verified']), Date.now(), 0, 0]);
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
        db.run(`INSERT INTO users (id, name, username, password, stars, tags, createdAt, banned, spamBlocked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [username, name, username, hashed, 100, JSON.stringify([]), Date.now(), 0, 0],
            (err) => {
                if (err) return res.status(500).json({ error: 'Ошибка' });
                
                // Уведомление бота
                sendBotNotification(username, '🔐 Новый аккаунт', `Пользователь @${username} зарегистрировался!`);
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
        
        let tags = [];
        try { tags = JSON.parse(user.tags); } catch(e) {}
        
        // Уведомление о входе
        sendBotNotification(username, '🔐 Новый вход', `Вход в аккаунт @${username} с нового устройства (IP: ${req.ip})`);
        
        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                avatar: user.avatar,
                bio: user.bio,
                stars: user.stars || 0,
                tags: tags,
                selectedGift: user.selectedGift || null,
                spamBlocked: user.spamBlocked,
                spamReason: user.spamReason,
                spamUntil: user.spamUntil
            }
        });
    });
});

app.get('/api/users', (req, res) => {
    db.all("SELECT id, name, username, avatar, stars, tags, banned, frozen, spamBlocked, bio, selectedGift FROM users WHERE id != 'admin'", (err, users) => {
        if (err) return res.json([]);
        users.forEach(u => { try { u.tags = JSON.parse(u.tags); } catch(e) { u.tags = []; } });
        res.json(users);
    });
});

app.get('/api/users/:id', (req, res) => {
    db.get("SELECT id, name, username, avatar, stars, tags, bio, selectedGift, spamBlocked, spamReason, spamUntil FROM users WHERE id = ? AND id != 'admin'", [req.params.id], (err, user) => {
        if (!user) return res.status(404).json({ error: 'Не найден' });
        try { user.tags = JSON.parse(user.tags); } catch(e) { user.tags = []; }
        res.json(user);
    });
});

app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { stars, banned, frozen, spamBlocked, spamReason, spamUntil, name, bio, avatar, tags, selectedGift } = req.body;
    
    if (stars !== undefined) db.run("UPDATE users SET stars = ? WHERE id = ?", [stars, id]);
    if (banned !== undefined) db.run("UPDATE users SET banned = ? WHERE id = ?", [banned ? 1 : 0, id]);
    if (frozen !== undefined) db.run("UPDATE users SET frozen = ? WHERE id = ?", [frozen ? 1 : 0, id]);
    if (spamBlocked !== undefined) db.run("UPDATE users SET spamBlocked = ? WHERE id = ?", [spamBlocked ? 1 : 0, id]);
    if (spamReason !== undefined) db.run("UPDATE users SET spamReason = ? WHERE id = ?", [spamReason, id]);
    if (spamUntil !== undefined) db.run("UPDATE users SET spamUntil = ? WHERE id = ?", [spamUntil, id]);
    if (name !== undefined) db.run("UPDATE users SET name = ? WHERE id = ?", [name, id]);
    if (bio !== undefined) db.run("UPDATE users SET bio = ? WHERE id = ?", [bio, id]);
    if (avatar !== undefined) db.run("UPDATE users SET avatar = ? WHERE id = ?", [avatar, id]);
    if (tags !== undefined) db.run("UPDATE users SET tags = ? WHERE id = ?", [JSON.stringify(tags), id]);
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

// ============ СООБЩЕНИЯ С ПРОВЕРКОЙ СПАМ-БЛОКА ==========
app.post('/api/messages', (req, res) => {
    const { from, to, type, text } = req.body;
    
    // Проверка спам-блока
    db.get("SELECT spamBlocked, spamUntil, name FROM users WHERE id = ?", [from], (err, user) => {
        if (user && user.spamBlocked) {
            if (user.spamUntil && user.spamUntil > Date.now()) {
                return res.status(403).json({ error: 'spam_blocked', reason: user.spamReason, until: user.spamUntil });
            } else if (user.spamUntil && user.spamUntil <= Date.now()) {
                db.run("UPDATE users SET spamBlocked = 0, spamReason = NULL, spamUntil = NULL WHERE id = ?", [from]);
            } else {
                return res.status(403).json({ error: 'spam_blocked', reason: user.spamReason });
            }
        }
        
        const dialogId = [from, to].sort().join('_');
        const messageId = uuidv4();
        
        db.run(`INSERT OR REPLACE INTO dialogs (id, user1, user2, lastMessage, lastMessageTime, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
            [dialogId, from, to, text || '[медиа]', Date.now(), Date.now()]);
        
        db.run(`INSERT INTO messages (id, chatId, fromUserId, type, text, ts) VALUES (?, ?, ?, ?, ?, ?)`,
            [messageId, dialogId, from, type, text, Date.now()],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
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
    const { type, title, description, creatorId } = req.body;
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

// ============ NFT ПОДАРКИ (СЕРИЙНЫЙ НОМЕР СРАЗУ) ==========
app.get('/api/nft/collections', (req, res) => {
    db.all("SELECT * FROM nft_collections", (err, collections) => {
        res.json(collections || []);
    });
});

app.post('/api/nft/collections', (req, res) => {
    const { name, emoji, type, price, maxSupply, models, backgrounds, upgradePrice, upgradedModels, upgradedBackgrounds, rarity } = req.body;
    const id = 'nft' + Date.now();
    
    db.run(`INSERT INTO nft_collections (id, name, emoji, type, price, maxSupply, models, backgrounds, upgradePrice, upgradedModels, upgradedBackgrounds, rarity, minted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, emoji, type, price, maxSupply || 0, models || '[]', backgrounds || '[]', upgradePrice || 0, upgradedModels || '[]', upgradedBackgrounds || '[]', rarity || 'common', 0],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.put('/api/nft/collections/:id', (req, res) => {
    const { id } = req.params;
    const { name, emoji, type, price, maxSupply, models, backgrounds, upgradePrice, upgradedModels, upgradedBackgrounds, rarity } = req.body;
    
    db.run(`UPDATE nft_collections SET name = ?, emoji = ?, type = ?, price = ?, maxSupply = ?, models = ?, backgrounds = ?, upgradePrice = ?, upgradedModels = ?, upgradedBackgrounds = ?, rarity = ? WHERE id = ?`,
        [name, emoji, type, price, maxSupply, models, backgrounds, upgradePrice, upgradedModels, upgradedBackgrounds, rarity, id],
        (err) => { res.json({ success: true }); });
});

app.delete('/api/nft/collections/:id', (req, res) => {
    db.run("DELETE FROM nft_collections WHERE id = ?", [req.params.id], (err) => {
        db.run("DELETE FROM nft_items WHERE collectionId = ?", [req.params.id]);
        res.json({ success: true });
    });
});

// ПОКУПКА — СРАЗУ ВЫДАЁТ СЕРИЙНЫЙ НОМЕР
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
            
            // Выбираем случайную модель
            let models = [];
            try { models = JSON.parse(collection.models); } catch(e) {}
            let selectedModel = null;
            if (models.length > 0) {
                let totalChance = models.reduce((sum, m) => sum + (m.probability || 0), 0);
                let random = Math.random() * totalChance;
                let accum = 0;
                for (let m of models) {
                    accum += (m.probability || 0);
                    if (random <= accum) {
                        selectedModel = m;
                        break;
                    }
                }
            }
            
            // Выбираем случайный фон
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
            
            // СЕРИЙНЫЙ НОМЕР СРАЗУ!
            const serialNumber = `${collection.name.substring(0, 3)}-${String(collection.minted + 1).padStart(4, '0')}`;
            const itemId = uuidv4();
            
            db.run("UPDATE users SET stars = ? WHERE id = ?", [user.stars - collection.price, userId]);
            db.run(`INSERT INTO nft_items (id, collectionId, serialNumber, ownerId, isUpgraded, selectedModel, selectedBackground, mintedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [itemId, collectionId, serialNumber, userId, 0, JSON.stringify(selectedModel), JSON.stringify(selectedBackground), Date.now()]);
            db.run("UPDATE nft_collections SET minted = minted + 1 WHERE id = ?", [collectionId]);
            
            // Уведомление бота о покупке
            sendBotNotification(userId, '🛍️ Покупка NFT', `Вы купили ${collection.name} #${serialNumber} за ${collection.price} ⭐!`);
            
            res.json({ success: true, gift: { id: itemId, serialNumber, name: collection.name, emoji: collection.emoji, model: selectedModel, background: selectedBackground } });
        });
    });
});

// УЛУЧШЕНИЕ — НОВЫЙ СЕРИЙНЫЙ НОМЕР
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
                
                // Выбираем улучшенную модель
                let upgradedModels = [];
                try { upgradedModels = JSON.parse(collection.upgradedModels); } catch(e) {}
                let selectedModel = null;
                if (upgradedModels.length > 0) {
                    let totalChance = upgradedModels.reduce((sum, m) => sum + (m.probability || 0), 0);
                    let random = Math.random() * totalChance;
                    let accum = 0;
                    for (let m of upgradedModels) {
                        accum += (m.probability || 0);
                        if (random <= accum) {
                            selectedModel = m;
                            break;
                        }
                    }
                }
                
                // Выбираем улучшенный фон
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
                
                // НОВЫЙ СЕРИЙНЫЙ НОМЕР ПОСЛЕ УЛУЧШЕНИЯ
                const newSerialNumber = `${collection.name.substring(0, 3)}-UP-${String(collection.minted + 1).padStart(4, '0')}`;
                
                db.run("UPDATE users SET stars = ? WHERE id = ?", [user.stars - collection.upgradePrice, userId]);
                db.run(`UPDATE nft_items SET isUpgraded = 1, serialNumber = ?, selectedModel = ?, selectedBackground = ? WHERE id = ?`, 
                    [newSerialNumber, JSON.stringify(selectedModel), JSON.stringify(selectedBackground), itemId]);
                
                sendBotNotification(userId, '✨ Улучшение NFT', `Вы улучшили ${collection.name} до #${newSerialNumber} за ${collection.upgradePrice} ⭐!`);
                
                res.json({ success: true, stars: user.stars - collection.upgradePrice, gift: { serialNumber: newSerialNumber, model: selectedModel, background: selectedBackground } });
            });
        });
    });
});

app.get('/api/nft/user/:userId', (req, res) => {
    db.all(`SELECT n.*, c.name as collectionName, c.emoji, c.rarity, c.models, c.upgradedModels
            FROM nft_items n 
            JOIN nft_collections c ON n.collectionId = c.id 
            WHERE n.ownerId = ?`, [req.params.userId], (err, items) => {
        res.json(items || []);
    });
});

app.get('/api/nft/item/:itemId', (req, res) => {
    db.get(`SELECT n.*, c.name as collectionName, c.emoji, c.rarity, c.price, c.upgradePrice, c.models, c.upgradedModels
            FROM nft_items n 
            JOIN nft_collections c ON n.collectionId = c.id 
            WHERE n.id = ?`, [req.params.itemId], (err, item) => {
        if (!item) return res.status(404).json({ error: 'Не найден' });
        try { item.selectedModel = JSON.parse(item.selectedModel); } catch(e) {}
        try { item.selectedBackground = JSON.parse(item.selectedBackground); } catch(e) {}
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
    const { status, action, duration } = req.body;
    
    db.run("UPDATE reports SET status = ? WHERE id = ?", [status, id], (err) => {
        if (action === 'ban') {
            db.get("SELECT againstUserId FROM reports WHERE id = ?", [id], (err, report) => {
                if (report) db.run("UPDATE users SET banned = 1 WHERE id = ?", [report.againstUserId]);
            });
        }
        if (action === 'freeze') {
            db.get("SELECT againstUserId FROM reports WHERE id = ?", [id], (err, report) => {
                if (report) db.run("UPDATE users SET frozen = 1 WHERE id = ?", [report.againstUserId]);
            });
        }
        if (action === 'spam') {
            db.get("SELECT againstUserId FROM reports WHERE id = ?", [id], (err, report) => {
                if (report) {
                    const until = duration ? Date.now() + (duration * 60 * 60 * 1000) : null;
                    db.run("UPDATE users SET spamBlocked = 1, spamReason = ?, spamUntil = ? WHERE id = ?", 
                        [`Жалоба: ${action}`, until, report.againstUserId]);
                    sendBotNotification(report.againstUserId, '🚫 Спам-блок', `Вы получили спам-блок! Причина: жалоба. Подробнее: @SpamInfoBot`);
                }
            });
        }
        res.json({ success: true });
    });
});

// ============ АПЕЛЛЯЦИИ ==========
app.get('/api/appeals', (req, res) => {
    db.all("SELECT * FROM appeals ORDER BY ts DESC", (err, appeals) => {
        res.json(appeals || []);
    });
});

app.post('/api/appeals', (req, res) => {
    const { userId, reason } = req.body;
    const appealId = uuidv4();
    
    db.run(`INSERT INTO appeals (id, userId, reason, status, ts) VALUES (?, ?, ?, ?, ?)`,
        [appealId, userId, reason, 'pending', Date.now()],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
});

app.put('/api/appeals/:id', (req, res) => {
    const { id } = req.params;
    const { status, adminComment } = req.body;
    
    db.get("SELECT userId FROM appeals WHERE id = ?", [id], (err, appeal) => {
        if (appeal && status === 'approved') {
            db.run("UPDATE users SET spamBlocked = 0, spamReason = NULL, spamUntil = NULL WHERE id = ?", [appeal.userId]);
            sendBotNotification(appeal.userId, '✅ Апелляция одобрена', `Ваш спам-блок снят!`);
        }
        if (appeal && status === 'rejected') {
            sendBotNotification(appeal.userId, '❌ Апелляция отклонена', `Ваша апелляция отклонена. Причина: ${adminComment || 'не указана'}`);
        }
        db.run("UPDATE appeals SET status = ?, adminComment = ? WHERE id = ?", [status, adminComment, id]);
        res.json({ success: true });
    });
});

// ============ СИСТЕМНЫЙ БОТ ==========
function sendBotNotification(userId, title, message) {
    const msgId = uuidv4();
    db.run(`INSERT INTO bot_messages (id, userId, title, message, ts) VALUES (?, ?, ?, ?, ?)`,
        [msgId, userId, title, message, Date.now()]);
}

app.get('/api/bot/messages/:userId', (req, res) => {
    db.all("SELECT * FROM bot_messages WHERE userId = ? ORDER BY ts DESC", [req.params.userId], (err, msgs) => {
        res.json(msgs || []);
    });
});

app.post('/api/bot/messages/mark-read', (req, res) => {
    const { userId } = req.body;
    db.run("UPDATE bot_messages SET read = 1 WHERE userId = ?", [userId]);
    res.json({ success: true });
});

// ============ СПАМ-ИНФО БОТ ==========
app.post('/api/bot/spam-info', (req, res) => {
    const { userId } = req.body;
    db.get("SELECT spamBlocked, spamReason, spamUntil, name FROM users WHERE id = ?", [userId], (err, user) => {
        if (!user) return res.json({ exists: false });
        res.json({
            exists: true,
            isBlocked: user.spamBlocked === 1,
            reason: user.spamReason,
            until: user.spamUntil,
            name: user.name
        });
    });
});

// ============ СТАТИСТИКА ==========
app.get('/api/stats', (req, res) => {
    db.get("SELECT COUNT(*) as count FROM users WHERE id != 'admin'", (err, users) => {
        db.get("SELECT COUNT(*) as count FROM messages", (err, messages) => {
            db.get("SELECT COUNT(*) as count FROM reports", (err, reports) => {
                db.get("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'", (err, pending) => {
                    db.get("SELECT COUNT(*) as count FROM users WHERE banned = 1 AND id != 'admin'", (err, banned) => {
                        db.get("SELECT COUNT(*) as count FROM users WHERE frozen = 1 AND id != 'admin'", (err, frozen) => {
                            db.get("SELECT COUNT(*) as count FROM users WHERE spamBlocked = 1 AND id != 'admin'", (err, spamBlocked) => {
                                db.get("SELECT COUNT(*) as count FROM chats", (err, chats) => {
                                    db.get("SELECT COUNT(*) as count FROM nft_collections", (err, nftCollections) => {
                                        db.get("SELECT COUNT(*) as count FROM nft_items", (err, nftItems) => {
                                            db.get("SELECT COUNT(*) as count FROM appeals WHERE status = 'pending'", (err, pendingAppeals) => {
                                                res.json({
                                                    users: users?.count || 0,
                                                    messages: messages?.count || 0,
                                                    reports: reports?.count || 0,
                                                    pendingReports: pending?.count || 0,
                                                    bannedUsers: banned?.count || 0,
                                                    frozenUsers: frozen?.count || 0,
                                                    spamBlockedUsers: spamBlocked?.count || 0,
                                                    chats: chats?.count || 0,
                                                    nftCollections: nftCollections?.count || 0,
                                                    nftItems: nftItems?.count || 0,
                                                    pendingAppeals: pendingAppeals?.count || 0
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
    db.run("DELETE FROM appeals");
    db.run("DELETE FROM nft_items");
    db.run("DELETE FROM nft_collections");
    db.run("DELETE FROM bot_messages");
    res.json({ success: true });
});

// ============ ЗАПУСК ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📱 Мессенджер: http://localhost:${PORT}/`);
    console.log(`🛡️ Админка: http://localhost:${PORT}/admin.html`);
    console.log(`🔑 Админ пароль: admin2024`);
});
