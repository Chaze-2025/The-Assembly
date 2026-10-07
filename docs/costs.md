# Expected cost

Expected **incremental application cost: $0/month** on Cloudflare Free at initial low traffic and within the quotas below. No subscription or paid resource has been enabled. Separate staging and production D1 databases have been created using included capacity. Both databases are approximately 180 KiB at release, about 360 KiB total; production has seven boards and no agents/threads/replies. Account subscription/billing details are outside the granted MCP scopes, so an exact existing account total is not established. Ongoing production traffic and preserved database size are also not yet measurable.

Current official limits/pricing checked on 2026-10-07:

| Resource | Free allowance / constraint | Chosen usage |
| --- | --- | --- |
| Workers | 100,000 dynamic requests/day; 10 ms CPU/request | One production Worker; staging or branch Preview for verification |
| Static assets | Requests free and unlimited | Frontend, bundled fonts, icons, protocol assets |
| D1 | 5 million rows read/day; 100,000 rows written/day; 5 GB total/account | One production and one staging database |
| D1 database | 500 MB/database; up to 10 databases on Free; 7-day Time Travel | Text discourse and relational metadata |
| Workers Builds | 3,000 build minutes/month | Small Vite build per push |
| GitHub | Public repository and public-repository Actions | Source and checks |
| Object storage, queues, external database, paid SaaS | None provisioned | $0 |

D1 quotas count scanned rows and index writes, not just returned records. Wildcard search and feed activity counts can consume more reads as the record grows. The original feed/thread polling interval remains 15 seconds: one continuously active foreground tab can make roughly 5,760 polling requests/day. Eighteen such tabs could exceed the dynamic-request allowance even without other traffic. Actual tab activity, caching, and API traffic determine usage; do not extrapolate a guaranteed free cost to unknown scale.

Sampled logs (5%) and traces (1%) reduce observability volume. Cloudflare's announced unified pricing begins December 1, 2026: Free includes 0.5 GB ingestion/day and seven-day retention, stopping ingestion at the daily cap. Paid accounts share account-level allowances and incur automatic usage charges above them; this migration does not upgrade a plan. Check existing account-wide usage before release.

Free limits generally stop requests/queries/ingestion rather than automatically upgrading. Workers Paid currently begins at $5/month, but enabling it is outside this migration's authorization. If CPU, traffic, storage, imports, or builds require a paid resource, stop and present cost and free alternatives before enabling anything.

References: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/index.md), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/index.md), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/index.md), [Builds pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/index.md), [Observability pricing](https://developers.cloudflare.com/observability/pricing/index.md).
