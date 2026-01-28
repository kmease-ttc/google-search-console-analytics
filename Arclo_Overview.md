# ARQLO SYSTEM OVERVIEW

This document describes **what ARQLO is, how it works, and how all services fit together**.
Attach this file to every ARQLO repo so humans and AI agents share the same mental model.

---

## What ARQLO Is

ARQLO is an **autonomous search performance system**.

Its job is to:
- Observe what is happening across SEO, content, and traffic
- Diagnose *why* performance changes occur
- Decide what to do next
- Execute safely through specialized workers
- Learn from outcomes so future actions improve

ARQLO is not a dashboard.
ARQLO is not a single app.
ARQLO is a **coordinated system of agents**.

---

## Core Principles

1. Hermes orchestrates, workers execute
2. No direct service-to-service calls
3. Postgres is the system backbone
4. Everything is observable
5. Learning compounds over time
6. Safety before automation

---

## High-Level Architecture

Hermes (Brain / Orchestrator)
        |
        v
Postgres (Job Queue + Knowledge Base)
        |
        v
Specialized Workers (SEO, SERP, Content, Ads, etc.)

All coordination happens through the database.

---

## Core Components

### 1. Hermes (Orchestrator)
Hermes is the brain of ARQLO.

Responsibilities:
- Decide which jobs to run
- Enqueue jobs into the job queue
- Optionally wait for completion
- Read worker outputs from the Knowledge Base
- Combine signals into explanations and plans

Hermes does NOT:
- Perform SEO analysis
- Crawl sites
- Write content
- Talk directly to other services

---

### 2. Knowledge Base (KBase)
The Knowledge Base is ARQLO's **memory and truth layer**.

It stores:
- Worker results
- Action logs
- Outcome snapshots (GA4, rankings)
- Incidents and regressions
- Learned patterns (articles)

The KBase:
- Owns the Postgres database
- Exposes no public web API by default
- Is written to by workers
- Is read by Hermes and other workers

---

### 3. Job Queue (Inside Postgres)
The job queue is how services communicate.

Jobs include:
- job_id
- run_id
- website_id
- service
- action
- params
- status

Workers:
- Poll the queue
- Claim jobs
- Execute
- Mark jobs success or failure

Hermes:
- Enqueues jobs
- Optionally waits for completion

---

### 4. Workers (Execution Agents)
Each worker:
- Has a single responsibility
- Runs as a background process
- Polls the job queue
- Writes structured results to the Knowledge Base

Examples:
- Technical SEO worker
- SERP & keyword intelligence worker
- Competitive intelligence worker
- Content generation worker
- Google Ads worker
- Notification worker

Workers never call each other.

---

## Data Flow

1. Hermes detects a need
2. Hermes enqueues jobs
3. Workers execute independently
4. Workers write results to the Knowledge Base
5. Hermes reads results and decides next steps
6. Outcomes are later compared to actions for learning

---

## Learning System (Ralph Wiggum)

ARQLO includes a learning layer that:
- Logs every agent action
- Captures outcomes from GA4 and rankings
- Correlates actions to outcomes
- Detects breakage and regressions
- Promotes high-confidence patterns into Knowledge Base Articles

Knowledge Base Articles:
- Describe what works and what fails
- Include guardrails and risk levels
- Are consulted by agents before acting
- Improve system behavior over time

---

## Safety Model

ARQLO prioritizes safety by:
- Separating decision-making from execution
- Using retries and backoff
- Detecting regressions
- Allowing observe-only modes
- Requiring confidence before automation

---

## What ARQLO Is Not

ARQLO is not:
- A monolithic app
- A traditional CMS
- A cron-only automation tool
- A black-box AI

It is a transparent, inspectable system.

---

## Repo Responsibilities

Each repo:
- Has a clearly defined role
- Contains a REPO_CONTEXT.md
- Must not exceed its scope
- Communicates only via Postgres

---

## How AI Agents Should Use This

When working in any ARQLO repo:
1. Read this document
2. Read REPO_CONTEXT.md
3. Stay within repo responsibilities
4. Use shared schemas from arclo-contracts
5. Do not invent cross-service calls

---

## Summary

ARQLO:
- Observes
- Explains
- Decides
- Acts
- Learns

Everything else is an implementation detail.

---

_Last updated: SYSTEM_