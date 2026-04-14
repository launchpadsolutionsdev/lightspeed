# Lightspeed Utility

AI-powered productivity suite for hospital lotteries and charitable gaming organizations. Helps staff respond to customer inquiries, analyze data, draft content, and normalize lists — faster and more consistently.

## Architecture

- **Frontend**: Vanilla JavaScript SPA hosted as a static site on Render
- **Backend**: Node.js / Express REST API on Render
- **Database**: PostgreSQL (Render managed)
- **AI**: Anthropic Claude API
- **Auth**: Google OAuth + Microsoft OAuth (MSAL.js)
- **Billing**: Stripe (subscriptions + checkout)

## Features

| Tool | Description |
|------|-------------|
| **Response Assistant** | Paste customer inquiries, get AI-generated responses with tone/length controls |
| **Draft Assistant** | Generate social posts, emails, ads, and general content |
| **Insights Engine** | Upload Excel data for automated analysis and visualizations |
| **Data Agent** | Clean and deduplicate customer/seller lists |
| **Ask Lightspeed** | General-purpose AI assistant for quick questions |

### Platform Features
- **Multi-tenant**: Each organization gets isolated data, knowledge base, and settings
- **Team Management**: Invite members, assign roles (owner/admin/member)
- **Knowledge Base**: 50+ pre-built FAQs + custom entries + document import
- **Analytics Dashboard**: Track response volumes, categories, ratings, and team leaderboard
- **Agent Instructions**: Staff can guide AI responses with contextual instructions
- **Billing**: Stripe integration with 14-day free trial, monthly/annual plans

## Setup

### Prerequisites
- Node.js 22+
- PostgreSQL database
- Anthropic API key
- Google OAuth client ID
- Microsoft Azure app registration (required — app fails to boot without `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET`)

### Backend

```bash
cd backend
cp .env.example .env
# Fill in your environment variables
npm install
npm start
```

The server runs migrations automatically on startup.

### Frontend

Serve the `frontend/` directory as a static site. For local development:

```bash
cd frontend
python -m http.server 8000
```

### Environment Variables

See `backend/.env.example` for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for signing auth tokens |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `MICROSOFT_CLIENT_ID` | Yes | Azure app client ID (app fails to boot without this) |
| `MICROSOFT_CLIENT_SECRET` | Yes | Azure app client secret (app fails to boot without this) |
| `FRONTEND_URL` | Yes | Frontend URL for CORS and invite links |
| `ENCRYPTION_KEY` | Yes | 32-byte base64 or hex key for encrypting Shopify tokens at rest. Generate: `openssl rand -base64 32`. Treat as permanent. |
| `SUPER_ADMINS` | No | Comma-separated list of emails to grant `is_super_admin` at startup (additive only, never demotes) |
| `SEED_TBRHSF` | No | Set to `true` to load TBRHSF-specific profile / content / KB seed at startup |
| `VOYAGE_API_KEY` | No | Voyage AI API key for KB semantic search embeddings |
| `STRIPE_SECRET_KEY` | No | Stripe API key for billing (required if billing is active) |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret (required if billing is active) |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` | No | Stripe price IDs (required if billing is active) |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | No | Shopify Partner app credentials (required if Shopify is connected) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | No | Email configuration for invites and contact form |
| `FROM_EMAIL` / `FROM_NAME` / `CONTACT_EMAIL` | No | Email sender identity and contact form recipient |
| `BACKEND_URL` | No | Backend URL used in webhook registration and invite links |
| `DASHBOARD_FEED_URL` | No | Optional fallback feed URL for the BUMP dashboard |

## Deployment

Both frontend and backend are configured for Render via `render.yaml` and `frontend/render-static.yaml`. See `DEPLOYMENT.md` for detailed instructions.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Built By

**Lightspeed Utility** — Lottery consulting and technology for hospital foundations.
