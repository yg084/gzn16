"""SQLite 数据访问层。

设计要点：
- 每个请求使用独立连接（ThreadingHTTPServer 是多线程的），SQLite 开启 WAL 提升并发。
- 表结构刻意与前端 localStorage 中的对象结构保持一致（如 posts.author 存用户名），
  这样前端接入时只需替换 Store 层，无需改动页面渲染逻辑。
"""

import sqlite3
from contextlib import contextmanager

from . import config

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 用户（密码只存哈希）
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  real_name     TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user',       -- 'user' | 'admin'
  avatar        TEXT NOT NULL DEFAULT '',           -- 头像图片地址
  created_at    TEXT NOT NULL
);

-- 登录会话（令牌 -> 用户）
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 博客
CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  image       TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL,                        -- 用户名
  author_role TEXT NOT NULL DEFAULT 'user',
  source      TEXT NOT NULL DEFAULT 'user',         -- 'user' | 'seed'
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author  ON posts(author COLLATE NOCASE);

-- 评论
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL,
  author     TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

-- 意见反馈
CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  type       TEXT,
  content    TEXT NOT NULL,
  contact    TEXT,
  author     TEXT,                                  -- 未登录时为空
  created_at TEXT NOT NULL
);

-- 管理员博客文字覆盖（替代原仓库中的 data/admin-posts.json）
CREATE TABLE IF NOT EXISTS admin_text (
  post_id TEXT PRIMARY KEY,
  title   TEXT,
  content TEXT
);
"""


def connect() -> sqlite3.Connection:
    """创建一个新的数据库连接，行以字典方式访问。"""
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(config.DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db():
    """请求级连接上下文：正常结束自动提交，异常自动回滚，最终关闭。"""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """建目录、建表（幂等，可重复执行）。"""
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()
