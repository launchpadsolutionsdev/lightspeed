# Lightspeed by Launchpad Solutions

A powerful AI-powered customer support tool for hospital lotteries and charitable gaming organizations. Built to help your staff respond to customer inquiries quickly and consistently.

## Features

### Core Response Generator
- **Paste & Generate**: Staff paste customer emails and get AI-powered response suggestions
- **Auto-Detection**: Automatically detects which lottery type (50/50 or Catch the Ace) the inquiry relates to
- **Tone & Style Controls**: Adjust responses from formal to friendly, brief to detailed
- **Quality Checks**: Validates responses include greetings, thank you's, and appropriate length
- **Smart Suggestions**: Quick-fill buttons for common inquiry types

### Knowledge Base
- **Generic Templates**: Works with any AGCO-licensed hospital lottery
- **Placeholder System**: Uses `[ORGANIZATION]`, `[WEBSITE]`, `[ACCOUNT_URL]` placeholders
- **50+ Pre-built FAQs**: Covering tickets, subscriptions, payments, technical issues, and more
- **Custom Entries**: Add your own organization-specific knowledge
- **Import Feature**: Paste documents to auto-parse Q&A pairs

### Analytics & History
- **Response History**: Track all generated responses
- **Rating System**: Thumbs up/down feedback for continuous improvement
- **Favorites**: Save and reuse great responses
- **Analytics Dashboard**: Track response volumes, categories, and ratings

### Bulk Processing
- **CSV Upload**: Process up to 50 inquiries at once
- **Export Results**: Download all responses as CSV
- **Progress Tracking**: Real-time progress bar

## Quick Start

### Option 1: Run Locally (Simplest)

1. Open the `index.html` file in your web browser
2. Click the ⚙️ settings button
3. Enter your Claude API key (get one at https://console.anthropic.com/)
4. Start pasting customer inquiries!

**Note**: Due to browser security (CORS), running locally requires the API key to have browser access enabled. This works for testing but isn't recommended for production.

### Option 2: Deploy with a Simple Server

For production use, you'll want to run this through a local server:

```bash
# Using Python 3
cd lottery-response-tool
python -m http.server 8000

# Then open http://localhost:8000 in your browser
```

## Placeholder System

The knowledge base uses placeholders that staff can mentally replace or that can be configured for auto-replacement:

| Placeholder | Description | Example |
|-------------|-------------|---------|
| `[ORGANIZATION]` | Charity/foundation name | "Thunder Bay Regional Health Sciences Foundation" |
| `[WEBSITE]` | Main lottery website | "thunderbay5050.ca" |
| `[ACCOUNT_URL]` | Account management portal | "account.tbay5050draw.ca" |
| `[DRAW_DAY]` | Day of weekly/monthly draws | "Friday" |
| `[DRAW_TIME]` | Time of draws | "12:00 PM EST" |

## Lottery Types Supported

### 50/50 Lotteries
- Monthly draw periods
- Tickets valid for one draw only
- Winner takes 50% of the pot

### Catch the Ace (Progressive Jackpot)
- Weekly draws
- Progressive jackpot until Ace of Spades found
- Weekly winners even if Ace not found

## Customizing the Knowledge Base

The FAQ templates are stored in `knowledge-base.js`. To add or modify responses:

1. Open `knowledge-base.js` in a text editor
2. Find the appropriate lottery section (`5050` or `cta`)
3. Add or modify entries following this format:

```javascript
{
    id: "unique-id",
    keywords: ["keyword1", "keyword2", "phrase to match"],
    question: "Short description of the question",
    response: `Hi there,

Your response here. Use placeholders like [ORGANIZATION] and [WEBSITE].

Best regards`
}
```

## Files Included

- `index.html` - Main application interface with all features
- `app.js` - Application logic, API integration, and all functionality
- `knowledge-base.js` - Generic FAQ templates with placeholders
- `README.md` - This file

## API Key Setup

1. Go to https://console.anthropic.com/
2. Create an account or sign in
3. Navigate to API Keys
4. Create a new key
5. Copy the key and paste it in the tool's settings

**Cost**: Each response generation uses approximately 1,000-2,000 tokens (~$0.003-0.006 per response with Claude Sonnet).

## SaaS Roadmap

Ready to sell to other hospital lotteries? Here's the roadmap:

- [ ] **Multi-tenant architecture**: Each lottery gets their own login and knowledge base
- [ ] **Backend deployment**: Secure API key handling (no browser exposure)
- [ ] **Admin dashboard**: Upload/manage FAQ documents through a web interface
- [ ] **Usage analytics**: Track response volumes, popular questions, staff performance
- [ ] **Team management**: Add/remove staff members with role-based access
- [ ] **Custom branding**: Each lottery can have their own logo and colors
- [ ] **Billing integration**: Stripe for subscription payments
- [ ] **Email integration**: Connect to Gmail/Outlook for direct responses

## Built By

**Launchpad Solutions** - Lottery consulting and technology for hospital foundations.

## Support

For questions or to expand this tool into a full SaaS product, contact Launchpad Solutions.
