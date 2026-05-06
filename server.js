const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============ БД В ПАМЯТИ (РАБОТАЕТ) ============
const users = new Map();
const messages = new Map();
const dialogs = new Map();
const reports = [];
const appeals = [];
const chats = new Map();
const subscriptions = new Map();
const botMessages = new Map();

// Дефолтный админ
users.set('admin', {
    id: 'admin',
    name: 'Admin',
    username: 'admin',
    password: bcrypt.hashSync('admin2024', 10),
    stars: 999999,
    tags: ['verified'],
    banned: false,
    frozen: false,
    spamBlocked: false,
    spamReason: null,
    spamUntil: null,
    avatar: null,
    bio: null
});

// Дефолтный тестовый пользователь
users.set('user', {
    id: 'user',
    name: 'Test User',
    username: 'user',
    password: bcrypt.hashSync('1234', 10),
    stars: 100,
    tags: [],
    banned: false,
    frozen: false,
    spamBlocked: false,
    spamReason: null,
    spamUntil: null,
    avatar: null,
    bio: null
});

// Дефолтный канал
chats.set('channel1', {
    id: 'channel1',
    type: 'channel',
    title: 'Новости',
    description: 'Главные новости',
    creatorId: 'admin',
    isPublic: 1,
    members: ['admin']
});

// ============ СТРАНИЦЫ ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'messenger.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ============ АУТЕНТИФИКАЦИЯ ==========
app.post('/api/register', async (req, res) => {
    const { name, username, password } = req.body;
    if (!name || !username || !password) return res.status(400).json({ error: 'Заполните поля' });
    if (users.has(username)) return res.status(400).json({ error: 'Пользователь уже есть' });
    
    users.set(username, {
        id: username,
        name,
        username,
        password: await bcrypt.hash(password, 10),
        stars: 100,
        tags: [],
        banned: false,
        frozen: false,
        spamBlocked: false,
        spamReason: null,
        spamUntil: null,
        avatar: null,
        bio: null
    });
    
    res.json({ success: true, user: { id: username, name, username, stars: 100 } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.get(username);
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
    if (user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Неверный пароль' });
    
    res.json({
        success: true,
        user: {
            id: user.id,
            name: user.name,
            username: user.username,
            stars: user.stars,
            tags: user.tags,
            banned: user.banned,
            frozen: user.frozen,
            spamBlocked: user.spamBlocked,
            avatar: user.avatar,
            bio: user.bio
        }
    });
});

app.get('/api/users', (req, res) => {
    const all = Array.from(users.values()).filter(u => u.id !== 'admin').map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        stars: u.stars,
        tags: u.tags,
        banned: u.banned,
        frozen: u.frozen,
        avatar: u.avatar,
        bio: u.bio
    }));
    res.json(all);
});

app.get('/api/users/:id', (req, res) => {
    const user = users.get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Не найден' });
    res.json({
        id: user.id,
        name: user.name,
        username: user.username,
        stars: user.stars,
        tags: user.tags,
        bio: user.bio,
        avatar: user.avatar,
        frozen: user.frozen,
        banned: user.banned
    });
});

app.put('/api/users/:id', (req, res) => {
    const user = users.get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Не найден' });
    
    if (req.body.stars !== undefined) user.stars = req.body.stars;
    if (req.body.banned !== undefined) user.banned = req.body.banned;
    if (req.body.frozen !== undefined) user.frozen = req.body.frozen;
    if (req.body.name !== undefined) user.name = req.body.name;
    if (req.body.bio !== undefined) user.bio = req.body.bio;
    if (req.body.avatar !== undefined) user.avatar = req.body.avatar;
    if (req.body.tags !== undefined) user.tags = req.body.tags;
    
    if (req.body.spamBlocked !== undefined) {
        user.spamBlocked = req.body.spamBlocked;
        user.spamReason = req.body.spamReason;
        user.spamUntil = req.body.spamUntil;
        
        // Уведомление бота @TelegramNotifications
        const botMsg = {
            id: uuidv4(),
            userId: user.id,
            title: '🚫 Спам-блок',
            message: `Вы получили спам-блок! Причина: ${user.spamReason || 'нарушение правил'}. Подробнее: @SpamInfoBot`,
            ts: Date.now(),
            read: 0
        };
        if (!botMessages.has(user.id)) botMessages.set(user.id, []);
        botMessages.get(user.id).push(botMsg);
    }
    
    res.json({ success: true });
});

