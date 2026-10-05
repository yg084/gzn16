"""认证接口：注册 / 登录 / 退出 / 当前用户。"""

from .. import config
from ..auth import bearer_token, create_session, destroy_session
from ..db import db
from ..http import HttpError
from ..security import hash_password, verify_password
from ..serializers import public_user
from ..util import USERNAME_RE, norm_username, now_iso, uid


def register(router):
    router.post("/api/auth/register", do_register)
    router.post("/api/auth/login", do_login)
    router.post("/api/auth/logout", do_logout, auth=True)
    router.get("/api/auth/me", do_me, auth=True)


def _validate_register(data) -> tuple:
    """校验注册参数，返回 (username, password, real_name)。"""
    limits = config.LIMITS
    username = norm_username(data.get("username"))
    password = str(data.get("password") or "")
    password2 = str(data.get("password2") or password)
    real_name = str(data.get("realName") or "").strip()

    if not username or not password:
        raise HttpError(400, "用户名和密码不能为空")
    if not real_name:
        raise HttpError(400, "请填写真实姓名")
    if not (limits["real_name_min"] <= len(real_name) <= limits["real_name_max"]):
        raise HttpError(400, f'真实姓名长度需为 {limits["real_name_min"]}-{limits["real_name_max"]} 个字')
    if not (limits["username_min"] <= len(username) <= limits["username_max"]):
        raise HttpError(400, f'用户名长度需为 {limits["username_min"]}-{limits["username_max"]} 位')
    if not USERNAME_RE.match(username):
        raise HttpError(400, "用户名只能包含字母、数字、下划线或中文")
    if username.lower() == config.ADMIN_USERNAME:
        raise HttpError(400, f'“{config.ADMIN_USERNAME}”是管理员保留用户名，不可注册')
    if len(password) < limits["password_min"]:
        raise HttpError(400, f'密码至少 {limits["password_min"]} 位')
    if password != password2:
        raise HttpError(400, "两次输入的密码不一致")
    return username, password, real_name


def do_register(req):
    username, password, real_name = _validate_register(req.json())

    user_id = uid("u")
    with db() as conn:
        exists = conn.execute(
            "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", (username,)
        ).fetchone()
        if exists:
            raise HttpError(409, "该用户名已被注册，请换一个")
        conn.execute(
            "INSERT INTO users(id, username, password_hash, real_name, role, avatar, created_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (user_id, username, hash_password(password), real_name, "user", "", now_iso()),
        )
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    token = create_session(user_id)
    return {"token": token, "user": public_user(row)}


def do_login(req):
    data = req.json()
    username = norm_username(data.get("username"))
    password = str(data.get("password") or "")
    if not username or not password:
        raise HttpError(400, "请输入用户名和密码")

    with db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)
        ).fetchone()

    if row is None:
        raise HttpError(404, "用户不存在，请先注册")
    if not verify_password(password, row["password_hash"]):
        raise HttpError(401, "密码错误，请重新输入")

    token = create_session(row["id"])
    return {"token": token, "user": public_user(row)}


def do_logout(req):
    token = bearer_token(req)
    if token:
        destroy_session(token)
    return {"ok": True}


def do_me(req):
    return {"user": public_user(req.user)}
