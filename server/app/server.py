"""HTTP 服务器：接收请求 → 路由匹配 → 鉴权 → 调用处理函数 → 返回 JSON。"""

import json
import mimetypes
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

from . import config
from .auth import resolve_user
from .http import HttpError, Request


class BlogRequestHandler(BaseHTTPRequestHandler):
    server_version = "Gzn16Backend/1.0"
    protocol_version = "HTTP/1.1"

    # ---------------------------------------------------------- HTTP 方法
    def do_GET(self):     self._dispatch("GET")
    def do_POST(self):    self._dispatch("POST")
    def do_PATCH(self):   self._dispatch("PATCH")
    def do_PUT(self):     self._dispatch("PUT")
    def do_DELETE(self):  self._dispatch("DELETE")
    def do_OPTIONS(self): self._dispatch("OPTIONS")

    # ---------------------------------------------------------- 分发
    def _dispatch(self, method):
        try:
            path = unquote(urlsplit(self.path).path)

            if method == "OPTIONS":
                self._send_bytes(204, b"", "text/plain")
                return

            if method == "GET" and path.startswith("/uploads/"):
                self._serve_upload(path)
                return

            req = Request(self)
            route, params = self.server.router.match(method, path)
            if route is None:
                raise HttpError(404, f"接口不存在：{method} {path}")
            req.params = params

            if route.auth or route.admin or route.optional_auth:
                req.user = resolve_user(req)
                if (route.auth or route.admin) and not req.user:
                    raise HttpError(401, "请先登录")
            if route.admin and req.user["role"] != "admin":
                raise HttpError(403, "需要管理员权限")

            result = route.handler(req)
            self._send_json(200, {"ok": True} if result is None else result)

        except HttpError as exc:
            self._send_json(exc.status, {"error": exc.message})
        except BrokenPipeError:
            pass
        except Exception as exc:  # noqa: BLE001 - 兜底，避免单个请求打挂服务
            traceback.print_exc()
            self._send_json(500, {"error": f"服务器内部错误：{exc}"})

    # ---------------------------------------------------------- 响应
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", config.CORS_ORIGINS)
        self.send_header(
            "Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS"
        )
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "86400")

    def _send_bytes(self, status, body: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send_bytes(status, body, "application/json; charset=utf-8")

    def _serve_upload(self, path):
        """提供 /uploads/ 下的图片访问，并防止路径穿越。"""
        rel = path[len("/uploads/"):]
        root = config.UPLOAD_DIR.resolve()
        target = (root / rel).resolve()
        if root != target and root not in target.parents:
            self._send_json(403, {"error": "非法路径"})
            return
        if not target.is_file():
            self._send_json(404, {"error": "文件不存在"})
            return
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self._send_bytes(200, target.read_bytes(), ctype)

    # ---------------------------------------------------------- 日志
    def log_message(self, fmt, *args):  # noqa: A003 - 覆盖基类方法
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")


def build_server() -> ThreadingHTTPServer:
    """创建（但尚未启动）HTTP 服务器实例，路由表挂在服务器对象上。"""
    from .api import build_router

    httpd = ThreadingHTTPServer((config.HOST, config.PORT), BlogRequestHandler)
    httpd.router = build_router()
    return httpd
