"""用户接口：个人主页、改资料、上传头像，以及管理员操作用户。"""

from .. import config
from ..auth import destroy_user_sessions
from ..db import db
from ..http import HttpError
from ..security import hash_password
from ..serializers import public_profile, public_user
from ..storage import abs_url, save_upload
from ..util import USERNAME_RE, norm_username


def register(router):
    # 注意顺序：/api/users/me 必须写在 /api/users/:username 之前
    router.get("/api/users/me", do_me, auth=True)
    router.patch("/api/users/me", update_me, auth=True)
    router.post("/api/users/me/avatar", upload_avatar, auth=True)
    router.delete("/api/users/me/avatar", delete_avatar, auth=True)

    router.get("/api/users", list_users, admin=True)
    router.get("/api/users/:username", get_profile)
    router.patch("/api/users/:id", admin_update_user, admin=True)
    router.delete("/api/users/:id", admin_delete_user, admin=True)


# ------------------------------------------------------------------ 本人
def do_me(req):
    return {"user": public_user(req.user)}


def update_me(req):
    """修改自己的真实姓名 / 密码。"""
    data = req.json()
    limits = config.LIMITS
    updates = {}

    if "realName" in data:
        real_name = str(data.get("realName") or "").strip()
        if not (limits["real_name_min"] <= len(real_name) <= limits["real_name_max"]):
            raise HttpError(400, f'真实姓名长度需为 {limits["real_name_min"]}-{limits["real_name_max"]} 个字')
        updates["real_name"] = real_name

    if data.get("password"):
        password = str(data["password"])
        password2 = str(data.get("password2") or password)
        if len(password) < limits["password_min"]:
            raise HttpError(400, f'密码至少 {limits["password_min"]} 位')
        if password != password2:
            raise HttpError(400, "两次输入的密码不一致")
        updates["password_hash"] = hash_password(password)

    if not updates:
        raise HttpError(400, "没有需要修改的内容")

    with db() as conn:
        sets = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE users SET {sets} WHERE id = ?", (*updates.values(), req.user["id"]))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (req.user["id"],)).fetchone()

    if "password_hash" in updates:
        destroy_user_sessions(req.user["id"])   # 改密码后让旧令牌全部失效
        return {"user": public_user(row), "message": "密码已修改，请重新登录"}
    return {"user": public_user(row)}


def upload_avatar(req):
    """上传 / 更换头像（multipart/form-data，字段名 file 或 avatar）。"""
    _, files = req.input()
    file_info = files.get("file") or files.get("avatar")
    if not file_info:
        raise HttpError(400, "请选择要上传的头像图片")

    path = save_upload(file_info, config.LIMITS["avatar_max_bytes"], "avatar")
    with db() as conn:
        conn.execute("UPDATE users SET avatar = ? WHERE id = ?", (path, req.user["id"]))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (req.user["id"],)).fetchone()

    return {"avatar": abs_url(req, path), "user": public_user(row)}


def delete_avatar(req):
    with db() as conn:
        conn.execute("UPDATE users SET avatar = '' WHERE id = ?", (req.user["id"],))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (req.user["id"],)).fetchone()
    return {"avatar": "", "user": public_user(row)}


# ------------------------------------------------------------------ 公开
def get_profile(req):
    """公开的用户主页信息（含真实姓名，与原前端 profile.html 行为一致）。"""
    username = norm_username(req.params.get("username"))
    with db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)
        ).fetchone()
        if row is None:
            raise HttpError(404, "用户不存在")
        post_count = conn.execute(
            "SELECT COUNT(*) AS c FROM posts WHERE author = ? COLLATE NOCASE", (row["username"],)
        ).fetchone()["c"]
        comment_count = conn.execute(
            "SELECT COUNT(*) AS c FROM comments WHERE author = ? COLLATE NOCASE", (row["username"],)
        ).fetchone()["c"]
    return {"profile": public_profile(row, post_count, comment_count)}


