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
app.use(express.json());
app.use(express.static('public'));

// ============ ДАННЫЕ В ФАЙЛЕ ============
const DATA_FILE = path.join(__dirname, 'data.json');

let data = {
    users: {},
    messages: {},
    dialogs: {},
    chats: {},
    notifications: {},
    reports: [],
    globalBanner: { text: '', link: '' }
};

// Загружаем данные
if (fs.existsSync(DATA_FILE)) {
    try {
        const saved = fs.readFileSync(DATA_FILE, 'utf8');
        data = JSON.parse(saved);
        console.log('✅ Данные загружены');
    } catch(e) { console.log('Ошибка загрузки'); }
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('💾 Данные сохранены локально');
}

// ============ БЭКАП В GITHUB ============
function backupToGitHub() {
    if (!process.env.GITHUB_TOKEN) {
        console.log('⚠️ Нет GITHUB_TOKEN, бэкап не работает');
        return;
    }
    
    console.log('💾 Сохраняем данные в GitHub...');
    
    exec(`cd /opt/render/project/src && 
          git config user.name "Render Backup" && 
          git config user.email "backup@render.com" &&
          git add data.json &&
          git commit -m "Auto-backup: ${new Date().toISOString()}" || echo "Нет изменений" &&
          git push https://${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPO}.git main`,
        (error, stdout, stderr) => {
            if (error) {
                console.log('❌ Бэкап не удался:', error.message);
            } else {
                console.log('✅ Бэкап сохранён в GitHub');
            }
        });
}

// Восстановление при старте
function restoreFromGitHub() {
    if (!process.env.GITHUB_TOKEN) return;
    exec(`cd /opt/render/project/src && git pull origin main`, (error) => {
        if (!error) {
            console.log('✅ Данные восстановлены из GitHub');
            if (fs.existsSync(DATA_FILE)) {
                try {
                    const saved = fs.readFileSync(DATA_FILE, 'utf8');
                    data = JSON.parse(saved);
                    console.log('✅ Данные загружены после восстановления');
                } catch(e) {}
            }
        }
    });
}

// Авто-бэкап каждые 5 минут
setInterval(backupToGitHub, 300000);
// Восстановление при запуске
setTimeout(restoreFromGitHub, 3000);

// ============ ДЕФОЛТНЫЙ АДМИН ============
if (!data.users['admin']) {
    data.users['admin'] = {
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
        createdAt: Date.now()
    };
    saveData();
}

// ============ УВЕДОМЛЕНИЯ ============
function sendNotification(userId, title, message) {
    if (!data.notifications[userId]) data.notifications[userId] = [];
    data.notifications[userId].push({
        id: uuidv4(),
        title,
        message,
        ts: Date.now(),
        read: false
    });
    saveData();
}

// ============ API ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'messenger.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/banner', (req, res) => res.json(data.globalBanner));
app.post('/api/admin/banner', (req, res) => {
    data.globalBanner = { text: req.body.text || '', link: req.body.link || '' };
    saveData();
    res.json({ success: true });
});

app.post('/api/admin/send-notification', (req, res) => {
    const { userId, title, message } = req.body;
    if (!userId || !title || !message) return res.status(400).json({ error: 'Заполните поля' });
    sendNotification(userId, title, message);
    res.json({ success: true });
});

app.get('/api/notifications/:userId', (req, res) => {
    res.json(data.notifications[req.params.userId] || []);
});

app.post('/api/notifications/mark-read', (req, res) => {
    const { userId } = req.body;
    if (data.notifications[userId]) {
        data.notifications[userId].forEach(n => n.read = true);
        saveData();
    }
    res.json({ success: true });
});

// ============ ПОЛЬЗОВАТЕЛИ ============
app.post('/api/register', async (req, res) => {
    const { name, username, password } = req.body;
    if (!name || !username || !password) return res.status(400).json({ error: 'Заполните поля' });
    if (data.users[username]) return res.status(400).json({ error: 'Пользователь уже есть' });
    
    data.users[username] = {
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
        createdAt: Date.now()
    };
    saveData();
    backupToGitHub();
    sendNotification(username, '🎉 Добро пожаловать!', `Вы успешно зарегистрировались!`);
    res.json({ success: true, user: { id: username, name, username, stars: 100 } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = data.users[username];
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
    if (user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Неверный пароль' });
    
    sendNotification(username, '🔐 Новый вход', `Вход в аккаунт выполнен`);
    
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
            spamBlocked: user.spamBlocked
        }
    });
});

