"""Run blocking work off the event loop.

# ponytail: threadpool until psycopg3 + ainvoke. Copies request ContextVar so
# the DB wrapper still sees the scoped connection in the worker thread.
"""
from __future__ import annotations

import asyncio
import contextvars
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


async def offloop(fn: Callable[..., T], *args, **kwargs) -> T:
    ctx = contextvars.copy_context()
    return await asyncio.to_thread(lambda: ctx.run(fn, *args, **kwargs))
