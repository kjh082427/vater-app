"""Vater 사이드카 (vater-core)."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__: str = version("vater-core")
except PackageNotFoundError:  # 설치되지 않은 소스 트리에서 실행할 때
    __version__ = "0.0.0-dev"