app.get('/api/users', (req, res) => {
    const all = Object.values(data.users).filter(u => u.id !== 'admin').map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        stars: u.stars,
        tags: u.tags,
        banned: u.banned,
        frozen: u.frozen,
        spamBlocked: u.spamBlocked
    }));
    res.json(all);
});

app.get('/api/users/:id', (req, res) => {
    const user = data.users[req.params.id];
    if (!user) return res.status(404).json({ error: 'Не найден' });
    res.json({
        id: user.id,
        name: user.name,
        username: user.username,
        stars: user.stars,
        tags: user.tags,
        frozen: user.frozen,
        banned: user.banned,
        spamBlocked: user.spamBlocked,
        spamReason: user.spamReason,
        spamUntil: user.spamUntil
    });
});

app.put('/api/users/:id', (req, res) => {
    const user = data.users[req.params.id];
    if (!user) return res.status(404).json({ error: 'Не найден' });
    
    if (req.body.stars !== undefined) user.stars = req.body.stars;
    if (req.body.banned !== undefined) user.banned = req.body.banned;
    if (req.body.frozen !== undefined) user.frozen = req.body.frozen;
    if (req.body.name !== undefined) user.name = req.body.name;
    if (req.body.bio !== undefined) user.bio = req.body.bio;
    if (req.body.tags !== undefined) user.tags = req.body.tags;
    
    if (req.body.spamBlocked !== undefined) {
        user.spamBlocked = req.body.spamBlocked;
        user.spamReason = req.body.spamReason;
        user.spamUntil = req.body.spamUntil;
        if (user.spamBlocked) {
            sendNotification(user.id, '🚫 Спам-блок', `Вы получили спам-блок! Причина: ${user.spamReason || 'нарушение'}`);
        }
    }
    saveData();
    backupToGitHub();
    res.json({ success: true });
});

// ============ ДИАЛОГИ ============
app.post('/api/dialogs', (req, res) => {
    const { user1, user2 } = req.body;
    const dialogId = [user1, user2].sort().join('_');
    if (!data.dialogs[dialogId]) {
        data.dialogs[dialogId] = { id: dialogId, user1, user2, lastMessage: null, updatedAt: Date.now() };
        saveData();
    }
    res.json({ success: true, dialogId });
});

app.get('/api/dialogs/:userId', (req, res) => {
    const userId = req.params.userId;
    const userDialogs = Object.values(data.dialogs).filter(d => d.user1 === userId || d.user2 === userId);
    res.json(userDialogs);
});

// ============ СООБЩЕНИЯ ============
app.post('/api/messages', async (req, res) => {
    const { from, to, type, text } = req.body;
    const sender = data.users[from];
    
    if (sender.spamBlocked) {
        if (sender.spamUntil && sender.spamUntil > Date.now()) {
            return res.status(403).json({ error: 'spam_blocked', reason: sender.spamReason, until: sender.spamUntil });
        } else if (sender.spamUntil && sender.spamUntil <= Date.now()) {
            sender.spamBlocked = false;
            sender.spamReason = null;
            sender.spamUntil = null;
            saveData();
        } else {
            return res.status(403).json({ error: 'spam_blocked', reason: sender.spamReason });
        }
    }
    
    if (sender.frozen) return res.status(403).json({ error: 'frozen' });
    if (sender.banned) return res.status(403).json({ error: 'banned' });
    
    const dialogId = [from, to].sort().join('_');
    if (!data.messages[dialogId]) data.messages[dialogId] = [];
    
    data.messages[dialogId].push({
        id: uuidv4(),
        fromUserId: from,
        type,
        text,
        ts: Date.now()
    });
    
    if (data.dialogs[dialogId]) {
        data.dialogs[dialogId].lastMessage = text;
        data.dialogs[dialogId].updatedAt = Date.now();
    }
    saveData();
    res.json({ success: true });
});

app.get('/api/messages/:userId', (req, res) => {
    const currentUserId = req.query.currentUserId;
    const dialogId = [currentUserId, req.params.userId].sort().join('_');
    res.json(data.messages[dialogId] || []);
});

// ============ КАНАЛЫ ============
app.get('/api/chats', (req, res) => res.json(Object.values(data.chats)));

