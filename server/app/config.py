"""后端配置：路径、监听地址、管理员账号、业务限制常量。

所有配置都可通过环境变量覆盖，方便本地开发与服务器部署使用不同参数。
"""

import os
from pathlib import Path

# ---------------------------------------------------------------- 路径
BASE_DIR = Path(__file__).resolve().parent.parent          # server/
DATA_DIR = Path(os.environ.get("BLOG_DATA_DIR", str(BASE_DIR / "data")))
DB_PATH = Path(os.environ.get("BLOG_DB", str(DATA_DIR / "blog.db")))
UPLOAD_DIR = Path(os.environ.get("BLOG_UPLOAD_DIR", str(DATA_DIR / "uploads")))

# ---------------------------------------------------------------- 监听
HOST = os.environ.get("BLOG_HOST", "127.0.0.1")
PORT = int(os.environ.get("BLOG_PORT", "8000"))

# 允许跨域的来源；"*" 表示全部放行（开发方便，生产请改成具体域名）
CORS_ORIGINS = os.environ.get("BLOG_CORS_ORIGINS", "*")

# ---------------------------------------------------------------- 管理员
ADMIN_USERNAME = "yg"
ADMIN_DEFAULT_PASSWORD = "yg123456"
ADMIN_REAL_NAME = "管理员"

# 登录令牌有效期（天）
SESSION_TTL_DAYS = int(os.environ.get("BLOG_SESSION_TTL_DAYS", "30"))

# ---------------------------------------------------------------- 业务限制
# 与前端 js/main.js 中的 LIMITS 保持一致，避免前后端校验规则冲突。
LIMITS = {
    "username_min": 2,
    "username_max": 16,
    "password_min": 6,
    "real_name_min": 2,
    "real_name_max": 20,
    "title_max": 60,
    "content_max": 5000,
    "comment_max": 500,
    "image_max_bytes": 5 * 1024 * 1024,      # 单张配图上限 5MB
    "avatar_max_bytes": 2 * 1024 * 1024,     # 头像上限 2MB
    "feedback_max": 500,
    "feedback_contact_max": 80,
}


def describe() -> str:
    """返回一段人类可读的启动信息，便于排查配置问题。"""
    return (
        f"数据目录 : {DATA_DIR}\n"
        f"数据库   : {DB_PATH}\n"
        f"上传目录 : {UPLOAD_DIR}\n"
        f"监听地址 : http://{HOST}:{PORT}\n"
        f"允许跨域 : {CORS_ORIGINS}"
    )
