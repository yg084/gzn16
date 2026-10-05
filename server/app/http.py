"""HTTP 请求封装、错误类型、multipart 解析。

只依赖标准库：multipart 解析借助 email 模块完成
（Python 3.13 起 cgi 模块已被移除，故不能使用 cgi.FieldStorage）。
"""

import json
from email.parser import BytesParser
from email.policy import default as email_policy
from urllib.parse import parse_qsl, urlsplit


class HttpError(Exception):
    """业务错误：由分发层捕获并转成对应状态码的 JSON 响应。"""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class Request:
    """对 BaseHTTPRequestHandler 的轻量包装，供处理函数使用。"""

    def __init__(self, handler, params=None):
        self.handler = handler
        self.method = handler.command
        parsed = urlsplit(handler.path)
        self.path = parsed.path
        self.query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        self.headers = handler.headers
        self.params = params or {}
        self.user = None                 # 由分发层在鉴权后填充
        self._cache = {}

    # ------------------------------------------------------------ 请求体
    @property
    def body(self) -> bytes:
        """原始请求体字节（只读取一次并缓存）。"""
        if "_body" not in self._cache:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            self._cache["_body"] = self.handler.rfile.read(length) if length > 0 else b""
        return self._cache["_body"]

    @property
    def content_type(self) -> str:
        """去掉参数部分的 Content-Type，小写，如 multipart/form-data。"""
        return (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()

    def json(self) -> dict:
        """把请求体解析为 JSON 对象。"""
        raw = self.body
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            raise HttpError(400, "请求体不是合法的 JSON")
        if isinstance(data, dict):
            return data
        return {"value": data}

    def multipart(self):
        """解析 multipart/form-data，返回 (普通字段字典, 文件字典)。

        文件字典结构：{ name: {filename, content_type, data(bytes)} }
        """
        content_type = self.headers.get("Content-Type") or ""
        if "multipart/form-data" not in content_type.lower():
            raise HttpError(400, "期望 multipart/form-data 请求")

        raw = b"Content-Type: " + content_type.encode("utf-8") + b"\r\n\r\n" + self.body
        message = BytesParser(policy=email_policy).parsebytes(raw)

        fields, files = {}, {}
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue
            filename = part.get_filename()
            payload = part.get_payload(decode=True) or b""
            if filename is None:
                fields[name] = payload.decode("utf-8", "replace")
            else:
                files[name] = {
                    "filename": filename,
                    "content_type": part.get_content_type(),
                    "data": payload,
                }
        return fields, files

    def input(self):
        """统一读取表单：JSON 或 multipart 都能用。

        返回 (字段字典, 文件字典)；JSON 请求时文件字典为空。
        """
        if self.content_type == "multipart/form-data":
            return self.multipart()
        return self.json(), {}
