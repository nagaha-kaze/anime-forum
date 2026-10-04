// ========================================
// 数据库封装层 - sql.js (SQLite3 纯 JS 版)
// ========================================
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'anime.db');

let SQL = null;
let db = null;

// 初始化数据库（单例，服务启动时调用一次）
async function initDB() {
  SQL = await initSqlJs();

  // 如果数据库文件存在则加载，否则创建新的
  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    db = new SQL.Database(data);
    console.log('[DB] 已加载现有数据库:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[DB] 已创建新数据库:', DB_PATH);
  }

  // 自动建表（IF NOT EXISTS）
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      board TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  console.log('[DB] 表结构就绪');
}

// 持久化到磁盘
function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// 工具：把 stmt.getAsObject() 结果转为数组
function stmtToObjects(stmt) {
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// ========================================
// 对外 API（封装成同步风格，内部使用 Promise）
// ========================================

function prepare(sql) {
  const stmt = db.prepare(sql);
  return {
    // 查询单条记录
    get(...params) {
      if (params.length) stmt.bind(params);
      let row = null;
      if (stmt.step()) row = stmt.getAsObject();
      stmt.free();
      return row;
    },
    // 查询多条记录
    all(...params) {
      if (params.length) stmt.bind(params);
      const rows = stmtToObjects(stmt);
      return rows;
    },
    // 执行写入操作，返回 { lastInsertRowid, changes }
    run(...params) {
      db.run(sql, params);
      // 必须在 saveDB 之前查！否则 export() 会重置 last_insert_rowid
      const rowidStmt = db.prepare('SELECT last_insert_rowid() AS id');
      let lastId = null;
      if (rowidStmt.step()) lastId = rowidStmt.getAsObject().id;
      rowidStmt.free();
      const changesStmt = db.prepare('SELECT changes() AS c');
      let changes = 0;
      if (changesStmt.step()) changes = changesStmt.getAsObject().c;
      changesStmt.free();
      saveDB();
      return { lastInsertRowid: lastId, changes };
    }
  };
}

// 执行原生 SQL（用于建表等 DDL）
function exec(sql) {
  db.run(sql);
}

// 导出
module.exports = { initDB, prepare, exec, saveDB };