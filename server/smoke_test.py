#!/usr/bin/env python3
"""后端接口自检脚本（冒烟测试）。

用法：
    先启动服务： python run.py
    再另开一个终端： python smoke_test.py [http://127.0.0.1:8000]

仅使用标准库，会覆盖认证、博客、评论、反馈、头像上传（multipart）、管理员权限等主要路径，
并在结束后自动清理测试产生的数据。
"""

import base64
import json
import random
import string
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
PASSED, FAILED = 0, 0

# 1x1 透明 PNG，用于测试图片上传
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def call(method, path, body=None, token=None, expect=200):
    """发送 JSON 请求，返回 (状态码, 解析后的响应)。"""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status, payload = resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        status, payload = exc.code, exc.read().decode("utf-8")
    parsed = json.loads(payload) if payload else {}
    if expect is not None and status != expect:
        raise AssertionError(f"{method} {path} -> {status}，期望 {expect}：{parsed}")
    return status, parsed


def post_multipart(path, fields, files, token):
    """发送 multipart/form-data 请求（用于测试图片上传）。"""
    boundary = "----smoke" + "".join(random.choices(string.ascii_letters, k=12))
    parts = []
    for key, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode("utf-8")
        )
    for key, (filename, content) in files.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"; filename="{filename}"\r\n'
            f"Content-Type: image/png\r\n\r\n".encode("utf-8") + content + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)

    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status, payload = resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        status, payload = exc.code, exc.read().decode("utf-8")
    if status != 200:
        raise AssertionError(f"POST {path} -> {status}：{payload}")
    return json.loads(payload)


def step(name, func):
    global PASSED, FAILED
    try:
        detail = func()
        PASSED += 1
        print(f"  [通过] {name}{' — ' + detail if detail else ''}")
    except Exception as exc:  # noqa: BLE001
        FAILED += 1
        print(f"  [失败] {name} — {exc}")


