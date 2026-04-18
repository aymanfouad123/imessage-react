import logging

from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import JSONResponse

from .orchestrator import execute_agent_run
from .schemas import AgentRunRequest

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/agent/runs")
async def agent_runs(
    request: AgentRunRequest,
    background_tasks: BackgroundTasks,
) -> JSONResponse:
    background_tasks.add_task(_run_safe, request)
    return JSONResponse(
        status_code=202,
        content={"run_id": request.run_id},
    )


async def _run_safe(request: AgentRunRequest) -> None:
    try:
        await execute_agent_run(request)
    except Exception:
        logger.exception("execute_agent_run failed run_id=%s", request.run_id)
