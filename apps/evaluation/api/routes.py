# SPDX-License-Identifier: AGPL-3.0-only
"""Evaluation service API — datasets, runs, regression gates."""

from __future__ import annotations

import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import storage
from .auth import Tenant, require_tenant
from scorers import SCORERS, PLUGIN_SCORERS
from scorers.engine import score_items, is_regression

router = APIRouter()

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:120] or "dataset"


# ─── Datasets ──────────────────────────────────────────────────────────────

class DatasetItem(BaseModel):
    input: str
    expected_output: str = ""
    expected_tool_calls: List[str] = Field(default_factory=list)


class CreateDataset(BaseModel):
    name: str
    description: str = ""
    items: List[DatasetItem] = Field(default_factory=list)


@router.post("/v1/datasets", status_code=201)
def create_dataset(body: CreateDataset, tenant: Tenant = Depends(require_tenant)):
    slug = _slug(body.name)
    with storage.cursor() as cur:
        cur.execute(
            """
            INSERT INTO eval_datasets (org_id, project_id, name, slug, description)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (org_id, project_id, slug) DO UPDATE SET name = EXCLUDED.name
            RETURNING id::text
            """,
            (tenant.org_id, tenant.project_id, body.name, slug, body.description),
        )
        dataset_id = cur.fetchone()["id"]
        cur.execute(
            "SELECT COALESCE(MAX(version), 0) + 1 AS v FROM eval_dataset_versions WHERE dataset_id = %s",
            (dataset_id,),
        )
        version = cur.fetchone()["v"]

    items = [i.model_dump() for i in body.items]
    key = f"{tenant.org_id}/{tenant.project_id}/{slug}/v{version}.jsonl"
    storage.put_items(key, items)

    with storage.cursor() as cur:
        cur.execute(
            "INSERT INTO eval_dataset_versions (dataset_id, version, item_count, object_key) VALUES (%s,%s,%s,%s)",
            (dataset_id, version, len(items), key),
        )
    return {"dataset_id": dataset_id, "slug": slug, "version": version, "item_count": len(items)}


@router.get("/v1/datasets")
def list_datasets(tenant: Tenant = Depends(require_tenant)):
    with storage.cursor() as cur:
        cur.execute(
            """
            SELECT d.id::text, d.name, d.slug, d.description, d.created_at,
                   COALESCE(MAX(v.version), 0) AS latest_version,
                   COALESCE(MAX(v.item_count), 0) AS item_count
            FROM eval_datasets d
            LEFT JOIN eval_dataset_versions v ON v.dataset_id = d.id
            WHERE d.org_id = %s AND d.project_id = %s
            GROUP BY d.id ORDER BY d.created_at DESC
            """,
            (tenant.org_id, tenant.project_id),
        )
        return {"datasets": cur.fetchall()}


# ─── Runs ──────────────────────────────────────────────────────────────────

class RunResultIn(BaseModel):
    input: str = ""
    expected: str = ""
    actual: str = ""
    tool_calls: List[str] = Field(default_factory=list)
    expected_tool_calls: List[str] = Field(default_factory=list)
    latency_ms: float = 0
    cost_usd: float = 0


class RunRequest(BaseModel):
    dataset_id: str
    scorers: List[str] = Field(default_factory=list)
    results: List[RunResultIn] = Field(default_factory=list)
    set_baseline: bool = False
    gate: bool = True


def _dataset_owned(cur, dataset_id: str, tenant: Tenant):
    cur.execute(
        "SELECT id::text FROM eval_datasets WHERE id = %s AND org_id = %s AND project_id = %s",
        (dataset_id, tenant.org_id, tenant.project_id),
    )
    if not cur.fetchone():
        raise HTTPException(status_code=404, detail="dataset not found")


def _load_ground_truth(cur, dataset_id: str) -> dict:
    """Map input -> dataset item from the latest dataset version's stored JSONL,
    so scoring uses the server-owned expected outputs. Empty if absent."""
    cur.execute(
        "SELECT object_key FROM eval_dataset_versions WHERE dataset_id = %s ORDER BY version DESC LIMIT 1",
        (dataset_id,),
    )
    row = cur.fetchone()
    if not row or not row.get("object_key"):
        return {}
    try:
        ds_items = storage.get_items(row["object_key"])
    except Exception:  # noqa: BLE001 — missing object shouldn't fail the run
        return {}
    return {it.get("input", ""): it for it in ds_items if it.get("input")}


