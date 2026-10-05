"""把数据库行转换成前端直接可用的 JSON 结构。

字段名刻意与前端 js/main.js 中使用的对象字段一致
（如 realName / createdAt / postId / authorRole），便于前端 Store 层平滑替换。
"""


def public_user(row) -> dict:
    """对外暴露的用户信息（不含任何密码字段）。"""
    u = dict(row)
    return {
        "id": u["id"],
        "username": u["username"],
        "realName": u.get("real_name", ""),
        "role": u.get("role", "user"),
        "avatar": u.get("avatar") or "",
        "createdAt": u.get("created_at"),
    }


def public_profile(row, post_count: int, comment_count: int) -> dict:
    """用户主页信息：附带博客数、评论数。"""
    data = public_user(row)
    data["postCount"] = post_count
    data["commentCount"] = comment_count
    return data


def post_obj(row) -> dict:
    p = dict(row)
    return {
        "id": p["id"],
        "title": p["title"],
        "content": p["content"],
        "image": p["image"] or "",
        "author": p["author"],
        "authorRole": p["author_role"],
        "source": p["source"],
        "createdAt": p["created_at"],
    }


def comment_obj(row) -> dict:
    c = dict(row)
    return {
        "id": c["id"],
        "postId": c["post_id"],
        "author": c["author"],
        "content": c["content"],
        "createdAt": c["created_at"],
    }


def feedback_obj(row) -> dict:
    f = dict(row)
    return {
        "id": f["id"],
        "type": f["type"],
        "content": f["content"],
        "contact": f["contact"],
        "author": f["author"],
        "createdAt": f["created_at"],
    }