app.post('/api/chats', (req, res) => {
    const { type, title, description, creatorId, isPublic } = req.body;
    const id = uuidv4();
    data.chats[id] = {
        id, type, title, description, creatorId,
        isPublic: isPublic !== false ? 1 : 0,
        members: [creatorId]
    };
    saveData();
    res.json({ success: true, id });
});

app.get('/api/my/chats/:userId', (req, res) => {
    res.json(Object.values(data.chats).filter(c => c.members.includes(req.params.userId)));
});

app.post('/api/chats/:id/join', (req, res) => {
    const chat = data.chats[req.params.id];
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (chat.isPublic === 0) return res.status(403).json({ error: 'Приватный чат' });
    if (!chat.members.includes(req.body.userId)) {
        chat.members.push(req.body.userId);
        saveData();
    }
    res.json({ success: true });
});

app.post('/api/chats/:id/messages', (req, res) => {
    const chat = data.chats[req.params.id];
    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    if (chat.type === 'channel' && chat.creatorId !== req.body.fromUserId) {
        return res.status(403).json({ error: 'Только создатель может писать' });
    }
    
    const dialogId = `chat_${req.params.id}`;
    if (!data.messages[dialogId]) data.messages[dialogId] = [];
    data.messages[dialogId].push({
        id: uuidv4(),
        fromUserId: req.body.fromUserId,
        type: req.body.type,
        text: req.body.text,
        ts: Date.now()
    });
    saveData();
    res.json({ success: true });
});

app.get('/api/chats/:id/messages', (req, res) => {
    res.json(data.messages[`chat_${req.params.id}`] || []);
});

app.put('/api/chats/:id', (req, res) => {
    const chat = data.chats[req.params.id];
    if (!chat) return res.status(404).json({ error: 'Не найден' });
    if (req.body.isPublic !== undefined) chat.isPublic = req.body.isPublic ? 1 : 0;
    if (req.body.title !== undefined) chat.title = req.body.title;
    if (req.body.description !== undefined) chat.description = req.body.description;
    saveData();
    res.json({ success: true });
});

app.delete('/api/chats/:id', (req, res) => {
    delete data.chats[req.params.id];
    saveData();
    res.json({ success: true });
});

// ============ ЖАЛОБЫ ============
app.get('/api/reports', (req, res) => res.json(data.reports));

app.post('/api/reports', (req, res) => {
    data.reports.push({
        id: uuidv4(),
        fromUserId: req.body.from,
        againstId: req.body.againstId,
        type: req.body.type,
        reason: req.body.reason,
        comment: req.body.comment,
        status: 'pending',
        ts: Date.now()
    });
    saveData();
    res.json({ success: true });
});

app.put('/api/reports/:id', (req, res) => {
    const report = data.reports.find(r => r.id === req.params.id);
    if (!report) return res.status(404).json({ error: 'Не найдено' });
    
    report.status = req.body.status;
    if (req.body.action === 'delete' && report.type === 'chat') delete data.chats[report.againstId];
    if (req.body.action === 'ban' && data.users[report.againstId]) data.users[report.againstId].banned = true;
    if (req.body.action === 'freeze' && data.users[report.againstId]) data.users[report.againstId].frozen = true;
    if (req.body.action === 'spam' && data.users[report.againstId]) {
        const user = data.users[report.againstId];
        user.spamBlocked = true;
        user.spamReason = `Жалоба: ${report.reason}`;
        user.spamUntil = req.body.duration ? Date.now() + (req.body.duration * 60 * 60 * 1000) : null;
        sendNotification(report.againstId, '🚫 Спам-блок', `Вы получили спам-блок! Причина: ${report.reason}`);
    }
    saveData();
    res.json({ success: true });
});

// ============ СТАТИСТИКА ============
app.get('/api/stats', (req, res) => {
    res.json({
        users: Object.values(data.users).filter(u => u.id !== 'admin').length,
        messages: Object.values(data.messages).reduce((a, b) => a + b.length, 0),
        reports: data.reports.length,
        pendingReports: data.reports.filter(r => r.status === 'pending').length,
        bannedUsers: Object.values(data.users).filter(u => u.banned).length,
        frozenUsers: Object.values(data.users).filter(u => u.frozen).length,
        spamBlockedUsers: Object.values(data.users).filter(u => u.spamBlocked).length,
        chats: Object.keys(data.chats).length
    });
});

// ============ ЗАПУСК ============
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`💾 Данные сохраняются в data.json и GitHub`);
});
