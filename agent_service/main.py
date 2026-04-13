from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from . import client
from .orchestrator import AgentServiceError, respond_to_chat, stream_response_events
from .schemas import AgentRespondRequest, AgentRespondResponse, HealthResponse


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await client.startup()
    try:
        yield
    finally:
        await client.shutdown()


app = FastAPI(title="iMessage React Agent Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/agent/respond", response_model=AgentRespondResponse)
async def agent_respond(
    payload: AgentRespondRequest = Body(default_factory=AgentRespondRequest),
) -> AgentRespondResponse:
    try:
        return await respond_to_chat(payload)
    except AgentServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


def _to_sse(event_name: str, data: str) -> str:
    lines = [f"event: {event_name}"]
    lines.extend(f"data: {line}" for line in data.splitlines())
    return "\n".join(lines) + "\n\n"


@app.post("/agent/respond/stream")
async def agent_respond_stream(
    payload: AgentRespondRequest = Body(default_factory=AgentRespondRequest),
) -> StreamingResponse:
    async def event_stream() -> AsyncIterator[str]:
        async for event in stream_response_events(payload):
            yield _to_sse(event.type, event.model_dump_json(exclude_none=True))

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
