const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============ ПОДКЛЮЧЕНИЕ К POSTGRESQL (SUPABASE) ============
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ============ СОЗДАНИЕ ТАБЛИЦ ============
async function initDB() {
    // Таблица пользователей
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT,
            username TEXT UNIQUE,
            password TEXT,
            avatar TEXT,
            bio TEXT,
            stars INTEGER DEFAULT 100,
            tags TEXT[] DEFAULT '{}',
            banned BOOLEAN DEFAULT false,
            frozen BOOLEAN DEFAULT false,
            spam_blocked BOOLEAN DEFAULT false,
            spam_reason TEXT,
            spam_until BIGINT,
            last_seen BIGINT,
            created_at BIGINT
        )
    `);
    
    // Таблица сообщений
    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            dialog_id TEXT,
            from_user_id TEXT,
            type TEXT,
            text TEXT,
            ts BIGINT
        )
    `);
    
    // Таблица диалогов
    await pool.query(`
        CREATE TABLE IF NOT EXISTS dialogs (
            id TEXT PRIMARY KEY,
            user1 TEXT,
            user2 TEXT,
            last_message TEXT,
            updated_at BIGINT
        )
    `);
    
    // Таблица каналов/групп
    await pool.query(`
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            type TEXT,
            title TEXT,
            description TEXT,
            creator_id TEXT,
            is_public INTEGER DEFAULT 1,
            members TEXT[] DEFAULT '{}',
            created_at BIGINT
        )
    `);
    
    // Таблица уведомлений
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            title TEXT,
            message TEXT,
            ts BIGINT,
            read BOOLEAN DEFAULT false
        )
    `);
    
    // Таблица жалоб
    await pool.query(`
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            from_user_id TEXT,
            against_id TEXT,
            type TEXT,
            reason TEXT,
            comment TEXT,
            status TEXT,
            ts BIGINT
        )
    `);
    
    // Таблица апелляций
    await pool.query(`
        CREATE TABLE IF NOT EXISTS bot_appeals (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            reason TEXT,
            status TEXT,
            admin_comment TEXT,
            ts BIGINT
        )
    `);
    
    // Создаём админа если нет
    const adminCheck = await pool.query("SELECT * FROM users WHERE id = 'admin'");
    if (adminCheck.rows.length === 0) {
        const hashedPassword = await bcrypt.hash('admin2024', 10);
        await pool.query(
            `INSERT INTO users (id, name, username, password, stars, tags, last_seen, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            ['admin', 'Admin', 'admin', hashedPassword, 999999, ['verified'], Date.now(), Date.now()]
        );
        console.log('✅ Админ создан');
    }
    
    console.log('✅ База данных готова');
}

initDB().catch(console.error);

// ============ ОБНОВЛЕНИЕ LAST SEEN ============
async function updateLastSeen(userId) {
    await pool.query("UPDATE users SET last_seen = $1 WHERE id = $2", [Date.now(), userId]);
}

// ============ УВЕДОМЛЕНИЯ ============
async function sendNotification(userId, title, message) {
    const id = uuidv4();
    await pool.query(
        `INSERT INTO notifications (id, user_id, title, message, ts) VALUES ($1, $2, $3, $4, $5)`,
        [id, userId, title, message, Date.now()]
    );
}

// ============ ГЛОБАЛЬНЫЙ БАННЕР ============
let globalBanner = { text: '', link: '' };
app.get('/api/banner', (req, res) => res.json(globalBanner));
app.post('/api/admin/banner', (req, res) => {
    globalBanner = { text: req.body.text || '', link: req.body.link || '' };
    res.json({ success: true });
});

// ============ API ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'messenger.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ============ УВЕДОМЛЕНИЯ ============
app.post('/api/admin/send-notification', async (req, res) => {
    const { userId, title, message } = req.body;
    if (!userId || !title || !message) return res.status(400).json({ error: 'Заполните поля' });
    await sendNotification(userId, title, message);
    res.json({ success: true });
});

app.get('/api/notifications/:userId', async (req, res) => {
    const result = await pool.query(
        "SELECT * FROM notifications WHERE user_id = $1 ORDER BY ts DESC",
        [req.params.userId]
    );
    res.json(result.rows);
});

app.post('/api/notifications/mark-read', async (req, res) => {
    await pool.query("UPDATE notifications SET read = true WHERE user_id = $1", [req.body.userId]);
    res.json({ success: true });
});

