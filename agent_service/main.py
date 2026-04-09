from pathlib import Path

from dotenv import load_dotenv

# Load agent_service/.env so OPENAI_API_KEY is set regardless of cwd (e.g. uvicorn from repo root).
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents import Agent, Runner


app = FastAPI(title="iMessage React Agent Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    reply: str


agent = Agent(
    name="SimpleResponder",
    instructions="Reply briefly like a friendly text message in one or two short sentences.",
)


@app.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="message is required")

    try:
        result = await Runner.run(agent, input=payload.message)
        reply_text = str(result.final_output).strip()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"agent_error: {exc}") from exc

    if not reply_text:
        reply_text = "Got it."

    return ChatResponse(reply=reply_text)
