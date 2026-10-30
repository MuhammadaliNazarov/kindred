"""Pydantic mirrors of web/src/lib/types.ts (same field names). Keep in sync with the frozen contract."""
from __future__ import annotations

from typing import Generic, Literal, Optional, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")

TriggerType = Literal["funding", "exec_hire", "job_post", "tech_change", "launch"]
SignalType = Literal["funding", "exec_hire", "job_post", "tech_change", "launch", "churn_risk"]
Stage = Literal["matched", "contacted", "replied", "meeting", "closed_won", "closed_lost"]
Actor = Literal["ai", "rep"]
STAGES: list[str] = ["matched", "contacted", "replied", "meeting", "closed_won", "closed_lost"]


class Source(BaseModel):
    url: str
    title: str
    quote: str
    fetched_at: str
    verified: bool


class Scored(BaseModel, Generic[T]):
    value: T
    confidence: float
    sources: Optional[list[Source]] = None


class Intake(BaseModel):
    product_name: str
    product_url: str
    description: str
    features: list[str] = []
    constraints: list[str] = []
    reference_customers: list[str] = []
    pricing_model: str = ""
    acv_usd: Optional[float] = None
    lost_deal: Optional[str] = None
    past_employers: list[str] = []  # founder history -> (Me)-[:previously_employed_at]->(Company)


class Industry(BaseModel):
    name: str
    naics: str


class CompanySize(BaseModel):
    min_headcount: int
    max_headcount: int
    revenue_band: str


class PersonaV(BaseModel):
    title: str
    seniority: str
    function: str


class TriggerV(BaseModel):
    type: TriggerType
    description: str


class ICP(BaseModel):
    industries: list[Scored[Industry]]
    company_size: Scored[CompanySize]
    personas: list[Scored[PersonaV]]
    triggers: list[Scored[TriggerV]]
    negative_signals: list[str]
    regions: list[str]


class ExpansionSegment(BaseModel):
    id: str
    name: str
    rationale: str
    confidence: float
    sources: list[Source]
    status: Literal["suggested", "accepted", "adjusted", "dismissed"]


class Signal(BaseModel):
    id: str
    company_id: str
    type: SignalType
    summary: str
    date: str
    source: Source


class Company(BaseModel):
    id: str
    name: str
    domain: str
    industry: str
    naics: str
    headcount: int
    hq: str
    fit: int
    intent: int
    score: int
    tier: Literal["A", "B", "C"]
    signals: list[Signal]
    competitors_used: list[str]
    sources: list[Source]


class Enrichment(BaseModel):
    email: Optional[str] = None
    email_status: Literal["valid", "accept_all", "invalid", "unknown", "pending"] = "unknown"
    mx_ok: Optional[bool] = None
    linkedin_url: Optional[str] = None
    provider: Optional[Literal["hunter", "apollo", "seed"]] = None
    confidence: float = 0.0


class Person(BaseModel):
    id: str
    company_id: str
    name: str
    title: str
    seniority: str
    enrichment: Enrichment = Field(default_factory=Enrichment)
    sources: list[Source] = []


class Hop(BaseModel):
    from_: str = Field(alias="from")
    rel: str
    to: str

    model_config = {"populate_by_name": True, "serialize_by_alias": True}


class WarmPath(BaseModel):
    lead_id: str
    hops: list[Hop]
    cypher: str


class Lead(BaseModel):
    id: str
    person_id: str
    company_id: str
    stage: Stage
    owner: Actor
    variant: Literal["A", "B"]
    updated_at: str


class Review(BaseModel):
    verdict: Literal["pass", "fix", "fail"]
    notes: str
    agent: Literal["reviewer"] = "reviewer"
    score: Optional[float] = None  # verifier score (same function = GRPO reward)
    max_score: Optional[float] = None
    checks: Optional[list[dict]] = None  # [{name, pass, detail?}]


class Security(BaseModel):
    verdict: Literal["pass", "fail"]
    notes: str
    agent: Literal["security"] = "security"


class Touch(BaseModel):
    id: str
    lead_id: str
    step: int
    channel: Literal["email", "linkedin"]
    subject: Optional[str] = None
    body: str
    signal_id: str
    variant: Literal["A", "B"]
    arm: Optional[str] = None  # bandit arm id, e.g. warmpath_hook__doc
    status: Literal["draft", "approved", "edited", "rejected", "sent"]
    review: Review
    security: Security


class AuditEvent(BaseModel):
    id: str
    at: str
    actor: Actor
    agent: Optional[Literal["planner", "builder", "reviewer", "security", "icp", "discovery", "enricher"]] = None
    action: str
    lead_id: Optional[str] = None
    detail: str


class ThinkingStep(BaseModel):
    id: str
    at: str
    agent: str
    kind: Literal["reason", "search", "graph", "validate", "meter", "handoff"]
    text: str
    cypher: Optional[str] = None


class Used(BaseModel):
    lead_enriched: float = 0
    outreach_sent: float = 0
    graph_query: float = 0


class Credits(BaseModel):
    balance: float
    granted: float
    used: Used
    blocked: bool


class GraphNode(BaseModel):
    id: str
    label: str
    type: Literal["Company", "Person", "Product", "Competitor", "Signal", "Me"]


class GraphLink(BaseModel):
    source: str
    target: str
    rel: str


class GraphData(BaseModel):
    nodes: list[GraphNode]
    links: list[GraphLink]


# ---- request bodies ----
class ExpansionUpdate(BaseModel):
    status: Literal["suggested", "accepted", "adjusted", "dismissed"]
    name: Optional[str] = None
    rationale: Optional[str] = None


class MoveBody(BaseModel):
    stage: Stage
    actor: Actor = "rep"


class ReviewBody(BaseModel):
    action: Literal["approve", "edit", "reject"]
    body: Optional[str] = None
    subject: Optional[str] = None
    actor: Actor = "rep"
