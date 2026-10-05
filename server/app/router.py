"""极简路由表：支持 `:参数` 形式的路径变量与按需鉴权标记。"""

import re

from .http import HttpError


def _compile(pattern: str) -> re.Pattern:
    """把 `/api/posts/:id/comments` 编译成正则，并捕获命名参数。"""
    parts = []
    for segment in pattern.strip("/").split("/"):
        if segment.startswith(":"):
            parts.append(f"(?P<{segment[1:]}>[^/]+)")
        else:
            parts.append(re.escape(segment))
    return re.compile("^/" + "/".join(parts) + "$")


class Route:
    __slots__ = ("method", "pattern", "handler", "auth", "admin", "optional_auth", "regex")

    def __init__(self, method, pattern, handler, auth=False, admin=False, optional_auth=False):
        self.method = method.upper()
        self.pattern = pattern
        self.handler = handler
        self.auth = auth                 # 必须登录
        self.admin = admin               # 必须是管理员
        self.optional_auth = optional_auth  # 登录与否都可，但登录时填充 req.user
        self.regex = _compile(pattern)


class Router:
    def __init__(self):
        self.routes = []

    def add(self, method, pattern, handler, auth=False, admin=False, optional_auth=False):
        self.routes.append(Route(method, pattern, handler, auth, admin, optional_auth))

    # 便捷方法
    def get(self, p, h, **kw):    self.add("GET", p, h, **kw)
    def post(self, p, h, **kw):   self.add("POST", p, h, **kw)
    def patch(self, p, h, **kw):  self.add("PATCH", p, h, **kw)
    def put(self, p, h, **kw):    self.add("PUT", p, h, **kw)
    def delete(self, p, h, **kw): self.add("DELETE", p, h, **kw)

    def match(self, method, path):
        """返回 (Route, 路径参数字典)；未匹配返回 (None, None)。"""
        method = method.upper()
        path_exists = False
        for route in self.routes:
            m = route.regex.match(path)
            if not m:
                continue
            if route.method != method:
                path_exists = True
                continue
            return route, m.groupdict()
        if path_exists:
            raise HttpError(405, "该接口不支持此请求方法")
        return None, None
