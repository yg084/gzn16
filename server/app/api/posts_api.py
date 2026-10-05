"""博客接口：列表 / 详情 / 发布 / 修改 / 删除。"""

from .. import config
from ..db import db
from ..http import HttpError
from ..serializers import post_obj
from ..storage import abs_url, save_upload
from ..util import now_iso, uid


def register(router):
    router.get("/api/posts", list_posts, optional_auth=True)
    router.get("/api/posts/:id", get_post)
    router.post("/api/posts", create_post, auth=True)
    router.patch("/api/posts/:id", update_post, auth=True)
    router.delete("/api/posts/:id", delete_post, auth=True)


def _to_obj(req, row):
    """把数据库行转成前端对象，并把图片相对路径补成完整地址。"""
    post = post_obj(row)
    post["image"] = abs_url(req, post["image"])
    return post


def list_posts(req):
    """查询参数：keyword / author / zone(admin|user) / limit / offset。"""
    keyword = str(req.query.get("keyword") or "").strip().lower()
    author = str(req.query.get("author") or "").strip()
    zone = str(req.query.get("zone") or "").strip()
    try:
        limit = int(req.query.get("limit") or 0)
        offset = int(req.query.get("offset") or 0)
    except ValueError:
        raise HttpError(400, "limit / offset 必须为整数")

    # author=me 表示「我的博客」
    if author.lower() == "me":
        if not req.user:
            raise HttpError(401, "请先登录后查看「我的博客」")
        author = req.user["username"]

    sql = "SELECT * FROM posts WHERE 1 = 1"
    args = []
    if author:
        sql += " AND author = ? COLLATE NOCASE"
        args.append(author)
    if zone == "admin":
        sql += " AND author_role = 'admin'"
    elif zone == "user":
        sql += " AND author_role = 'user'"
    if keyword:
        sql += " AND (lower(title) LIKE ? OR lower(content) LIKE ? OR lower(author) LIKE ?)"
        like = f"%{keyword}%"
        args.extend([like, like, like])

    sql += " ORDER BY created_at DESC"
    if limit > 0:
        sql += " LIMIT ? OFFSET ?"
        args.extend([limit, offset])

    with db() as conn:
        rows = conn.execute(sql, args).fetchall()
    return {"posts": [_to_obj(req, row) for row in rows], "total": len(rows)}


def get_post(req):
    with db() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (req.params["id"],)).fetchone()
    if row is None:
        raise HttpError(404, "没有找到这篇博客")
    return {"post": _to_obj(req, row)}


def create_post(req):
    """发布博客。支持两种请求：
    - multipart/form-data：字段 title、content，文件字段 image
    - application/json：{title, content, image?}
    """
    fields, files = req.input()
    title = str(fields.get("title") or "").strip()
    content = str(fields.get("content") or "").strip()
    image_path = ""

    if files:
        file_info = files.get("image") or files.get("file")
        if file_info:
            image_path = save_upload(file_info, config.LIMITS["image_max_bytes"], "post")
    else:
        image_path = str(fields.get("image") or "")

    limits = config.LIMITS
    if not title:
        raise HttpError(400, "请填写博客标题")
    if len(title) > limits["title_max"]:
        raise HttpError(400, f'标题最多 {limits["title_max"]} 字')
    if not content:
        raise HttpError(400, "请填写文字描述")
    if len(content) > limits["content_max"]:
        raise HttpError(400, f'文字描述最多 {limits["content_max"]} 字')

    post_id = uid("p")
    with db() as conn:
        conn.execute(
            "INSERT INTO posts(id, title, content, image, author, author_role, source, created_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (
                post_id, title, content, image_path,
                req.user["username"], req.user["role"], "user", now_iso(),
            ),
        )
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (post_id,)).fetchone()
    return {"post": _to_obj(req, row)}


def _load_and_check(req):
    """读取目标博客并校验「作者本人或管理员」权限。"""
    with db() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id = ?", (req.params["id"],)).fetchone()
    if row is None:
        raise HttpError(404, "博客不存在，可能已被删除")
    is_owner = row["author"].lower() == req.user["username"].lower()
    if not is_owner and req.user["role"] != "admin":
        raise HttpError(403, "只有作者本人或管理员可以操作这篇博客")
    return row


def update_post(req):
    row = _load_and_check(req)
    data = req.json()
    limits = config.LIMITS
    updates = {}

    if "title" in data:
        title = str(data.get("title") or "").strip()
        if not title:
            raise HttpError(400, "标题不能为空")
        if len(title) > limits["title_max"]:
            raise HttpError(400, f'标题最多 {limits["title_max"]} 字')
        updates["title"] = title
    if "content" in data:
        content = str(data.get("content") or "").strip()
        if not content:
            raise HttpError(400, "正文不能为空")
        if len(content) > limits["content_max"]:
            raise HttpError(400, f'文字描述最多 {limits["content_max"]} 字')
        updates["content"] = content

    if not updates:
        raise HttpError(400, "没有需要修改的内容")

    with db() as conn:
        sets = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(f"UPDATE posts SET {sets} WHERE id = ?", (*updates.values(), row["id"]))
        new_row = conn.execute("SELECT * FROM posts WHERE id = ?", (row["id"],)).fetchone()
    return {"post": _to_obj(req, new_row)}


def delete_post(req):
    row = _load_and_check(req)
    with db() as conn:
        conn.execute("DELETE FROM comments WHERE post_id = ?", (row["id"],))
        conn.execute("DELETE FROM admin_text WHERE post_id = ?", (row["id"],))
        conn.execute("DELETE FROM posts WHERE id = ?", (row["id"],))
    return {"ok": True, "deleted": row["id"]}