// ============ ДИАЛОГИ ==========
app.post('/api/dialogs', (req, res) => {
    const { user1, user2 } = req.body;
    const dialogId = [user1, user2].sort().join('_');
    if (!dialogs.has(dialogId)) {
        dialogs.set(dialogId, { id: dialogId, user1, user2, lastMessage: null, updatedAt: Date.now() });
    }
    res.json({ success: true, dialogId });
});

app.get('/api/dialogs/:userId', (req, res) => {
    const userId = req.params.userId;
    const userDialogs = Array.from(dialogs.values()).filter(d => d.user1 === userId || d.user2 === userId);
    res.json(userDialogs);
});

// ============ СООБЩЕНИЯ ==========
app.post('/api/messages', async (req, res) => {
    const { from, to, type, text } = req.body;
    const sender = users.get(from);
    
    // Проверка спам-блока
    if (sender.spamBlocked) {
        if (sender.spamUntil && sender.spamUntil > Date.now()) {
            return res.status(403).json({ error: 'spam_blocked', reason: sender.spamReason, until: sender.spamUntil });
        } else if (sender.spamUntil && sender.spamUntil <= Date.now()) {
            sender.spamBlocked = false;
            sender.spamReason = null;
            sender.spamUntil = null;
        } else {
            return res.status(403).json({ error: 'spam_blocked', reason: sender.spamReason });
        }
    }
    
    if (sender.frozen) return res.status(403).json({ error: 'frozen' });
    if (sender.banned) return res.status(403).json({ error: 'banned' });
    
    const dialogId = [from, to].sort().join('_');
    if (!messages.has(dialogId)) messages.set(dialogId, []);
    
    const msg = {
        id: uuidv4(),
        fromUserId: from,
        type,
        text,
        ts: Date.now()
    };
    messages.get(dialogId).push(msg);
    
    const dialog = dialogs.get(dialogId);
    if (dialog) {
        dialog.lastMessage = text;
        dialog.updatedAt = Date.now();
        dialogs.set(dialogId, dialog);
    }
    
    res.json({ success: true });
});

app.get('/api/messages/:userId', (req, res) => {
    const currentUserId = req.query.currentUserId;
    const dialogId = [currentUserId, req.params.userId].sort().join('_');
    const msgs = messages.get(dialogId) || [];
    res.json(msgs);
});

// ============ СПАМ-ИНФО БОТ ==========
app.get('/api/bot/spam-info/:userId', (req, res) => {
    const user = users.get(req.params.userId);
    if (!user) return res.json({ exists: false });
    res.json({
        exists: true,
        isBlocked: user.spamBlocked,
        reason: user.spamReason,
        until: user.spamUntil,
        name: user.name
    });
});

app.get('/api/bot/messages/:userId', (req, res) => {
    const msgs = botMessages.get(req.params.userId) || [];
    res.json(msgs);
});

// ============ КАНАЛЫ И ГРУППЫ ==========
app.get('/api/chats', (req, res) => {
    res.json(Array.from(chats.values()));
});

app.post('/api/chats', (req, res) => {
    const { type, title, description, creatorId, isPublic } = req.body;
    const id = uuidv4();
    chats.set(id, {
        id,
        type,
        title,
        description,
        creatorId,
        isPublic: isPublic !== false ? 1 : 0,
        members: [creatorId]
    });
    res.json({ success: true, id });
});

app.get('/api/my/chats/:userId', (req, res) => {
    const userChats = Array.from(chats.values()).filter(c => c.members.includes(req.params.userId));
    res.json(userChats);
});

app.post('/api/chats/:id/join', (req, res) => {
    const chat = chats.get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (chat.isPublic === 0) return res.status(403).json({ error: 'Приватный чат' });
    if (!chat.members.includes(req.body.userId)) {
        chat.members.push(req.body.userId);
        chats.set(req.params.id, chat);
    }
    res.json({ success: true });
});

app.post('/api/chats/:id/messages', (req, res) => {
    const chat = chats.get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (chat.type === 'channel' && chat.creatorId !== req.body.fromUserId) {
        return res.status(403).json({ error: 'Только создатель может писать' });
    }
    
    const dialogId = `chat_${req.params.id}`;
    if (!messages.has(dialogId)) messages.set(dialogId, []);
    messages.get(dialogId).push({
        id: uuidv4(),
        fromUserId: req.body.fromUserId,
        type: req.body.type,
        text: req.body.text,
        ts: Date.now()
    });
    res.json({ success: true });
});

app.get('/api/chats/:id/messages', (req, res) => {
    const dialogId = `chat_${req.params.id}`;
    res.json(messages.get(dialogId) || []);
});

