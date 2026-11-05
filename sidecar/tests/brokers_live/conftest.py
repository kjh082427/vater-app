"""증권사 실연동 테스트 공용. 토큰은 메모리에만 둔다."""

import pytest


class _MemoryTokens:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, name: str) -> str | None:
        return self.values.get(name)

    def set(self, name: str, value: str) -> None:
        self.values[name] = value

    def delete(self, name: str) -> None:
        self.values.pop(name, None)

    def known_values(self) -> list[str]:
        return list(self.values.values())


@pytest.fixture
def memory_tokens() -> _MemoryTokens:
    return _MemoryTokens()
