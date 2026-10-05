"""API 路由汇总：所有业务接口在这里统一注册。"""

from ..router import Router
from . import admin_api, auth_api, comments_api, feedback_api, posts_api, users_api


def build_router() -> Router:
    router = Router()
    auth_api.register(router)
    users_api.register(router)
    posts_api.register(router)
    comments_api.register(router)
    feedback_api.register(router)
    admin_api.register(router)
    return router