app.put('/api/chats/:id', (req, res) => {
    const chat = chats.get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Не найден' });
    if (req.body.isPublic !== undefined) chat.isPublic = req.body.isPublic ? 1 : 0;
    if (req.body.title !== undefined) chat.title = req.body.title;
    if (req.body.description !== undefined) chat.description = req.body.description;
    chats.set(req.params.id, chat);
    res.json({ success: true });
});

app.delete('/api/chats/:id', (req, res) => {
    chats.delete(req.params.id);
    res.json({ success: true });
});

// ============ ЖАЛОБЫ ==========
app.get('/api/reports', (req, res) => {
    res.json(reports);
});

app.post('/api/reports', (req, res) => {
    reports.push({
        id: uuidv4(),
        fromUserId: req.body.from,
        againstId: req.body.againstId,
        type: req.body.type,
        reason: req.body.reason,
        comment: req.body.comment,
        status: 'pending',
        ts: Date.now()
    });
    res.json({ success: true });
});

app.put('/api/reports/:id', (req, res) => {
    const report = reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: 'Не найдено' });
    
    report.status = req.body.status;
    if (req.body.action === 'delete' && report.type === 'chat') {
        chats.delete(report.againstId);
    }
    if (req.body.action === 'ban') {
        const user = users.get(report.againstId);
        if (user) user.banned = true;
    }
    if (req.body.action === 'freeze') {
        const user = users.get(report.againstId);
        if (user) user.frozen = true;
    }
    if (req.body.action === 'spam') {
        const user = users.get(report.againstId);
        if (user) {
            user.spamBlocked = true;
            user.spamReason = `Жалоба: ${report.reason}`;
            user.spamUntil = req.body.duration ? Date.now() + (req.body.duration * 60 * 60 * 1000) : null;
            
            // Уведомление
            const botMsg = {
                id: uuidv4(),
                userId: user.id,
                title: '🚫 Спам-блок',
                message: `Вы получили спам-блок! Причина: ${report.reason}. Подробнее: @SpamInfoBot`,
                ts: Date.now(),
                read: 0
            };
            if (!botMessages.has(user.id)) botMessages.set(user.id, []);
            botMessages.get(user.id).push(botMsg);
        }
    }
    
    res.json({ success: true });
});

// ============ АПЕЛЛЯЦИИ ==========
app.get('/api/appeals', (req, res) => {
    res.json(appeals);
});

app.post('/api/appeals', (req, res) => {
    appeals.push({
        id: uuidv4(),
        userId: req.body.userId,
        reason: req.body.reason,
        status: 'pending',
        ts: Date.now()
    });
    res.json({ success: true });
});

app.put('/api/appeals/:id', (req, res) => {
    const appeal = appeals.find(a => a.id === req.params.id);
    if (!appeal) return res.status(404).json({ error: 'Не найдено' });
    
    appeal.status = req.body.status;
    appeal.adminComment = req.body.adminComment;
    
    if (req.body.status === 'approved') {
        const user = users.get(appeal.userId);
        if (user) {
            user.spamBlocked = false;
            user.spamReason = null;
            user.spamUntil = null;
            
            const botMsg = {
                id: uuidv4(),
                userId: user.id,
                title: '✅ Апелляция одобрена',
                message: `Ваш спам-блок снят!`,
                ts: Date.now(),
                read: 0
            };
            if (!botMessages.has(user.id)) botMessages.set(user.id, []);
            botMessages.get(user.id).push(botMsg);
        }
    }
    
    res.json({ success: true });
});

// ============ СТАТИСТИКА ==========
app.get('/api/stats', (req, res) => {
    res.json({
        users: Array.from(users.values()).filter(u => u.id !== 'admin').length,
        messages: Array.from(messages.values()).reduce((a, b) => a + b.length, 0),
        reports: reports.length,
        pendingReports: reports.filter(r => r.status === 'pending').length,
        pendingAppeals: appeals.filter(a => a.status === 'pending').length,
        bannedUsers: Array.from(users.values()).filter(u => u.banned).length,
        frozenUsers: Array.from(users.values()).filter(u => u.frozen).length,
        spamBlockedUsers: Array.from(users.values()).filter(u => u.spamBlocked).length,
        chats: chats.size
    });
});

app.post('/api/admin/reset', (req, res) => {
    res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер на порту ${PORT}`);
    console.log(`📱 Мессенджер: http://localhost:${PORT}`);
    console.log(`🛡️ Админка: http://localhost:${PORT}/admin.html`);
});