// ============ АУТЕНТИФИКАЦИЯ ============
app.post('/api/register', async (req, res) => {
    const { name, username, password } = req.body;
    if (!name || !username || !password) return res.status(400).json({ error: 'Заполните поля' });
    
    const existing = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Пользователь уже есть' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const now = Date.now();
    await pool.query(
        `INSERT INTO users (id, name, username, password, stars, last_seen, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [username, name, username, hashedPassword, 100, now, now]
    );
    
    await sendNotification(username, '🎉 Добро пожаловать!', `Вы успешно зарегистрировались!`);
    res.json({ success: true, user: { id: username, name, username, stars: 100 } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [username]);
    const user = result.rows[0];
    
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
    if (user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Неверный пароль' });
    
    // Обновляем last_seen
    await updateLastSeen(username);
    await sendNotification(username, '🔐 Новый вход', `Вход в аккаунт выполнен`);
    
    res.json({
        success: true,
        user: {
            id: user.id,
            name: user.name,
            username: user.username,
            stars: user.stars,
            tags: user.tags || [],
            banned: user.banned,
            frozen: user.frozen,
            spamBlocked: user.spam_blocked,
            lastSeen: user.last_seen
        }
    });
});

app.get('/api/users', async (req, res) => {
    const result = await pool.query(
        "SELECT id, name, username, stars, tags, banned, frozen, spam_blocked, last_seen FROM users WHERE id != 'admin'"
    );
    res.json(result.rows);
});

app.get('/api/users/:id', async (req, res) => {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Не найден' });
    res.json(result.rows[0]);
});

app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { stars, banned, frozen, name, bio, tags, spamBlocked, spamReason, spamUntil } = req.body;
    
    if (stars !== undefined) await pool.query("UPDATE users SET stars = $1 WHERE id = $2", [stars, id]);
    if (banned !== undefined) await pool.query("UPDATE users SET banned = $1 WHERE id = $2", [banned, id]);
    if (frozen !== undefined) await pool.query("UPDATE users SET frozen = $1 WHERE id = $2", [frozen, id]);
    if (name !== undefined) await pool.query("UPDATE users SET name = $1 WHERE id = $2", [name, id]);
    if (bio !== undefined) await pool.query("UPDATE users SET bio = $1 WHERE id = $2", [bio, id]);
    if (tags !== undefined) await pool.query("UPDATE users SET tags = $1 WHERE id = $2", [tags, id]);
    
    if (spamBlocked !== undefined) {
        await pool.query(
            "UPDATE users SET spam_blocked = $1, spam_reason = $2, spam_until = $3 WHERE id = $4",
            [spamBlocked, spamReason || null, spamUntil || null, id]
        );
        if (spamBlocked) {
            await sendNotification(id, '🚫 Спам-блок', `Вы получили спам-блок! Причина: ${spamReason || 'нарушение'}`);
        }
    }
    
    res.json({ success: true });
});

// ============ ДИАЛОГИ ============
app.post('/api/dialogs', async (req, res) => {
    const { user1, user2 } = req.body;
    const dialogId = [user1, user2].sort().join('_');
    const existing = await pool.query("SELECT * FROM dialogs WHERE id = $1", [dialogId]);
    if (existing.rows.length === 0) {
        await pool.query(
            "INSERT INTO dialogs (id, user1, user2, updated_at) VALUES ($1, $2, $3, $4)",
            [dialogId, user1, user2, Date.now()]
        );
    }
    res.json({ success: true, dialogId });
});

app.get('/api/dialogs/:userId', async (req, res) => {
    const userId = req.params.userId;
    const result = await pool.query(
        "SELECT * FROM dialogs WHERE user1 = $1 OR user2 = $1 ORDER BY updated_at DESC",
        [userId]
    );
    res.json(result.rows);
});

// ============ СООБЩЕНИЯ ============
app.post('/api/messages', async (req, res) => {
    const { from, to, type, text } = req.body;
    
    const sender = await pool.query("SELECT * FROM users WHERE id = $1", [from]);
    const user = sender.rows[0];
    
    if (user.spam_blocked) {
        if (user.spam_until && user.spam_until > Date.now()) {
            return res.status(403).json({ error: 'spam_blocked', reason: user.spam_reason, until: user.spam_until });
        } else if (user.spam_until && user.spam_until <= Date.now()) {
            await pool.query("UPDATE users SET spam_blocked = false, spam_reason = NULL, spam_until = NULL WHERE id = $1", [from]);
        } else {
            return res.status(403).json({ error: 'spam_blocked', reason: user.spam_reason });
        }
    }
    
    if (user.frozen) return res.status(403).json({ error: 'frozen' });
    if (user.banned) return res.status(403).json({ error: 'banned' });
    
    // Обновляем last_seen отправителя
    await updateLastSeen(from);
    
    const dialogId = [from, to].sort().join('_');
    const messageId = uuidv4();
    
    await pool.query(
        `INSERT INTO messages (id, dialog_id, from_user_id, type, text, ts) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [messageId, dialogId, from, type, text, Date.now()]
    );
    
    await pool.query(
        "UPDATE dialogs SET last_message = $1, updated_at = $2 WHERE id = $3",
        [text, Date.now(), dialogId]
    );
    
    res.json({ success: true });
});

