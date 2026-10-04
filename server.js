// ========================================
// 极简二次元讨论社区 - 后端入口
// ========================================
require('dotenv').config();

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const INVITE_CODES = (process.env.INVITE_CODES || '').split(',').map(s => s.trim()).filter(Boolean);

// 合法板块列表
const VALID_BOARDS = ['番剧区', '美图区', '闲聊区'];

// ========================================
// 中间件
// ========================================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const resJson = (res, code, msg, data = {}) => res.json({ code, msg, data });

// JWT 鉴权中间件
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 1, msg: '未登录或令牌无效', data: {} });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ code: 1, msg: '令牌已失效，请重新登录', data: {} });
  }
}

// ========================================
// 接口 1：注册
// ========================================
app.post('/api/register', (req, res) => {
  const { username, password, inviteCode } = req.body || {};

  if (!username || !password || !inviteCode) {
    return resJson(res, 1, '所有字段不能为空');
  }
  if (username.length < 2 || username.length > 20) {
    return resJson(res, 1, '用户名长度需在 2-20 之间');
  }
  if (password.length < 6) {
    return resJson(res, 1, '密码至少 6 位');
  }

  if (!INVITE_CODES.includes(inviteCode.trim())) {
    return resJson(res, 1, '邀请码无效');
  }

  const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exist) {
    return resJson(res, 1, '该用户名已被使用');
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);

  return resJson(res, 0, '注册成功');
});

// ========================================
// 接口 2：登录
// ========================================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return resJson(res, 1, '用户名和密码不能为空');
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return resJson(res, 1, '用户名或密码错误');
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return resJson(res, 1, '用户名或密码错误');
  }

  const token = jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  return resJson(res, 0, '登录成功', { token, username: user.username });
});

// ========================================
// 接口 3：获取帖子列表
// ========================================
app.get('/api/posts', (req, res) => {
  const { board, keyword } = req.query;

  const conditions = [];
  const params = [];
  if (board && VALID_BOARDS.includes(board)) {
    conditions.push('p.board = ?');
    params.push(board);
  }
  if (keyword && keyword.trim()) {
    conditions.push('p.title LIKE ?');
    params.push('%' + keyword.trim() + '%');
  }

  const whereSql = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const sql = `
    SELECT p.id, p.title, p.board, p.created_at, u.username
    FROM posts p
    JOIN users u ON p.user_id = u.id
    ${whereSql}
    ORDER BY p.created_at DESC
    LIMIT 20
  `;

  const rows = db.prepare(sql).all(...params);
  return resJson(res, 0, 'ok', rows);
});

// ========================================
// 接口 4：获取帖子详情 + 评论
// ========================================
app.get('/api/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return resJson(res, 1, '帖子不存在');

  const post = db.prepare(`
    SELECT p.id, p.title, p.content, p.board, p.created_at, u.username
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = ?
  `).get(id);

  if (!post) return resJson(res, 1, '帖子不存在');

  const comments = db.prepare(`
    SELECT c.id, c.content, c.created_at, u.username
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ?
    ORDER BY c.created_at DESC
  `).all(id);

  return resJson(res, 0, 'ok', { post, comments });
});

// ========================================
// 接口 5：发布帖子（需登录）
// ========================================
app.post('/api/posts', authMiddleware, (req, res) => {
  const { title, content, board } = req.body || {};
  if (!title || !content || !board) {
    return resJson(res, 1, '标题、内容、板块均不能为空');
  }
  if (!VALID_BOARDS.includes(board)) {
    return resJson(res, 1, '板块无效');
  }

  const result = db.prepare(
    'INSERT INTO posts (title, content, board, user_id) VALUES (?, ?, ?, ?)'
  ).run(title, content, board, req.user.id);

  return resJson(res, 0, '发布成功', { id: result.lastInsertRowid });
});

// ========================================
// 接口 6：发布评论（需登录）
// ========================================
app.post('/api/posts/:id/comments', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const { content } = req.body || {};

  if (!id) return resJson(res, 1, '帖子不存在');
  if (!content || !content.trim()) return resJson(res, 1, '评论内容不能为空');

  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(id);
  if (!post) return resJson(res, 1, '帖子不存在');

  const result = db.prepare(
    'INSERT INTO comments (content, post_id, user_id) VALUES (?, ?, ?)'
  ).run(content, id, req.user.id);

  return resJson(res, 0, '评论成功', { id: result.lastInsertRowid });
});

// ========================================
// 启动服务（先初始化数据库）
// ========================================
async function start() {
  await db.initDB();

  app.listen(PORT, () => {
    console.log('========================================');
    console.log('  极简二次元讨论社区 已启动');
    console.log('  访问地址: http://localhost:' + PORT);
    console.log('========================================');
    console.log('  已配置邀请码: ' + (INVITE_CODES.join(', ') || '(无)'));
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});