# API Quality Score Service

A Node.js + Express + TypeScript service that computes an **API quality score** for a Postman collection in the **v3 collection format**. Send a collection as JSON or YAML and get back a detailed quality report with an overall score, a letter grade, per-category scores, findings, and top recommendations.

## Scoring model

The overall score (0–100) is a weighted average of six categories:

| Category | Weight | What it measures |
| --- | --- | --- |
| Endpoint Structure & Naming | 15% | Well-named requests, valid methods/URLs, RESTful path style, folder depth. |
| Parameter & Description Annotations | 15% | Descriptions on endpoints, headers, query params, path vars, body fields. |
| Authentication & Security | 20% | Auth coverage, hardcoded credentials, HTTPS usage, collection-level auth. |
| Best Practices | 20% | Collection variables, `{{baseUrl}}` usage, saved examples, `Content-Type` headers, collection info. |
| Tests & Coverage | 20% | Presence of tests, status assertions, multiple assertions, collection-level tests. |
| Documentation Depth | 10% | Collection description, per-endpoint description coverage and depth. |

Grade bands: **A** ≥ 90, **B** ≥ 75, **C** ≥ 60, **D** ≥ 40, **F** below.

## Endpoints

All endpoints are **public** (no auth required).

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Service info and endpoint listing. |
| `GET` | `/health` | Health probe. |
| `GET` | `/score/categories` | Metadata about categories, weights, and grade bands. |
| `POST` | `/score` | Full quality report for a v3 collection. |
| `POST` | `/score/summary` | Compact summary (overall + per-category scores). |

### Accepted request bodies for `/score` and `/score/summary`

1. **Raw JSON collection** — `Content-Type: application/json`, body is the v3 collection object.
2. **Raw YAML collection** — `Content-Type: application/x-yaml` (or `text/yaml`), body is the YAML text.
3. **Wrapped** — `Content-Type: application/json` with:
   ```json
   { "collection": "<raw string>", "format": "json" | "yaml" | "auto" }
   ```
   or `{ "collection": { ...object... } }`.

## Install and run

```bash
cd service
npm install
npm run dev     # hot-reload on http://localhost:3000
# or
npm run build && npm start
```

## Example

```bash
curl -X POST http://localhost:3000/score \
  -H 'Content-Type: application/json' \
  --data-binary @my-collection.json
```

Response shape:

```json
{
  "inputFormat": "json",
  "report": {
    "schema": "v3",
    "collectionName": "My API",
    "overallScore": 78,
    "grade": "B",
    "summary": { "endpoints": 12, "folders": 3, "totalFindings": 9, "errorFindings": 0, "warnFindings": 4 },
    "categories": [ { "id": "endpoint_structure", "label": "...", "weight": 0.15, "score": 85, "findings": [...], "metrics": {...} } ],
    "topRecommendations": [ "Tests & Coverage (55/100): No tests defined" ]
  }
}
```

## Project layout

```
service/
├── src/
│   ├── index.ts              # Express app bootstrap
│   ├── routes/score.ts       # /score, /score/summary, /score/categories
│   ├── parser/parseCollection.ts  # JSON/YAML parsing + endpoint flattening
│   ├── scoring/
│   │   ├── categories.ts     # Individual category scorers
│   │   └── engine.ts         # Weighted aggregation + report
│   ├── types/collection.ts   # v3 collection TypeScript types
│   └── utils/text.ts         # small helpers
├── package.json
├── tsconfig.json
└── README.md
```
