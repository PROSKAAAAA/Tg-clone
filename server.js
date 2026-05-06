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

// ============ БД В ПАМЯТИ ============
const users = new Map();
const messages = new Map();
const dialogs = new Map();
const reports = [];
const appeals = [];
const chats = new Map();
const subscriptions = new Map();

// Уведомления от бота @TelegramNotifications
const notifications = new Map();

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

// ============ СТРАНИЦЫ ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'messenger.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ============ АУТЕНТИФИКАЦИЯ ============
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
    
    // Уведомление от бота
    sendNotification(username, '🎉 Добро пожаловать!', `Вы успешно зарегистрировались в Telegram!`);
    
    res.json({ success: true, user: { id: username, name, username, stars: 100 } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.get(username);
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
    if (user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Неверный пароль' });
    
    // Уведомление о входе
    sendNotification(username, '🔐 Новый вход', `Вход в аккаунт выполнен с нового устройства`);
    
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
        
        if (user.spamBlocked) {
            sendNotification(user.id, '🚫 Спам-блок', `Вы получили спам-блок! Причина: ${user.spamReason || 'нарушение правил'}. Обратитесь к @SpamInfoBot`);
        }
    }
    
    res.json({ success: true });
});

// ============ УВЕДОМЛЕНИЯ ОТ БОТА ============
function sendNotification(userId, title, message) {
    if (!notifications.has(userId)) notifications.set(userId, []);
    notifications.get(userId).push({
        id: uuidv4(),
        title,
        message,
        ts: Date.now(),
        read: false
    });
}

// Админ отправляет уведомление от лица бота
app.post('/api/admin/send-notification', (req, res) => {
    const { userId, title, message } = req.body;
    if (!userId || !title || !message) return res.status(400).json({ error: 'Заполните поля' });
    sendNotification(userId, title, message);
    res.json({ success: true });
});

app.get('/api/notifications/:userId', (req, res) => {
    const userNotifs = notifications.get(req.params.userId) || [];
    res.json(userNotifs);
});

app.post('/api/notifications/mark-read', (req, res) => {
    const { userId } = req.body;
    const userNotifs = notifications.get(userId);
    if (userNotifs) {
        userNotifs.forEach(n => n.read = true);
        notifications.set(userId, userNotifs);
    }
    res.json({ success: true });
});

// ============ БОТ @SpamInfoBot ============
// Хранилище апелляций от бота
const botAppeals = new Map();

app.post('/api/bot/spam-info', (req, res) => {
    const { userId, command, text } = req.body;
    const user = users.get(userId);
    if (!user) return res.json({ error: 'Пользователь не найден' });
    
    let response = '';
    let appeals = botAppeals.get(userId) || [];
    
    if (command === '/start') {
        if (user.spamBlocked) {
            response = `🚫 **У вас активен спам-блок!**\n\n📋 **Причина:** ${user.spamReason || 'Не указана'}\n⏰ **До:** ${user.spamUntil ? new Date(user.spamUntil).toLocaleString() : 'Навсегда'}\n\n📝 Для подачи апелляции отправьте команду /appeal с указанием причины`;
        } else {
            response = `✅ **У вас нет активных ограничений**\n\nВы можете отправлять сообщения без ограничений. Если вы считаете, что блок был выдан ошибочно, отправьте /appeal`;
        }
    } 
    else if (command === '/appeal') {
        if (!user.spamBlocked) {
            response = `❌ У вас нет активного спам-блока. Апелляция не требуется.`;
        } else {
            const reason = text || 'Причина не указана';
            appeals.push({
                id: uuidv4(),
                reason,
                ts: Date.now(),
                status: 'pending'
            });
            botAppeals.set(userId, appeals);
            response = `✅ Ваша апелляция принята! Администратор рассмотрит её в ближайшее время.`;
            // Уведомляем админа
            sendNotification('admin', '📝 Новая апелляция', `Пользователь @${userId} подал апелляцию: ${reason}`);
        }
    }
    else {
        response = `🤖 **@SpamInfoBot**\n\nДоступные команды:\n/start - Проверить статус спам-блока\n/appeal [причина] - Подать апелляцию`;
    }
    
    res.json({ response, appeals: appeals.filter(a => a.status === 'pending') });
});

app.get('/api/bot/appeals', (req, res) => {
    const allAppeals = [];
    for (const [userId, appeals] of botAppeals) {
        appeals.forEach(a => {
            if (a.status === 'pending') {
                allAppeals.push({ userId, ...a });
            }
        });
    }
    res.json(allAppeals);
});

app.post('/api/bot/appeals/:id', (req, res) => {
    const { id } = req.params;
    const { status, adminComment } = req.body;
    
    for (const [userId, appeals] of botAppeals) {
        const appeal = appeals.find(a => a.id === id);
        if (appeal) {
            appeal.status = status;
            appeal.adminComment = adminComment;
            botAppeals.set(userId, appeals);
            
            if (status === 'approved') {
                const user = users.get(userId);
                if (user) {
                    user.spamBlocked = false;
                    user.spamReason = null;
                    user.spamUntil = null;
                    sendNotification(userId, '✅ Апелляция одобрена', `Ваш спам-блок снят!`);
                }
            } else if (status === 'rejected') {
                sendNotification(userId, '❌ Апелляция отклонена', `Ваша апелляция отклонена. Причина: ${adminComment || 'не указана'}`);
            }
            break;
        }
    }
    res.json({ success: true });
});

// ============ ДИАЛОГИ ============
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

// ============ СООБЩЕНИЯ ============
app.post('/api/messages', async (req, res) => {
    const { from, to, type, text } = req.body;
    const sender = users.get(from);
    
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

// ============ ЖАЛОБЫ ============
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
        sendNotification('admin', '🗑️ Канал удалён', `Канал ${report.againstId} удалён по жалобе`);
    }
    if (req.body.action === 'ban') {
        const user = users.get(report.againstId);
        if (user) user.banned = true;
        sendNotification(report.againstId, '⛔ Аккаунт заблокирован', `Ваш аккаунт заблокирован администратором`);
    }
    if (req.body.action === 'freeze') {
        const user = users.get(report.againstId);
        if (user) user.frozen = true;
        sendNotification(report.againstId, '❄️ Аккаунт заморожен', `Ваш аккаунт заморожен администратором`);
    }
    if (req.body.action === 'spam') {
        const user = users.get(report.againstId);
        if (user) {
            user.spamBlocked = true;
            user.spamReason = `Жалоба: ${report.reason}`;
            user.spamUntil = req.body.duration ? Date.now() + (req.body.duration * 60 * 60 * 1000) : null;
            sendNotification(report.againstId, '🚫 Спам-блок', `Вы получили спам-блок! Причина: ${report.reason}. Обратитесь к @SpamInfoBot`);
        }
    }
    
    res.json({ success: true });
});

// ============ СТАТИСТИКА ============
app.get('/api/stats', (req, res) => {
    res.json({
        users: Array.from(users.values()).filter(u => u.id !== 'admin').length,
        messages: Array.from(messages.values()).reduce((a, b) => a + b.length, 0),
        reports: reports.length,
        pendingReports: reports.filter(r => r.status === 'pending').length,
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
    console.log(`✅ Сервер запущен на порту ${PORT}`);
});
