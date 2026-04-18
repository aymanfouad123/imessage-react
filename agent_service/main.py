import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

logging.basicConfig(level=os.getenv("AGENT_LOG_LEVEL", "INFO").upper())

from fastapi import FastAPI

from . import next_client
from .runs import router as runs_router
from .schemas import HealthResponse


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await next_client.startup()
    try:
        yield
    finally:
        await next_client.shutdown()


app = FastAPI(title="iMessage React Agent Service", lifespan=lifespan)

app.include_router(runs_router)


@app.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    return HealthResponse(status="ok")
