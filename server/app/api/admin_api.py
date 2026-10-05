"""管理后台与数据管理接口（仅管理员）。

提供统计、导出 / 导入 / 清空全部数据，以及管理员博客文字覆盖的读写。
"""

from .. import config, seed
from ..db import db
from ..http import HttpError
from ..serializers import comment_obj, feedback_obj, post_obj, public_user
from ..util import now_iso


def register(router):
    router.get("/api/health", health)
    router.get("/api/admin/stats", stats, admin=True)
    router.get("/api/admin/export", export_data, admin=True)
    router.post("/api/admin/import", import_data, admin=True)
    router.post("/api/admin/clear", clear_all, admin=True)

    # 管理员博客文字覆盖：所有人可读，仅管理员可写
    router.get("/api/admin-text", get_admin_text)
    router.put("/api/admin-text", put_admin_text, admin=True)


def health(req):
    """健康检查，部署后可用来确认服务是否正常。"""
    return {"service": "gzn16-backend", "status": "ok", "time": now_iso()}


def stats(req):
    with db() as conn:
        users = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        posts = conn.execute("SELECT COUNT(*) AS c FROM posts").fetchone()["c"]
        seed_posts = conn.execute(
            "SELECT COUNT(*) AS c FROM posts WHERE source = 'seed'"
        ).fetchone()["c"]
        comments = conn.execute("SELECT COUNT(*) AS c FROM comments").fetchone()["c"]
        feedback = conn.execute("SELECT COUNT(*) AS c FROM feedback").fetchone()["c"]

    db_size = config.DB_PATH.stat().st_size if config.DB_PATH.exists() else 0
    upload_size = sum(f.stat().st_size for f in config.UPLOAD_DIR.glob("*") if f.is_file())

    return {
        "stats": {
            "users": users,
            "posts": posts,
            "seedPosts": seed_posts,
            "userPosts": posts - seed_posts,
            "comments": comments,
            "feedback": feedback,
            "dbSizeKB": round(db_size / 1024, 1),
            "uploadSizeKB": round(upload_size / 1024, 1),
        }
    }


# ------------------------------------------------------------ 导出 / 导入 / 清空
def export_data(req):
    """导出全部数据为 JSON（注意：包含密码哈希，请妥善保管）。"""
    with db() as conn:
        users = [
            {
                "id": r["id"], "username": r["username"], "realName": r["real_name"],
                "role": r["role"], "avatar": r["avatar"], "createdAt": r["created_at"],
                "passwordHash": r["password_hash"],   # 备份用，导入时可原样恢复
            }
            for r in conn.execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
        ]
        posts = [post_obj(r) for r in conn.execute("SELECT * FROM posts ORDER BY created_at ASC").fetchall()]
        comments = [
            comment_obj(r) for r in conn.execute("SELECT * FROM comments ORDER BY created_at ASC").fetchall()
        ]
        feedback = [
            feedback_obj(r) for r in conn.execute("SELECT * FROM feedback ORDER BY created_at ASC").fetchall()
        ]
        admin_text = {
            r["post_id"]: {"title": r["title"], "content": r["content"]}
            for r in conn.execute("SELECT * FROM admin_text").fetchall()
        }
    return {
        "exportedAt": now_iso(),
        "users": users,
        "posts": posts,
        "comments": comments,
        "feedback": feedback,
        "adminText": admin_text,
    }


