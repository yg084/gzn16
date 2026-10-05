"""认证：登录令牌的创建 / 销毁 / 解析。

采用「不透明令牌 + sessions 表」的方案，不引入 JWT 库，保持零依赖。
前端只需在请求头带上 `Authorization: Bearer <token>` 即可。
"""

from datetime import datetime, timedelta, timezone

from . import config
from .db import db
from .security import new_token


def create_session(user_id: str) -> str:
    """为用户创建登录会话，返回令牌。"""
    token = new_token()
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=config.SESSION_TTL_DAYS)
    with db() as conn:
        conn.execute(
            "INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?,?,?,?)",
            (token, user_id, now.isoformat(), expires.isoformat()),
        )
    return token


def destroy_session(token: str) -> None:
    """退出登录：删除该令牌对应的会话。"""
    if not token:
        return
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


def destroy_user_sessions(user_id: str) -> None:
    """删除某用户的全部会话（改密码 / 改用户名 / 删除用户时使用）。"""
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def bearer_token(req) -> str:
    """从 Authorization 请求头中取出 Bearer 令牌。"""
    raw = req.headers.get("Authorization") or ""
    if raw.lower().startswith("bearer "):
        return raw[7:].strip()
    return ""


def resolve_user(req):
    """根据请求头中的令牌解析当前用户；未登录 / 令牌失效返回 None。"""
    token = bearer_token(req)
    if not token:
        return None
    now = datetime.now(timezone.utc).isoformat()
    with db() as conn:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token = ? AND s.expires_at > ?",
            (token, now),
        ).fetchone()
    return dict(row) if row else None
