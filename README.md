# Lightspeed by Launchpad Solutions

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
| **List Normalizer** | Clean and deduplicate customer/seller lists |
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
- Node.js 18+
- PostgreSQL database
- Anthropic API key
- Google OAuth client ID
- Microsoft Azure app registration (optional)

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
| `MICROSOFT_CLIENT_ID` | No | Azure app client ID |
| `MICROSOFT_CLIENT_SECRET` | No | Azure app client secret |
| `STRIPE_SECRET_KEY` | No | Stripe API key for billing |
| `FRONTEND_URL` | Yes | Frontend URL for CORS and invite links |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | No | Email configuration for invites and contact form |

## Deployment

Both frontend and backend are configured for Render via `render.yaml` and `frontend/render-static.yaml`. See `DEPLOYMENT.md` for detailed instructions.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Built By

**Launchpad Solutions** — Lottery consulting and technology for hospital foundations.
