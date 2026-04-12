from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from orchestrator import AgentServiceError, respond_to_chat
from schemas import AgentRespondRequest, AgentRespondResponse, HealthResponse


app = FastAPI(title="iMessage React Agent Service")

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
