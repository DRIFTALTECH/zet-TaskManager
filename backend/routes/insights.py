"""
routes/insights.py — AI Insights generation endpoint for ZET.
"""
import asyncio
import logging

from fastapi import APIRouter, Depends

from logic.insight_logic import InsightsRequest, InsightsResponse, generate_insights
from routes.deps import get_current_user_id

log = logging.getLogger("zet.insights")
router = APIRouter()


@router.post("/generate", response_model=InsightsResponse)
async def generate_insights_route(
    body: InsightsRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Generate AI insights for a given analytics scope."""
    return await asyncio.to_thread(generate_insights, body.scope, body.context)