# ------------------------------------------------------------------ 管理员
def list_users(req):
    """用户列表：附带博客数、评论数（不返回任何密码字段）。"""
    with db() as conn:
        rows = conn.execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
        result = []
        for row in rows:
            post_count = conn.execute(
                "SELECT COUNT(*) AS c FROM posts WHERE author = ? COLLATE NOCASE", (row["username"],)
            ).fetchone()["c"]
            comment_count = conn.execute(
                "SELECT COUNT(*) AS c FROM comments WHERE author = ? COLLATE NOCASE", (row["username"],)
            ).fetchone()["c"]
            result.append(public_profile(row, post_count, comment_count))
    return {"users": result, "total": len(result)}


def admin_update_user(req):
    """管理员改用户名 / 真实姓名 / 密码 / 角色；改用户名会级联更新其内容作者名。"""
    user_id = req.params["id"]
    data = req.json()
    limits = config.LIMITS

    with db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if target is None:
            raise HttpError(404, "用户不存在")

        is_admin_account = target["username"].lower() == config.ADMIN_USERNAME
        updates = {}

        if "username" in data:
            new_name = norm_username(data.get("username"))
            if not (limits["username_min"] <= len(new_name) <= limits["username_max"]):
                raise HttpError(400, f'用户名长度需为 {limits["username_min"]}-{limits["username_max"]} 位')
            if not USERNAME_RE.match(new_name):
                raise HttpError(400, "用户名只能包含字母、数字、下划线或中文")
            if is_admin_account and new_name != target["username"]:
                raise HttpError(403, "管理员账号的用户名受保护，不可修改")
            dup = conn.execute(
                "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id <> ?",
                (new_name, user_id),
            ).fetchone()
            if dup:
                raise HttpError(409, "该用户名已被占用")
            if new_name != target["username"]:
                updates["username"] = new_name

        if "realName" in data:
            real_name = str(data.get("realName") or "").strip()
            if not (limits["real_name_min"] <= len(real_name) <= limits["real_name_max"]):
                raise HttpError(400, f'真实姓名长度需为 {limits["real_name_min"]}-{limits["real_name_max"]} 个字')
            updates["real_name"] = real_name

        if data.get("password"):
            password = str(data["password"])
            if len(password) < limits["password_min"]:
                raise HttpError(400, f'密码至少 {limits["password_min"]} 位')
            updates["password_hash"] = hash_password(password)

        if "role" in data:
            role = "admin" if data["role"] == "admin" else "user"
            if is_admin_account and role != "admin":
                raise HttpError(403, "管理员账号的角色受保护，不可降级")
            updates["role"] = role

        if not updates:
            raise HttpError(400, "没有需要修改的内容")

        sets = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE users SET {sets} WHERE id = ?", (*updates.values(), user_id))

        # 改用户名：级联更新其博客 / 评论 / 反馈中的作者名
        if "username" in updates:
            new_name, old_name = updates["username"], target["username"]
            conn.execute("UPDATE posts SET author = ? WHERE author = ?", (new_name, old_name))
            conn.execute("UPDATE comments SET author = ? WHERE author = ?", (new_name, old_name))
            conn.execute("UPDATE feedback SET author = ? WHERE author = ?", (new_name, old_name))

        if "password_hash" in updates:
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"user": public_user(row)}


def admin_delete_user(req):
    """删除用户并级联清理其博客（含博客下所有评论）、评论、反馈与会话。"""
    user_id = req.params["id"]
    with db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if target is None:
            raise HttpError(404, "用户不存在")
        if target["username"].lower() == config.ADMIN_USERNAME:
            raise HttpError(403, "管理员账号不可删除")
        if target["id"] == req.user["id"]:
            raise HttpError(403, "不能删除当前登录的自己")

        username = target["username"]
        conn.execute(
            "DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author = ? COLLATE NOCASE)",
            (username,),
        )
        conn.execute("DELETE FROM posts WHERE author = ? COLLATE NOCASE", (username,))
        conn.execute("DELETE FROM comments WHERE author = ? COLLATE NOCASE", (username,))
        conn.execute("DELETE FROM feedback WHERE author = ? COLLATE NOCASE", (username,))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"ok": True, "deleted": username}
