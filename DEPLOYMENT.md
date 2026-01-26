# Lightspeed Deployment Guide

This guide walks you through deploying Lightspeed to Render (recommended) so it's accessible online.

## Overview

Lightspeed has two parts:
1. **Frontend** (Static Site) - The user interface
2. **Backend** (Node.js API) - Securely handles Claude API calls

Both can be deployed for free on Render's free tier.

---

## Prerequisites

1. A [Render account](https://render.com) (free)
2. A [GitHub account](https://github.com) (free)
3. Your [Anthropic API key](https://console.anthropic.com/) (from your Claude account)

---

## Step 1: Push Code to GitHub

First, create a GitHub repository and push your code:

```bash
# Navigate to your project folder
cd lottery-response-tool

# Initialize git (if not already)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Lightspeed by Launchpad"

# Add your GitHub repo as remote (replace with your repo URL)
git remote add origin https://github.com/YOUR_USERNAME/lightspeed.git

# Push to GitHub
git push -u origin main
```

---

## Step 2: Deploy the Backend API

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure the service:
   - **Name**: `lightspeed-api`
   - **Root Directory**: `server`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free

5. Add Environment Variables (click "Advanced"):
   - `ANTHROPIC_API_KEY` = your Claude API key (sk-ant-api-...)
   - `NODE_ENV` = `production`

6. Click **"Create Web Service"**

7. Wait for deployment (2-3 minutes)

8. **Copy your backend URL** - it will look like: `https://lightspeed-api.onrender.com`

---

## Step 3: Update Frontend with Backend URL

Before deploying the frontend, update the API URL in `app.js`:

Open `app.js` and find this line near the top:

```javascript
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://your-backend-url.onrender.com';  // UPDATE THIS!
```

Replace `https://your-backend-url.onrender.com` with your actual backend URL from Step 2.

Commit and push this change:

```bash
git add app.js
git commit -m "Update API URL for production"
git push
```

---

## Step 4: Deploy the Frontend

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Static Site"**
3. Connect the same GitHub repository
4. Configure:
   - **Name**: `lightspeed` (or any name you want)
   - **Root Directory**: Leave empty (uses repo root)
   - **Build Command**: Leave empty
   - **Publish Directory**: `.` (just a dot)

5. Click **"Create Static Site"**

6. Wait for deployment (1-2 minutes)

7. **Copy your frontend URL** - it will look like: `https://lightspeed.onrender.com`

---

## Step 5: Configure CORS

Go back to your backend service in Render:

1. Click on **lightspeed-api**
2. Go to **Environment**
3. Add a new variable:
   - `FRONTEND_URL` = your frontend URL (e.g., `https://lightspeed.onrender.com`)
4. Click **Save Changes** (this will redeploy automatically)

---

## Step 6: Test Your Deployment

1. Open your frontend URL in a browser
2. Register a new account
3. Try generating a response
4. If it works, you're done! 🎉

---

## Custom Domain (Optional)

To use your own domain (e.g., lightspeed.yourcompany.com):

1. In Render, go to your static site settings
2. Click **Custom Domains**
3. Add your domain
4. Update your DNS records as instructed

---

## Troubleshooting

### "API request failed" error
- Check that your ANTHROPIC_API_KEY is set correctly in the backend
- Verify the API_BASE_URL in app.js matches your backend URL
- Check browser console for CORS errors

### CORS errors
- Make sure FRONTEND_URL is set correctly in your backend environment
- The URL should NOT have a trailing slash

### Backend shows "sleeping"
- Render's free tier sleeps after 15 minutes of inactivity
- First request after sleeping takes ~30 seconds
- Consider upgrading to a paid plan ($7/month) for always-on service

### Changes not showing
- Render auto-deploys when you push to GitHub
- Wait 2-3 minutes for deployment to complete
- Try clearing your browser cache

---

## Costs

**Free Tier Limitations:**
- Backend sleeps after 15 min of inactivity (30s cold start)
- 750 hours/month total (shared across all free services)
- Good for testing and light usage

**Paid Plans:**
- Backend: $7/month (always-on, faster)
- Static Site: Free (no limitations)

**API Costs:**
- Claude API: ~$3 per 1M input tokens, ~$15 per 1M output tokens
- Typical response: ~$0.01-0.02
- 1000 responses ≈ $10-20

---

## Support

For issues or questions, contact: info@launchpadsolutions.ca