def import_data(req):
    """用一份导出 JSON 覆盖当前全部数据（会清空现有数据）。"""
    data = req.json()
    if not isinstance(data, dict):
        raise HttpError(400, "导入内容必须是 JSON 对象")

    users = data.get("users") or []
    posts = data.get("posts") or []
    comments = data.get("comments") or []
    feedback = data.get("feedback") or []
    admin_text = data.get("adminText") or {}

    if not isinstance(users, list) or not isinstance(posts, list):
        raise HttpError(400, "users / posts 必须是数组")

    from ..security import hash_password

    with db() as conn:
        conn.execute("DELETE FROM sessions")
        conn.execute("DELETE FROM comments")
        conn.execute("DELETE FROM posts")
        conn.execute("DELETE FROM feedback")
        conn.execute("DELETE FROM admin_text")
        conn.execute("DELETE FROM users")

        for u in users:
            username = str(u.get("username") or "").strip()
            if not username:
                continue
            conn.execute(
                "INSERT INTO users(id, username, password_hash, real_name, role, avatar, created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (
                    u.get("id") or f"u-{username}",
                    username,
                    u.get("passwordHash") or hash_password("123456"),
                    str(u.get("realName") or ""),
                    "admin" if u.get("role") == "admin" else "user",
                    str(u.get("avatar") or ""),
                    u.get("createdAt") or now_iso(),
                ),
            )
        for p in posts:
            conn.execute(
                "INSERT INTO posts(id, title, content, image, author, author_role, source, created_at) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (
                    p.get("id"), str(p.get("title") or ""), str(p.get("content") or ""),
                    str(p.get("image") or ""), str(p.get("author") or ""),
                    str(p.get("authorRole") or "user"), str(p.get("source") or "user"),
                    p.get("createdAt") or now_iso(),
                ),
            )
        for c in comments:
            conn.execute(
                "INSERT INTO comments(id, post_id, author, content, created_at) VALUES(?,?,?,?,?)",
                (c.get("id"), c.get("postId"), str(c.get("author") or ""),
                 str(c.get("content") or ""), c.get("createdAt") or now_iso()),
            )
        for f in feedback:
            conn.execute(
                "INSERT INTO feedback(id, type, content, contact, author, created_at) VALUES(?,?,?,?,?,?)",
                (f.get("id"), f.get("type"), str(f.get("content") or ""), f.get("contact"),
                 f.get("author"), f.get("createdAt") or now_iso()),
            )
        for post_id, value in (admin_text or {}).items():
            conn.execute(
                "INSERT INTO admin_text(post_id, title, content) VALUES(?,?,?)",
                (post_id, (value or {}).get("title"), (value or {}).get("content")),
            )

    return {
        "ok": True,
        "imported": {
            "users": len(users), "posts": len(posts),
            "comments": len(comments), "feedback": len(feedback),
        },
    }


def clear_all(req):
    """清空全部数据，并重建管理员 yg 与 45 篇图片随笔。"""
    with db() as conn:
        conn.execute("DELETE FROM sessions")
        conn.execute("DELETE FROM comments")
        conn.execute("DELETE FROM posts")
        conn.execute("DELETE FROM feedback")
        conn.execute("DELETE FROM admin_text")
        conn.execute("DELETE FROM users")
    seed.run()
    return {"ok": True, "message": "已清空全部数据并重建初始内容"}


# ------------------------------------------------------------ 管理员博客文字
def get_admin_text(req):
    with db() as conn:
        rows = conn.execute("SELECT * FROM admin_text").fetchall()
    return {"adminText": {r["post_id"]: {"title": r["title"], "content": r["content"]} for r in rows}}


def put_admin_text(req):
    """整体覆盖文字映射，或只更新单篇：{postId, title, content}"""
    data = req.json()
    with db() as conn:
        if "postId" in data:
            post_id = str(data["postId"])
            conn.execute(
                "INSERT INTO admin_text(post_id, title, content) VALUES(?,?,?) "
                "ON CONFLICT(post_id) DO UPDATE SET title = excluded.title, content = excluded.content",
                (post_id, data.get("title"), data.get("content")),
            )
        else:
            mapping = data.get("adminText") or {}
            if not isinstance(mapping, dict):
                raise HttpError(400, "adminText 必须是对象")
            conn.execute("DELETE FROM admin_text")
            for post_id, value in mapping.items():
                conn.execute(
                    "INSERT INTO admin_text(post_id, title, content) VALUES(?,?,?)",
                    (str(post_id), (value or {}).get("title"), (value or {}).get("content")),
                )
        rows = conn.execute("SELECT * FROM admin_text").fetchall()
    return {"adminText": {r["post_id"]: {"title": r["title"], "content": r["content"]} for r in rows}}