app.get('/api/messages/:userId', async (req, res) => {
    const currentUserId = req.query.currentUserId;
    const dialogId = [currentUserId, req.params.userId].sort().join('_');
    const result = await pool.query(
        "SELECT * FROM messages WHERE dialog_id = $1 ORDER BY ts ASC",
        [dialogId]
    );
    // Обновляем last_seen получателя
    await updateLastSeen(req.params.userId);
    res.json(result.rows);
});

// ============ КАНАЛЫ ============
app.get('/api/chats', async (req, res) => {
    const result = await pool.query("SELECT * FROM chats");
    res.json(result.rows);
});

app.post('/api/chats', async (req, res) => {
    const { type, title, description, creatorId, isPublic } = req.body;
    const id = uuidv4();
    await pool.query(
        `INSERT INTO chats (id, type, title, description, creator_id, is_public, members, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, type, title, description, creatorId, isPublic !== false ? 1 : 0, [creatorId], Date.now()]
    );
    res.json({ success: true, id });
});

app.get('/api/my/chats/:userId', async (req, res) => {
    const result = await pool.query("SELECT * FROM chats WHERE $1 = ANY(members)", [req.params.userId]);
    res.json(result.rows);
});

app.post('/api/chats/:id/join', async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body;
    const chat = await pool.query("SELECT * FROM chats WHERE id = $1", [id]);
    if (chat.rows.length === 0) return res.status(404).json({ error: 'Чат не найден' });
    if (chat.rows[0].is_public === 0) return res.status(403).json({ error: 'Приватный чат' });
    
    const members = chat.rows[0].members;
    if (!members.includes(userId)) {
        members.push(userId);
        await pool.query("UPDATE chats SET members = $1 WHERE id = $2", [members, id]);
    }
    res.json({ success: true });
});

app.post('/api/chats/:id/messages', async (req, res) => {
    const { id } = req.params;
    const { fromUserId, type, text } = req.body;
    const chat = await pool.query("SELECT * FROM chats WHERE id = $1", [id]);
    if (chat.rows.length === 0) return res.status(404).json({ error: 'Чат не найден' });
    if (chat.rows[0].type === 'channel' && chat.rows[0].creator_id !== fromUserId) {
        return res.status(403).json({ error: 'Только создатель может писать' });
    }
    
    await updateLastSeen(fromUserId);
    
    const messageId = uuidv4();
    await pool.query(
        `INSERT INTO messages (id, dialog_id, from_user_id, type, text, ts) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [messageId, `chat_${id}`, fromUserId, type, text, Date.now()]
    );
    res.json({ success: true });
});

app.get('/api/chats/:id/messages', async (req, res) => {
    const result = await pool.query(
        "SELECT * FROM messages WHERE dialog_id = $1 ORDER BY ts ASC",
        [`chat_${req.params.id}`]
    );
    res.json(result.rows);
});

app.put('/api/chats/:id', async (req, res) => {
    const { id } = req.params;
    const { isPublic, title, description } = req.body;
    if (isPublic !== undefined) await pool.query("UPDATE chats SET is_public = $1 WHERE id = $2", [isPublic ? 1 : 0, id]);
    if (title !== undefined) await pool.query("UPDATE chats SET title = $1 WHERE id = $2", [title, id]);
    if (description !== undefined) await pool.query("UPDATE chats SET description = $1 WHERE id = $2", [description, id]);
    res.json({ success: true });
});

app.delete('/api/chats/:id', async (req, res) => {
    await pool.query("DELETE FROM chats WHERE id = $1", [req.params.id]);
    res.json({ success: true });
});

// ============ ЖАЛОБЫ ============
app.get('/api/reports', async (req, res) => {
    const result = await pool.query("SELECT * FROM reports ORDER BY ts DESC");
    res.json(result.rows);
});

