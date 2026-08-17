"""Bounded reads for uploaded files.

`await file.read()` pulls the entire body into memory before any size check runs,
so the limit protects the database row but not the process: N concurrent uploads
cost N x filesize in RAM regardless of the cap.

`read_limited` streams in chunks and aborts as soon as the limit is passed, so an
oversized body is rejected after reading limit+1 bytes instead of all of it.
"""

from fastapi import HTTPException, UploadFile, status

CHUNK_BYTES = 1024 * 1024  # 1 MiB


async def read_limited(file: UploadFile, max_bytes: int, *, label: str = "File") -> bytes:
    """Read at most `max_bytes`; raise 413 the moment the body exceeds it."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"{label} exceeds the {max_bytes // (1024 * 1024)} MB limit",
            )
        chunks.append(chunk)
    return b"".join(chunks)