def main():
    print(f"目标服务：{BASE}\n")

    state = {}
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    state["username"] = "smoke" + suffix
    state["password"] = "test123456"

    # ---------------------------------------------------------- 基础
    def t_health():
        _, data = call("GET", "/api/health")
        assert data["status"] == "ok"
        return data["service"]

    def t_seed_posts():
        _, data = call("GET", "/api/posts")
        assert data["total"] >= 45, f"种子博客数量不足：{data['total']}"
        return f"共 {data['total']} 篇，首篇 {data['posts'][0]['id']}"

    step("健康检查", t_health)
    step("博客列表与种子数据", t_seed_posts)

    # ---------------------------------------------------------- 注册 / 登录
    def t_register():
        _, data = call(
            "POST", "/api/auth/register",
            {"username": state["username"], "password": state["password"],
             "password2": state["password"], "realName": "冒烟测试"},
        )
        state["token"] = data["token"]
        assert data["user"]["role"] == "user"
        return f"用户 {data['user']['username']}"

    def t_duplicate_register():
        call("POST", "/api/auth/register",
             {"username": state["username"], "password": state["password"],
              "password2": state["password"], "realName": "重名"},
             expect=409)
        return "重复用户名被正确拒绝(409)"

    def t_wrong_password():
        call("POST", "/api/auth/login",
             {"username": state["username"], "password": "wrongpassword"}, expect=401)
        return "错误密码被正确拒绝(401)"

    def t_admin_login():
        _, data = call("POST", "/api/auth/login",
                       {"username": "yg", "password": "yg123456"})
        state["admin_token"] = data["token"]
        assert data["user"]["role"] == "admin"
        return f"管理员 {data['user']['username']}"

    step("注册新用户", t_register)
    step("重复用户名校验", t_duplicate_register)
    step("错误密码校验", t_wrong_password)
    step("管理员登录", t_admin_login)

    # ---------------------------------------------------------- 权限
    def t_forbidden_admin():
        call("GET", "/api/admin/stats", token=state["token"], expect=403)
        return "普通用户访问管理接口被拒(403)"

    def t_unauthorized():
        call("GET", "/api/admin/stats", expect=401)
        return "未登录访问管理接口被拒(401)"

    step("普通用户越权校验", t_forbidden_admin)
    step("未登录鉴权校验", t_unauthorized)

    # ---------------------------------------------------------- 博客
    def t_create_post():
        _, data = call("POST", "/api/posts",
                       {"title": "冒烟测试博客", "content": "这是自检脚本创建的测试内容。"},
                       token=state["token"])
        state["post_id"] = data["post"]["id"]
        assert data["post"]["author"] == state["username"]
        assert data["post"]["authorRole"] == "user"
        return state["post_id"]

    def t_create_post_with_image():
        data = post_multipart(
            "/api/posts",
            {"title": "带图片的博客", "content": "图片上传（multipart）测试。"},
            {"image": ("pic.png", TINY_PNG)},
            state["token"],
        )
        state["image_post_id"] = data["post"]["id"]
        assert data["post"]["image"].startswith("http"), data["post"]["image"]
        return data["post"]["image"]

    def t_zone_filter():
        _, data = call("GET", "/api/posts?zone=user&author=" + state["username"])
        assert data["total"] >= 1
        return f"用户分区 {data['total']} 篇"

    def t_keyword():
        _, data = call("GET", "/api/posts?keyword=" + urllib.parse.quote("冒烟测试"))
        assert data["total"] >= 1
        return f"关键词命中 {data['total']} 篇"

    def t_get_post():
        _, data = call("GET", "/api/posts/" + state["post_id"])
        assert data["post"]["title"] == "冒烟测试博客"
        return data["post"]["title"]

    def t_update_post():
        _, data = call("PATCH", "/api/posts/" + state["post_id"],
                       {"title": "冒烟测试博客（已修改）"}, token=state["token"])
        assert data["post"]["title"].endswith("已修改）")
        return "标题已更新"

    step("发布博客", t_create_post)
    step("发布带图片博客(multipart)", t_create_post_with_image)
    step("按作者/分区筛选", t_zone_filter)
    step("关键词搜索", t_keyword)
    step("博客详情", t_get_post)
    step("修改博客", t_update_post)

    # ---------------------------------------------------------- 评论
    def t_comment():
        _, data = call("POST", f"/api/posts/{state['post_id']}/comments",
                       {"content": "来自自检脚本的评论"}, token=state["token"])
        state["comment_id"] = data["comment"]["id"]
        return data["comment"]["id"]

    def t_list_comments():
        _, data = call("GET", f"/api/posts/{state['post_id']}/comments")
        assert len(data["comments"]) == 1
        return "1 条评论"

    def t_update_comment():
        _, data = call("PATCH", "/api/comments/" + state["comment_id"],
                       {"content": "评论已修改"}, token=state["token"])
        assert data["comment"]["content"] == "评论已修改"
        return "内容已更新"

    step("发表评论", t_comment)
    step("评论列表", t_list_comments)
    step("修改评论", t_update_comment)

    # ---------------------------------------------------------- 反馈 / 头像
    def t_feedback_anonymous():
        _, data = call("POST", "/api/feedback",
                       {"type": "问题反馈", "content": "未登录也能提交反馈", "contact": "test@example.com"})
        assert data["feedback"]["author"] in (None, "")
        return "匿名反馈已保存"

    def t_upload_avatar():
        data = post_multipart("/api/users/me/avatar", {}, {"file": ("a.png", TINY_PNG)}, state["token"])
        state["avatar"] = data["avatar"]
        assert data["avatar"].startswith("http")
        return data["avatar"]

    def t_delete_avatar():
        _, data = call("DELETE", "/api/users/me/avatar", token=state["token"])
        assert data["avatar"] == ""
        return "头像已移除"

    step("匿名提交反馈", t_feedback_anonymous)
    step("上传头像(multipart)", t_upload_avatar)
    step("移除头像", t_delete_avatar)

    # ---------------------------------------------------------- 用户主页 / 管理员
    def t_profile():
        _, data = call("GET", "/api/users/" + state["username"])
        assert data["profile"]["realName"] == "冒烟测试"
        assert data["profile"]["postCount"] >= 2
        return f"{data['profile']['username']} 博客 {data['profile']['postCount']} 篇"

    def t_admin_stats():
        _, data = call("GET", "/api/admin/stats", token=state["admin_token"])
        s = data["stats"]
        return f"用户 {s['users']} / 博客 {s['posts']} / 评论 {s['comments']} / 反馈 {s['feedback']}"

    def t_admin_users():
        _, data = call("GET", "/api/users", token=state["admin_token"])
        assert all("passwordHash" not in u and "password" not in u for u in data["users"])
        return f"{data['total']} 个用户，未泄露密码字段"

    def t_export():
        _, data = call("GET", "/api/admin/export", token=state["admin_token"])
        assert len(data["posts"]) >= 2
        return f"导出 用户{len(data['users'])}/博客{len(data['posts'])}/评论{len(data['comments'])}"

    def t_admin_text():
        call("PUT", "/api/admin-text",
             {"postId": state["post_id"], "title": "覆盖标题", "content": "覆盖正文"},
             token=state["admin_token"])
        _, data = call("GET", "/api/admin-text")
        assert data["adminText"][state["post_id"]]["title"] == "覆盖标题"
        return "文字覆盖读写正常"

    step("用户主页", t_profile)
    step("管理员统计", t_admin_stats)
    step("用户列表（无密码泄露）", t_admin_users)
    step("导出数据", t_export)
    step("管理员文字覆盖", t_admin_text)

    # ---------------------------------------------------------- 清理
    def t_delete_post():
        call("DELETE", "/api/posts/" + state["post_id"], token=state["token"])
        call("GET", "/api/posts/" + state["post_id"], expect=404)
        call("DELETE", "/api/posts/" + state["image_post_id"], token=state["token"])
        return "测试博客已删除"

    def t_admin_delete_user():
        _, data = call("GET", "/api/users", token=state["admin_token"])
        target = next(u for u in data["users"] if u["username"] == state["username"])
        call("DELETE", "/api/users/" + target["id"], token=state["admin_token"])
        call("GET", "/api/users/" + state["username"], expect=404)
        return "测试用户已级联删除"

    step("删除博客(级联评论)", t_delete_post)
    step("管理员删除用户(级联)", t_admin_delete_user)

    print(f"\n结果：通过 {PASSED} 项，失败 {FAILED} 项")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(main())
