"""Typed state carried through one minimal-agent decision graph invocation."""

from __future__ import annotations

from typing import NotRequired, TypedDict


class DecisionState(TypedDict):
    """Per-request graph state; no field persists into a future decision."""

    initial_publication: dict
    snapshot: dict
    top_k: int
    previews: NotRequired[list]
    compact_candidates: NotRequired[list[dict[str, object]]]
    model_selection: NotRequired[dict[str, object] | None]
    model_error: NotRequired[str]
    decision: NotRequired[dict[str, object]]

