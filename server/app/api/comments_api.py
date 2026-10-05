"""评论接口：某篇博客的评论列表 / 发表 / 修改 / 删除。"""

from .. import config
from ..db import db
from ..http import HttpError
from ..serializers import comment_obj
from ..util import now_iso, uid


def register(router):
    router.get("/api/posts/:id/comments", list_comments)
    router.post("/api/posts/:id/comments", create_comment, auth=True)
    router.get("/api/comments", list_all_comments, admin=True)
    router.patch("/api/comments/:id", update_comment, auth=True)
    router.delete("/api/comments/:id", delete_comment, auth=True)


def list_comments(req):
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC",
            (req.params["id"],),
        ).fetchall()
    return {"comments": [comment_obj(r) for r in rows]}


def create_comment(req):
    post_id = req.params["id"]
    content = str(req.json().get("content") or "").strip()
    if not content:
        raise HttpError(400, "评论内容不能为空")
    if len(content) > config.LIMITS["comment_max"]:
        raise HttpError(400, f'评论最多 {config.LIMITS["comment_max"]} 字')

    comment_id = uid("c")
    with db() as conn:
        post = conn.execute("SELECT id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if post is None:
            raise HttpError(404, "博客不存在，无法评论")
        conn.execute(
            "INSERT INTO comments(id, post_id, author, content, created_at) VALUES(?,?,?,?,?)",
            (comment_id, post_id, req.user["username"], content, now_iso()),
        )
        row = conn.execute("SELECT * FROM comments WHERE id = ?", (comment_id,)).fetchone()
    return {"comment": comment_obj(row)}


def list_all_comments(req):
    """管理后台：全部评论（附带所属博客标题，便于展示）。"""
    with db() as conn:
        rows = conn.execute(
            "SELECT c.*, p.title AS post_title FROM comments c "
            "LEFT JOIN posts p ON p.id = c.post_id ORDER BY c.created_at DESC"
        ).fetchall()
    result = []
    for row in rows:
        item = comment_obj(row)
        item["postTitle"] = row["post_title"]
        result.append(item)
    return {"comments": result, "total": len(result)}


def _load_and_check(req):
    with db() as conn:
        row = conn.execute("SELECT * FROM comments WHERE id = ?", (req.params["id"],)).fetchone()
    if row is None:
        raise HttpError(404, "评论不存在")
    is_owner = row["author"].lower() == req.user["username"].lower()
    if not is_owner and req.user["role"] != "admin":
        raise HttpError(403, "只有评论作者本人或管理员可以操作")
    return row


def update_comment(req):
    row = _load_and_check(req)
    content = str(req.json().get("content") or "").strip()
    if not content:
        raise HttpError(400, "评论内容不能为空")
    if len(content) > config.LIMITS["comment_max"]:
        raise HttpError(400, f'评论最多 {config.LIMITS["comment_max"]} 字')

    with db() as conn:
        conn.execute("UPDATE comments SET content = ? WHERE id = ?", (content, row["id"]))
        new_row = conn.execute("SELECT * FROM comments WHERE id = ?", (row["id"],)).fetchone()
    return {"comment": comment_obj(new_row)}


def delete_comment(req):
    row = _load_and_check(req)
    with db() as conn:
        conn.execute("DELETE FROM comments WHERE id = ?", (row["id"],))
    return {"ok": True, "deleted": row["id"]}