app.post('/api/reports', async (req, res) => {
    const { from, againstId, type, reason, comment } = req.body;
    await pool.query(
        `INSERT INTO reports (id, from_user_id, against_id, type, reason, comment, status, ts) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [uuidv4(), from, againstId, type, reason, comment || '', 'pending', Date.now()]
    );
    res.json({ success: true });
});

app.put('/api/reports/:id', async (req, res) => {
    const { id } = req.params;
    const { status, action, duration } = req.body;
    
    await pool.query("UPDATE reports SET status = $1 WHERE id = $2", [status, id]);
    
    const report = await pool.query("SELECT * FROM reports WHERE id = $1", [id]);
    const againstId = report.rows[0]?.against_id;
    
    if (action === 'delete') await pool.query("DELETE FROM chats WHERE id = $1", [againstId]);
    if (action === 'ban') await pool.query("UPDATE users SET banned = true WHERE id = $1", [againstId]);
    if (action === 'freeze') await pool.query("UPDATE users SET frozen = true WHERE id = $1", [againstId]);
    if (action === 'spam') {
        const until = duration ? Date.now() + (duration * 60 * 60 * 1000) : null;
        await pool.query(
            "UPDATE users SET spam_blocked = true, spam_reason = $1, spam_until = $2 WHERE id = $3",
            [`Жалоба: ${report.rows[0].reason}`, until, againstId]
        );
        await sendNotification(againstId, '🚫 Спам-блок', `Вы получили спам-блок! Причина: ${report.rows[0].reason}`);
    }
    
    res.json({ success: true });
});

// ============ АПЕЛЛЯЦИИ ============
app.get('/api/bot/appeals', async (req, res) => {
    const result = await pool.query("SELECT * FROM bot_appeals WHERE status = 'pending' ORDER BY ts DESC");
    res.json(result.rows);
});

app.post('/api/bot/appeals/:id', async (req, res) => {
    const { id } = req.params;
    const { status, adminComment } = req.body;
    
    await pool.query("UPDATE bot_appeals SET status = $1, admin_comment = $2 WHERE id = $3", [status, adminComment, id]);
    
    if (status === 'approved') {
        const appeal = await pool.query("SELECT user_id FROM bot_appeals WHERE id = $1", [id]);
        await pool.query("UPDATE users SET spam_blocked = false, spam_reason = NULL, spam_until = NULL WHERE id = $1", [appeal.rows[0].user_id]);
        await sendNotification(appeal.rows[0].user_id, '✅ Апелляция одобрена', `Ваш спам-блок снят!`);
    }
    
    res.json({ success: true });
});

app.post('/api/bot/spam-info', async (req, res) => {
    const { userId, command, text } = req.body;
    const user = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    
    let response = '';
    if (command === '/start') {
        if (user.rows[0]?.spam_blocked) {
            response = `🚫 **У вас активен спам-блок!**\n\n📋 **Причина:** ${user.rows[0].spam_reason || 'Не указана'}\n⏰ **До:** ${user.rows[0].spam_until ? new Date(user.rows[0].spam_until).toLocaleString() : 'Навсегда'}\n\n📝 Для подачи апелляции отправьте команду /appeal с указанием причины`;
        } else {
            response = `✅ **У вас нет активных ограничений**\n\nВы можете отправлять сообщения без ограничений.`;
        }
    } else if (command === '/appeal') {
        if (!user.rows[0]?.spam_blocked) {
            response = `❌ У вас нет активного спам-блока. Апелляция не требуется.`;
        } else {
            const reason = text || 'Причина не указана';
            await pool.query(
                `INSERT INTO bot_appeals (id, user_id, reason, status, ts) VALUES ($1, $2, $3, $4, $5)`,
                [uuidv4(), userId, reason, 'pending', Date.now()]
            );
            response = `✅ Ваша апелляция принята! Администратор рассмотрит её в ближайшее время.`;
            await sendNotification('admin', '📝 Новая апелляция', `Пользователь @${userId} подал апелляцию: ${reason}`);
        }
    } else {
        response = `🤖 **@SpamInfoBot**\n\nДоступные команды:\n/start - Проверить статус спам-блока\n/appeal [причина] - Подать апелляцию`;
    }
    
    res.json({ response });
});

// ============ СТАТИСТИКА ============
app.get('/api/stats', async (req, res) => {
    const users = await pool.query("SELECT COUNT(*) FROM users WHERE id != 'admin'");
    const messages = await pool.query("SELECT COUNT(*) FROM messages");
    const reports = await pool.query("SELECT COUNT(*) FROM reports");
    const pendingReports = await pool.query("SELECT COUNT(*) FROM reports WHERE status = 'pending'");
    const bannedUsers = await pool.query("SELECT COUNT(*) FROM users WHERE banned = true AND id != 'admin'");
    const frozenUsers = await pool.query("SELECT COUNT(*) FROM users WHERE frozen = true AND id != 'admin'");
    const spamBlockedUsers = await pool.query("SELECT COUNT(*) FROM users WHERE spam_blocked = true AND id != 'admin'");
    const chats = await pool.query("SELECT COUNT(*) FROM chats");
    
    res.json({
        users: parseInt(users.rows[0].count),
        messages: parseInt(messages.rows[0].count),
        reports: parseInt(reports.rows[0].count),
        pendingReports: parseInt(pendingReports.rows[0].count),
        bannedUsers: parseInt(bannedUsers.rows[0].count),
        frozenUsers: parseInt(frozenUsers.rows[0].count),
        spamBlockedUsers: parseInt(spamBlockedUsers.rows[0].count),
        chats: parseInt(chats.rows[0].count)
    });
});

// ============ ЗАПУСК ============
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
    console.log(`📦 База данных: Supabase PostgreSQL`);
});
