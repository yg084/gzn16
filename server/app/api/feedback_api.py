"""意见反馈接口：未登录也可提交，管理员可查看与删除。"""

from .. import config
from ..db import db
from ..http import HttpError
from ..serializers import feedback_obj
from ..util import now_iso, uid

VALID_TYPES = ("功能建议", "问题反馈", "内容纠错", "其他")


def register(router):
    router.post("/api/feedback", create_feedback, optional_auth=True)
    router.get("/api/feedback", list_feedback, admin=True)
    router.delete("/api/feedback/:id", delete_feedback, admin=True)


def create_feedback(req):
    data = req.json()
    content = str(data.get("content") or "").strip()
    ftype = str(data.get("type") or "").strip() or "其他"
    contact = str(data.get("contact") or "").strip()

    if not content:
        raise HttpError(400, "请填写反馈内容")
    if len(content) > config.LIMITS["feedback_max"]:
        raise HttpError(400, f'反馈内容最多 {config.LIMITS["feedback_max"]} 字')
    if len(contact) > config.LIMITS["feedback_contact_max"]:
        raise HttpError(400, f'联系方式最多 {config.LIMITS["feedback_contact_max"]} 字')
    if ftype not in VALID_TYPES:
        ftype = "其他"

    feedback_id = uid("f")
    author = req.user["username"] if req.user else None
    with db() as conn:
        conn.execute(
            "INSERT INTO feedback(id, type, content, contact, author, created_at) VALUES(?,?,?,?,?,?)",
            (feedback_id, ftype, content, contact, author, now_iso()),
        )
        row = conn.execute("SELECT * FROM feedback WHERE id = ?", (feedback_id,)).fetchone()
    return {"feedback": feedback_obj(row)}


def list_feedback(req):
    with db() as conn:
        rows = conn.execute("SELECT * FROM feedback ORDER BY created_at DESC").fetchall()
    return {"feedback": [feedback_obj(r) for r in rows], "total": len(rows)}


def delete_feedback(req):
    with db() as conn:
        row = conn.execute("SELECT id FROM feedback WHERE id = ?", (req.params["id"],)).fetchone()
        if row is None:
            raise HttpError(404, "反馈不存在")
        conn.execute("DELETE FROM feedback WHERE id = ?", (req.params["id"],))
    return {"ok": True}
