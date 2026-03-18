# Lightspeed Deployment Reference

Internal reference for the Lightspeed platform infrastructure.

## Architecture

| Component | Service | Plan |
|-----------|---------|------|
| **Frontend** | Render Static Site | Free |
| **Backend** | Render Web Service | Standard (1 CPU, 2GB RAM) |
| **Database** | Render Managed PostgreSQL | Standard |

**URLs:**
- Frontend: `https://www.lightspeedutility.ca`
- Backend: `https://lightspeed-backend.onrender.com`

## External Services

| Service | Purpose | Key Env Var |
|---------|---------|-------------|
| Anthropic Claude | AI responses, relevance picking, voice fingerprints | `ANTHROPIC_API_KEY` |
| Voyage AI | Semantic search embeddings (voyage-3-lite, 512 dims) | `VOYAGE_API_KEY` |
| Stripe | Billing, subscriptions, checkout | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| Shopify Admin API | Store data, orders, analytics (GraphQL + ShopifyQL) | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` |
| Google OAuth | User authentication | `GOOGLE_CLIENT_ID` |
| Microsoft OAuth | User authentication | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| Gmail SMTP | Invitations, welcome emails, digests, password resets | `SMTP_USER`, `SMTP_PASS` |

## Environment Variables

### Required

```
DATABASE_URL=              # Render PostgreSQL connection string
ANTHROPIC_API_KEY=         # sk-ant-api-...
JWT_SECRET=                # Random secret for signing JWTs
GOOGLE_CLIENT_ID=          # Google OAuth client ID
NODE_ENV=production
FRONTEND_URL=https://www.lightspeedutility.ca
BACKEND_URL=https://lightspeed-backend.onrender.com
```

### Billing (Stripe)

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_MONTHLY=     # Stripe price ID for monthly plan
STRIPE_PRICE_ANNUAL=       # Stripe price ID for annual plan
```

### Shopify

```
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
```

### Email (Gmail SMTP)

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=                 # Gmail address
SMTP_PASS=                 # Gmail App Password (not regular password)
FROM_EMAIL=
FROM_NAME=Lightspeed
CONTACT_EMAIL=hello@launchpadsolutions.ca
```

### Optional

```
VOYAGE_API_KEY=            # Voyage AI embeddings (semantic search)
MICROSOFT_CLIENT_ID=       # Microsoft/Azure AD OAuth
MICROSOFT_CLIENT_SECRET=
ANTHROPIC_MODEL=           # Default: claude-sonnet-4-6
JWT_EXPIRES_IN=            # Default: 7d
LOG_LEVEL=                 # Default: info (debug, info, warn, error)
TRIAL_DAYS=                # Default: 14
TRIAL_USAGE_LIMIT=         # Default: 300
ACTIVE_USAGE_LIMIT=        # Default: 500
AI_RATE_LIMIT_PER_MINUTE=  # Default: 10
DASHBOARD_FEED_URL=        # External feed API URL
```

## Scheduled Tasks

These run in-process via `setInterval` (no external cron or queue):

| Task | Interval | Description |
|------|----------|-------------|
| Shopify analytics sync | 15 min | Incremental sync for all connected stores |
| Calendar reminders | 60 sec | Check and send upcoming event reminders |
| Home Base scheduled posts | 60 sec | Publish posts scheduled for the current time |
| Home Base digest emails | 1 hour | Send digest emails to subscribed users |
| Cache cleanup | 60 sec | Evict expired in-memory cache entries |

## Deployment

Render auto-deploys when code is pushed to the `main` branch on GitHub.

**Backend:**
- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`

**Frontend:**
- Root directory: `frontend`
- Publish directory: `.`
- No build step

**Database:**
- Migrations run automatically on server startup from `backend/migrations/`

## Troubleshooting

**Backend not responding:**
- Check Render dashboard for deploy errors
- Check `/health` endpoint (verifies DB + Anthropic API connectivity)

**CORS errors:**
- Verify `FRONTEND_URL` matches the exact frontend domain (no trailing slash)

**Shopify sync failing:**
- Check that `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are set
- Check store's OAuth scopes include: read_products, read_orders, read_customers, read_inventory, read_reports, read_analytics

**Emails not sending:**
- Gmail requires an App Password (not the account password)
- Verify `SMTP_USER` and `SMTP_PASS` are set correctly

## Support

info@launchpadsolutions.ca
