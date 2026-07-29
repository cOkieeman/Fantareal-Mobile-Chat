from __future__ import annotations

import pytest

from fantareal_mobile_chat.domain import DomainError
from fantareal_mobile_chat.service import MobileChatService


@pytest.mark.parametrize(
    "method",
    [
        "mobile.background.catalog",
        "mobile.background.prepare",
        "mobile.background.commit",
        "mobile.background.abort",
    ],
)
def test_background_generation_rpc_is_not_available(
    service: MobileChatService,
    method: str,
) -> None:
    with pytest.raises(DomainError) as raised:
        service.dispatch(method, {})

    assert raised.value.code == "method_not_found"
