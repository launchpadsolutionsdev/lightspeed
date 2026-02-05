# Lightspeed - AI-Powered Productivity Suite for Nonprofits

## Project Overview
Lightspeed is a SaaS application providing AI-powered tools for nonprofit organizations, specifically charitable gaming service providers. The platform uses Claude AI to help with customer responses, data analysis, content drafting, and list normalization.

**Live URLs:**
- Frontend: https://www.lightspeedutility.ca
- Backend: https://lightspeed-backend.onrender.com

**Repository:** https://github.com/launchpadsolutionsdev/lightspeed

## Tech Stack

### Frontend
- Vanilla JavaScript, HTML, CSS
- Google OAuth 2.0 for authentication
- Hosted as Render Static Site

### Backend
- Node.js / Express.js
- PostgreSQL database
- JWT authentication
- Anthropic Claude API integration
- Hosted on Render Web Service

## Repository Structure
```
lightspeed/
├── frontend/
│   ├── index.html          # Main HTML with all pages
│   ├── app.js              # Main application logic
│   ├── admin-dashboard.js  # Super admin dashboard
│   ├── admin-dashboard.css
│   ├── draft-assistant.js  # Draft tool logic
│   ├── draft-knowledge-base.js
│   └── ...
├── backend/
│   ├── config/
│   │   └── database.js     # PostgreSQL connection
│   ├── src/
│   │   ├── index.js        # Express app entry point
│   │   ├── middleware/
│   │   │   └── auth.js     # JWT & role verification
│   │   ├── routes/
│   │   │   ├── auth.js     # Google OAuth only
│   │   │   ├── admin.js    # Super admin endpoints
│   │   │   ├── billing.js  # Stripe placeholder
│   │   │   ├── knowledgeBase.js
│   │   │   ├── organizations.js
│   │   │   └── tools.js    # AI tool endpoints
│   │   └── services/
│   │       ├── claude.js   # Anthropic API
│   │       └── email.js    # Email service (placeholder)
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── package.json
└── render.yaml             # Render deployment config
```

## Features & Tools

### 1. Response Assistant
- Generate AI-powered customer responses
- Integrates with knowledge base for context
- Multiple tones and formats (email, Facebook)
- Endpoint: `POST /api/generate`

### 2. Insights Engine
- Analyze uploaded CSV data
- Report types: customer purchases, sellers, payment tickets
- Endpoint: `POST /api/analyze`

### 3. List Normalizer
- Clean and format unstructured list data
- Custom output formats
- Endpoint: `POST /api/normalize`

### 4. Draft Assistant
- Generate social media posts, emails, website content
- Brand voice integration
- Endpoint: `POST /api/draft`

### 5. Knowledge Base
- CRUD for organization knowledge entries
- Categories: products, policies, faqs, other
- Search and tagging
- Endpoints: `/api/knowledge-base/*`

### 6. Team Management
- Invite members via shareable links (email not configured)
- Roles: owner, admin, member
- Endpoints: `/api/organizations/*`

### 7. Admin Dashboard (Super Admin Only)
- Platform-wide analytics
- User and organization management
- Endpoints: `/api/admin/*`

## Authentication
- **Google OAuth only** - email/password auth was removed
- New users auto-register on first Google sign-in
- JWT tokens with 7-day expiry
- Invite links work via `?invite=token` URL parameter

## Pricing (Updated)
- Monthly: **$499/month**
- Annual: **$449/month** ($5,388/year) - 10% discount
- No usage limits currently enforced (beta period)

## Database Schema (PostgreSQL)
Key tables:
- `users` - User accounts (Google OAuth)
- `organizations` - Teams/companies
- `organization_memberships` - User-org relationships with roles
- `organization_invitations` - Pending invites
- `usage_logs` - Tool usage tracking
- `knowledge_base` - Organization knowledge entries
- `response_templates` - Saved templates
- `response_history` - Past responses

## Environment Variables (Backend)
```
DATABASE_URL=postgresql://...
JWT_SECRET=...
ANTHROPIC_API_KEY=...
GOOGLE_CLIENT_ID=...
FRONTEND_URL=https://www.lightspeedutility.ca
```

## Deployment

### Git Workflow
Work on branch: `claude/migrate-lightspeed-project-CIxUz`

To deploy changes:
1. Commit changes to the feature branch
2. Push to origin
3. Merge PR via GitHub web interface:
   - Go to https://github.com/launchpadsolutionsdev/lightspeed/pulls
   - Create PR from feature branch to main
   - Merge
4. Render auto-deploys on merge to main

### Render Services
- **lightspeed** - Frontend static site
- **lightspeed-backend** - Backend web service
- **lightspeed-db** - PostgreSQL database

## Recent Changes (This Session)
1. Updated pricing to $499/month with 10% annual discount
2. Fixed admin dashboard (missing fields, null safety)
3. Fixed admin button navigation (mainApp visibility)
4. Removed email/password authentication - Google OAuth only
5. Simplified login page UI

## Known Issues / TODOs
- Email sending not configured (SMTP) - invite links must be shared manually
- Billing/Stripe not implemented (placeholder routes)
- Password reset removed (was never fully implemented)
- Email verification not implemented

## Key API Endpoints

### Auth
- `POST /api/auth/google` - Google OAuth login/signup
- `GET /api/auth/me` - Get current user
- `POST /api/auth/create-organization` - Create org for new user

### Tools
- `POST /api/generate` - Response Assistant
- `POST /api/analyze` - Insights Engine
- `POST /api/normalize` - List Normalizer
- `POST /api/draft` - Draft Assistant

### Admin (Super Admin Only)
- `GET /api/admin/dashboard` - Main dashboard metrics
- `GET /api/admin/analytics/engagement` - Engagement analytics

## Testing Checklist for Demo
- [ ] Google sign-in works
- [ ] All 4 tools generate responses
- [ ] Knowledge base CRUD works
- [ ] Team invite link modal appears
- [ ] Admin dashboard loads (if super admin)
- [ ] Pricing shows $499/$449

## Contact
- Support email: hello@launchpadsolutions.ca