@router.post("/v1/evaluations/run")
def run_evaluation(body: RunRequest, tenant: Tenant = Depends(require_tenant)):
    if not body.results:
        raise HTTPException(status_code=400, detail="no results to score")

    # Reject unknown scorer names up front. Otherwise the engine silently drops
    # them and a CI gate can "pass" on a typo'd scorer — a dangerous false green.
    known = set(SCORERS) | set(PLUGIN_SCORERS)
    unknown = [s for s in body.scorers if s not in known]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"unknown scorer(s): {', '.join(unknown)}. Available: {', '.join(sorted(known))}",
        )

    items = [r.model_dump() for r in body.results]

    # Join the dataset's server-owned ground truth to the submitted results by
    # input, so scores reflect the dataset's expected outputs rather than the
    # caller-supplied `expected` (which the client controls and could spoof).
    with storage.cursor() as cur:
        _dataset_owned(cur, body.dataset_id, tenant)
        ground_truth = _load_ground_truth(cur, body.dataset_id)
    matched = 0
    for it in items:
        g = ground_truth.get(it.get("input", ""))
        if g:
            it["expected"] = g.get("expected_output", it.get("expected", ""))
            it["expected_tool_calls"] = g.get("expected_tool_calls", it.get("expected_tool_calls", []))
            matched += 1

    scored = score_items(items, body.scorers)

    with storage.cursor() as cur:
        cur.execute("SELECT score FROM eval_baselines WHERE dataset_id = %s", (body.dataset_id,))
        row = cur.fetchone()
        baseline = row["score"] if row else None
        regression = is_regression(scored["score"], baseline)
        passed = not (body.gate and regression)

        import json as _json

        cur.execute(
            """
            INSERT INTO eval_runs (org_id, project_id, dataset_id, score, item_count, passed, regression, per_scorer)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id::text
            """,
            (
                tenant.org_id, tenant.project_id, body.dataset_id, scored["score"],
                len(items), passed, regression, _json.dumps(scored["per_scorer"]),
            ),
        )
        run_id = cur.fetchone()["id"]
        for r in scored["results"]:
            cur.execute(
                "INSERT INTO eval_results (run_id, idx, input, expected, actual, passed, scores) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (run_id, r["idx"], r["input"], r["expected"], r["actual"], r["passed"], _json.dumps(r["scores"])),
            )
        if body.set_baseline:
            cur.execute(
                """
                INSERT INTO eval_baselines (dataset_id, run_id, score) VALUES (%s,%s,%s)
                ON CONFLICT (dataset_id) DO UPDATE SET run_id = EXCLUDED.run_id, score = EXCLUDED.score, updated_at = NOW()
                """,
                (body.dataset_id, run_id, scored["score"]),
            )

    return {
        "run_id": run_id,
        "score": round(scored["score"], 4),
        "per_scorer": {k: round(v, 4) for k, v in scored["per_scorer"].items()},
        "baseline": baseline,
        "regression": regression,
        "passed": passed,
        "matched_dataset_items": matched,
        "item_count": len(items),
    }


@router.get("/v1/evaluations/{run_id}")
def get_run(run_id: str, tenant: Tenant = Depends(require_tenant)):
    """Return a run plus its per-item results (already persisted at run time)."""
    if not _UUID_RE.match(run_id):
        raise HTTPException(status_code=404, detail="run not found")
    with storage.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, dataset_id::text, score, item_count, passed, regression, per_scorer, created_at
            FROM eval_runs WHERE id = %s AND org_id = %s AND project_id = %s
            """,
            (run_id, tenant.org_id, tenant.project_id),
        )
        run = cur.fetchone()
        if not run:
            raise HTTPException(status_code=404, detail="run not found")
        cur.execute(
            "SELECT idx, input, expected, actual, passed, scores FROM eval_results WHERE run_id = %s ORDER BY idx ASC",
            (run_id,),
        )
        items = cur.fetchall()
    return {"run": run, "items": items}


@router.get("/v1/evaluations")
def list_runs(dataset_id: Optional[str] = None, tenant: Tenant = Depends(require_tenant)):
    with storage.cursor() as cur:
        if dataset_id:
            cur.execute(
                """
                SELECT id::text, dataset_id::text, score, item_count, passed, regression, per_scorer, created_at
                FROM eval_runs WHERE org_id = %s AND project_id = %s AND dataset_id = %s
                ORDER BY created_at DESC LIMIT 100
                """,
                (tenant.org_id, tenant.project_id, dataset_id),
            )
        else:
            cur.execute(
                """
                SELECT id::text, dataset_id::text, score, item_count, passed, regression, per_scorer, created_at
                FROM eval_runs WHERE org_id = %s AND project_id = %s
                ORDER BY created_at DESC LIMIT 100
                """,
                (tenant.org_id, tenant.project_id),
            )
        return {"runs": cur.fetchall()}
