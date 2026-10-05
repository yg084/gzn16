"""文件存储：保存上传的图片，并生成可访问的绝对 URL。"""

import secrets
from pathlib import Path

from . import config
from .http import HttpError

_ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
_EXT_BY_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def save_upload(file_info: dict, max_bytes: int, prefix: str) -> str:
    """把上传的图片写入 uploads 目录，返回相对路径 `/uploads/xxx.jpg`。"""
    data = file_info.get("data") or b""
    if not data:
        raise HttpError(400, "上传内容为空")
    if len(data) > max_bytes:
        raise HttpError(400, f"图片过大，请选择 {max_bytes // 1024 // 1024}MB 以内的图片")

    ext = Path(file_info.get("filename") or "").suffix.lower()
    if ext not in _ALLOWED_EXT:
        ext = _EXT_BY_TYPE.get((file_info.get("content_type") or "").lower(), ".jpg")

    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{prefix}-{secrets.token_hex(10)}{ext}"
    (config.UPLOAD_DIR / name).write_bytes(data)
    return f"/uploads/{name}"


def abs_url(req, path: str) -> str:
    """把 `/uploads/x.jpg` 拼成前端可直接使用的完整地址。

    这样即使前端部署在 GitHub Pages、后端部署在另一台服务器，图片也能正常显示。
    """
    if not path:
        return ""
    if path.startswith("http://") or path.startswith("https://"):
        return path
    host = req.headers.get("Host")
    if not host:
        return path
    proto = req.headers.get("X-Forwarded-Proto") or "http"
    return f"{proto}://{host}{path}"
