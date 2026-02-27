// Lightspeed by Launchpad Solutions v3.0
// Multi-Tool Platform with Customer Response & Data Analysis

// ==================== DOMAIN REDIRECT ====================
// Ensure consistent domain to prevent localStorage issues
// Redirect www to non-www for consistent localStorage
if (window.location.hostname === 'www.lightspeedutility.ca') {
    window.location.href = window.location.href.replace('www.lightspeedutility.ca', 'lightspeedutility.ca');
}

// ==================== API CONFIGURATION ====================
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'  // Local development
    : 'https://lightspeed-backend.onrender.com';  // Production

// ==================== API HELPER FUNCTIONS ====================
function getAuthHeaders() {
    const token = localStorage.getItem('authToken');
    const headers = {
        'Content-Type': 'application/json'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

async function handleApiError(response) {
    const error = await response.json().catch(() => ({}));

    // Handle specific error codes
    if (error.code === 'TRIAL_EXPIRED') {
        showUpgradeModal('expired');
        throw new Error('TRIAL_EXPIRED');
    }
    if (error.code === 'AUTH_REQUIRED') {
        showToast('Please sign in to continue', 'error');
        handleLogout();
        throw new Error('AUTH_REQUIRED');
    }

    throw new Error(error.error || error.message || 'API request failed. Please try again.');
}

// ==================== STREAMING API HELPER ====================
/**
 * Stream a response from /api/generate-stream via SSE.
 *
 * @param {Object} body   - Request body (same shape as /api/generate)
 * @param {Object} opts
 * @param {Function} opts.onText  - Called with each text chunk (string)
 * @param {Function} [opts.onKb]  - Called with referenced KB entries array
 * @param {Function} [opts.onDone]- Called when stream finishes, receives {usage}
 * @param {Function} [opts.onError]- Called on error with error message string
 * @returns {Promise<{text: string, referencedKbEntries: Array}>} Full text + KB entries
 */
async function fetchStream(body, { onText, onKb, onDone, onError } = {}) {
    const response = await fetch(`${API_BASE_URL}/api/generate-stream`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        // Fall back to handleApiError for trial/auth errors
        await handleApiError(response);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let referencedKbEntries = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
                const event = JSON.parse(line.slice(6));
                if (event.type === 'delta' && event.text) {
                    fullText += event.text;
                    if (onText) onText(event.text);
                } else if (event.type === 'kb' && event.entries) {
                    referencedKbEntries = event.entries;
                    if (onKb) onKb(event.entries);
                } else if (event.type === 'done') {
                    if (onDone) onDone(event);
                } else if (event.type === 'error') {
                    if (onError) onError(event.error);
                    throw new Error(event.error);
                }
            } catch (e) {
                if (e.message && !e.message.startsWith('{')) throw e;
            }
        }
    }

    return { text: fullText, referencedKbEntries };
}

// ==================== STRIPE CHECKOUT ====================
async function startCheckout(plan) {
    if (!currentUser) {
        // Not logged in — save plan choice and send to login
        localStorage.setItem('selectedPlan', plan);
        document.getElementById('landingPage').classList.add('hidden');
        showLoginPage();
        return;
    }

    try {
        showToast('Redirecting to checkout...', 'info');
        const response = await fetch(`${API_BASE_URL}/api/billing/create-checkout-session`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ plan })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            showToast(err.error || 'Failed to start checkout', 'error');
            return;
        }

        const { url } = await response.json();
        window.location.href = url;
    } catch (error) {
        console.error('Checkout error:', error);
        showToast('Could not connect to billing. Please try again.', 'error');
    }
}

async function openBillingPortal() {
    try {
        showToast('Opening billing portal...', 'info');
        const response = await fetch(`${API_BASE_URL}/api/billing/create-portal-session`, {
            method: 'POST',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            showToast(err.error || 'Failed to open billing portal', 'error');
            return;
        }

        const { url } = await response.json();
        window.location.href = url;
    } catch (error) {
        console.error('Billing portal error:', error);
        showToast('Could not connect to billing. Please try again.', 'error');
    }
}

function checkPostCheckoutMessage() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
        showToast('Subscription activated! Welcome to Lightspeed.', 'success');
        // Clean URL
        history.replaceState(null, '', window.location.pathname);
    } else if (params.get('checkout') === 'cancelled') {
        showToast('Checkout cancelled. You can subscribe anytime from your dashboard.', 'info');
        history.replaceState(null, '', window.location.pathname);
    }
}

function showUpgradeModal(reason) {
    let modal = document.getElementById('upgradeModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'upgradeModal';
        modal.className = 'modal-overlay show';
        modal.innerHTML = `
            <div class="modal-content upgrade-modal">
                <div class="upgrade-header">
                    <div class="upgrade-icon">⚡</div>
                    <h2 id="upgradeTitle">Upgrade to Continue</h2>
                    <p id="upgradeMessage"></p>
                </div>
                <div class="upgrade-features">
                    <div class="upgrade-feature">
                        <span class="feature-icon">✓</span>
                        <span>Unlimited AI generations</span>
                    </div>
                    <div class="upgrade-feature">
                        <span class="feature-icon">✓</span>
                        <span>Custom knowledge base</span>
                    </div>
                    <div class="upgrade-feature">
                        <span class="feature-icon">✓</span>
                        <span>Priority support</span>
                    </div>
                </div>
                <div class="upgrade-pricing">
                    <div class="upgrade-price">$199<span>/month</span></div>
                    <p>or $169/month billed annually (save 15%)</p>
                </div>
                <div class="upgrade-actions">
                    <button class="btn-primary btn-upgrade" onclick="startCheckout('monthly')">
                        Subscribe Monthly — $199/mo
                    </button>
                    <button class="btn-primary btn-upgrade" onclick="startCheckout('annual')" style="background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);">
                        Subscribe Annually — $169/mo
                    </button>
                    <button class="btn-secondary" onclick="document.getElementById('upgradeModal').classList.remove('show')">
                        Maybe Later
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Add styles
        const styles = document.createElement('style');
        styles.textContent = `
            .upgrade-modal {
                max-width: 440px;
                padding: 40px;
                text-align: center;
                background: #fff;
                border-radius: 16px;
            }
            .upgrade-header { margin-bottom: 24px; }
            .upgrade-icon { font-size: 48px; margin-bottom: 16px; }
            .upgrade-header h2 { margin: 0 0 8px; font-size: 24px; color: #1a1a2e; }
            .upgrade-header p { margin: 0; color: #4a5568; font-size: 15px; line-height: 1.5; }
            .upgrade-features {
                background: #f8fafc;
                border-radius: 12px;
                padding: 20px;
                margin-bottom: 24px;
                text-align: left;
            }
            .upgrade-feature {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 8px 0;
                color: #2d3748;
            }
            .feature-icon {
                color: #48bb78;
                font-weight: bold;
                font-size: 18px;
            }
            .upgrade-pricing { margin-bottom: 24px; }
            .upgrade-price {
                font-size: 36px;
                font-weight: 700;
                color: #0A2540;
            }
            .upgrade-price span { font-size: 16px; font-weight: 400; color: #718096; }
            .upgrade-pricing p { margin: 8px 0 0; color: #718096; font-size: 14px; }
            .upgrade-actions { display: flex; flex-direction: column; gap: 12px; }
            .btn-upgrade {
                background: linear-gradient(135deg, #E91E8C 0%, #F5A623 100%);
                color: white;
                border: none;
                padding: 16px 24px;
                border-radius: 10px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            }
            .btn-upgrade:hover { transform: translateY(-2px); }
            .btn-secondary {
                background: transparent;
                color: #718096;
                border: none;
                padding: 12px;
                font-size: 14px;
                cursor: pointer;
            }
            .btn-secondary:hover { color: #4a5568; }
        `;
        document.head.appendChild(styles);
    }

    // Update content based on reason
    const title = document.getElementById('upgradeTitle');
    const message = document.getElementById('upgradeMessage');

    if (reason === 'expired') {
        title.textContent = 'Trial Expired';
        message.textContent = 'Your 14-day free trial has ended. Upgrade to continue using Lightspeed.';
    }

    modal.classList.add('show');
}

// ==================== EMPTY STATE HELPER ====================
function emptyStateHtml(icon, title, text, btnLabel, btnAction) {
    const btnHtml = btnLabel ? `<button class="empty-state-btn" onclick="${btnAction}">${btnLabel}</button>` : '';
    return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><p class="empty-state-title">${title}</p><p class="empty-state-text">${text}</p>${btnHtml}</div>`;
}

// ==================== GOOGLE OAUTH CONFIGURATION ====================
const GOOGLE_CLIENT_ID = '538611064946-ij0geilde0q1tq0hlpjep886holcmro5.apps.googleusercontent.com';

// ==================== MICROSOFT OAUTH CONFIGURATION ====================
// Replace with your Azure AD app's client ID after registering at https://portal.azure.com
const MICROSOFT_CLIENT_ID = 'a7e282d3-9f3a-4bca-a72f-f100e498f0d6';
const MICROSOFT_REDIRECT_URI = window.location.origin + '/';

let msalInstance = null;
let msalInitialized = false;
async function getMsalInstance() {
    if (!msalInstance && typeof msal !== 'undefined' && msal.PublicClientApplication) {
        try {
            msalInstance = new msal.PublicClientApplication({
                auth: {
                    clientId: MICROSOFT_CLIENT_ID,
                    authority: 'https://login.microsoftonline.com/common',
                    redirectUri: MICROSOFT_REDIRECT_URI
                },
                cache: {
                    cacheLocation: 'sessionStorage',
                    storeAuthStateInCookie: false
                }
            });
        } catch (e) {
            console.error('MSAL initialization error:', e);
            return null;
        }
    }
    if (msalInstance && !msalInitialized) {
        try {
            await msalInstance.initialize();
            msalInitialized = true;
        } catch (e) {
            console.error('MSAL initialization error:', e);
            return null;
        }
    }
    return msalInstance;
}

// ==================== AUTH STATE ====================
let currentUser = null;
let users = [];

// Load users from localStorage with error handling
try {
    const storedUsers = localStorage.getItem("lightspeed_users");
    if (storedUsers) {
        users = JSON.parse(storedUsers);
    }
} catch (e) {
    console.error("Failed to load users from localStorage:", e);
    users = [];
}

// ==================== APP STATE ====================
let currentTool = null; // 'customer-response' or 'data-analysis'
let defaultName = "Bella";
let orgName = "";
let responseLanguage = "en";

const LANGUAGE_INSTRUCTIONS = {
    en: '',
    fr: '\nLANGUAGE: You MUST write your entire response in French (Français). The customer inquiry may be in any language, but your response must always be in French.\n',
    es: '\nLANGUAGE: You MUST write your entire response in Spanish (Español). The customer inquiry may be in any language, but your response must always be in Spanish.\n'
};

function getLanguageInstruction() {
    return LANGUAGE_INSTRUCTIONS[responseLanguage] || '';
}
let customKnowledge = [];
let orgDrawSchedule = null; // Active draw schedule from database
let orgContentTemplates = []; // Per-org content templates from database
let feedbackList = [];
let responseHistory = [];
let favorites = [];
let currentResponse = null;
let currentInquiry = null;
let currentReferencedKb = [];
let bulkResults = [];
let currentFilter = "all";
let currentHistoryItem = null;
let currentHistoryId = null;
let inquiryType = "email"; // "email" or "facebook"

// Data Analysis State
let dataAnalysisData = null;
let dataCharts = [];
let currentReportType = null; // 'customer-purchases' or 'customers'

// Report Type Definitions
const REPORT_TYPES = {
    'customer-purchases': {
        name: 'Customer Purchases',
        description: 'Analyze customer purchase data including revenue, transaction amounts, geographic distribution, and top buyers. This report requires columns like email, total spent, city, and phone.',
        uploadTitle: 'Upload Customer Purchases Report',
        uploadSubtitle: 'Export this report from BUMP Raffle with your desired date range'
    },
    'customers': {
        name: 'Customers',
        description: 'Analyze customer demographics and geographic distribution. Shows breakdowns by city, postal code (FSA), and phone area code. This report contains customer info without purchase amounts.',
        uploadTitle: 'Upload Customers Report',
        uploadSubtitle: 'Export this report from BUMP Raffle with your desired date range'
    },
    'payment-tickets': {
        name: 'Payment Tickets',
        description: 'Analyze sales by seller/channel. Shows Shopify (online) vs in-person sales breakdown, with detailed metrics for Foundation Donation Office and Thunder Bay 50/50 Store sellers.',
        uploadTitle: 'Upload Payment Tickets Report',
        uploadSubtitle: 'Export this report from BUMP Raffle with your desired date range'
    },
    'sellers': {
        name: 'Sellers',
        description: 'In-depth breakdown of each seller with payment method analysis (Cash, Credit Card, Debit). Shows net sales, transactions, voided sales, and average order value per seller.',
        uploadTitle: 'Upload Sellers Report',
        uploadSubtitle: 'Export this report from BUMP Raffle with your desired date range'
    },
    'shopify': {
        name: 'Shopify Store Analytics',
        description: 'Pull live data from your connected Shopify store. See revenue trends, top products, order fulfillment status, customer metrics, and AI-generated insights — no file upload required.',
        uploadTitle: 'Pull Shopify Data',
        uploadSubtitle: 'Data will be pulled directly from your connected Shopify store',
        noUpload: true
    }
};

// Smart suggestion templates
const SUGGESTION_TEMPLATES = {
    tickets: "Hi, I purchased tickets but I never received them. Can you help?",
    subscription: "I've been charged for a subscription but I don't remember signing up. What's going on?",
    location: "I'm trying to buy tickets but the website says I'm blocked. I'm in Ontario though!",
    refund: "I accidentally bought the wrong package. Can I get a refund?",
    winner: "How do I know if I won? Do I need to check all my numbers?"
};

// Category detection keywords
const CATEGORY_KEYWORDS = {
    tickets: ["ticket", "tickets", "receive", "resend", "didn't get", "haven't received", "forward"],
    subscription: ["subscription", "subscribed", "monthly", "automatic", "charged every", "cancel"],
    payment: ["charged", "refund", "payment", "credit card", "billing", "price"],
    technical: ["blocked", "location", "can't access", "error", "website", "not working"],
    winners: ["winner", "won", "winning", "draw", "prize", "jackpot"],
    general: []
};

// ==================== INQUIRY TYPE FUNCTIONS ====================
function setInquiryType(type) {
    inquiryType = type;

    // Update toggle buttons
    document.getElementById("toggleEmail").classList.toggle("active", type === "email");
    document.getElementById("toggleFacebook").classList.toggle("active", type === "facebook");

    // Show/hide Facebook hint
    let hint = document.querySelector(".facebook-hint");
    if (!hint) {
        // Create hint element if it doesn't exist
        hint = document.createElement("div");
        hint.className = "facebook-hint";
        hint.textContent = "📝 Facebook responses are kept short (under 400 characters) with a -Name signature.";
        document.querySelector(".inquiry-type-toggle").appendChild(hint);
    }
    hint.classList.toggle("show", type === "facebook");

    // Update generate button text
    const generateBtn = document.getElementById("generateBtn");
    if (type === "facebook") {
        generateBtn.innerHTML = `<span class="btn-icon">⚡</span> Generate Facebook Reply`;
    } else {
        generateBtn.innerHTML = `<span class="btn-icon">⚡</span> Generate Response`;
    }
}

// ==================== DRAW SCHEDULE FUNCTIONS ====================

/**
 * Build AI context string from an org-specific draw schedule (database).
 * Mirrors the format of DRAW_SCHEDULE.getAIContext() so all AI tools get consistent context.
 */
function getOrgDrawScheduleAIContext(schedule) {
    if (!schedule) return '';

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const formatTime = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    };

    let context = `CURRENT DRAW SCHEDULE (${schedule.draw_name}):\n`;
    if (schedule.grand_prize_date) {
        context += `- Grand Prize Draw: ${formatDate(schedule.grand_prize_date)} at ${formatTime(schedule.grand_prize_date)}`;
        if (schedule.prize_description) context += ` (${schedule.prize_description})`;
        else if (schedule.guaranteed_prize) context += ` (${schedule.guaranteed_prize})`;
        context += `\n`;
    }
    if (schedule.ticket_sales_end) {
        context += `- Ticket sales end: ${formatDate(schedule.ticket_sales_end)} at ${formatTime(schedule.ticket_sales_end)}\n`;
    }
    context += '\n';

    const earlyBirds = typeof schedule.early_birds === 'string' ? JSON.parse(schedule.early_birds) : (schedule.early_birds || []);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check for imminent draws
    const imminent = earlyBirds.filter(eb => {
        if (!eb.date) return false;
        const drawDate = new Date(eb.date);
        drawDate.setHours(0, 0, 0, 0);
        const daysUntil = Math.ceil((drawDate - today) / (1000 * 60 * 60 * 24));
        return daysUntil >= 0 && daysUntil <= 1;
    });

    // Also check grand prize
    if (schedule.grand_prize_date) {
        const gpDate = new Date(schedule.grand_prize_date);
        gpDate.setHours(0, 0, 0, 0);
        const gpDaysUntil = Math.ceil((gpDate - today) / (1000 * 60 * 60 * 24));
        if (gpDaysUntil >= 0 && gpDaysUntil <= 1) {
            imminent.push({ type: 'Grand Prize', date: schedule.grand_prize_date, prize: schedule.guaranteed_prize || 'Grand Prize', _daysUntil: gpDaysUntil });
        }
    }

    if (imminent.length > 0) {
        context += `⚠️ IMMINENT DRAWS (mention these if relevant!):\n`;
        for (const draw of imminent) {
            const drawDate = new Date(draw.date);
            drawDate.setHours(0, 0, 0, 0);
            const daysUntil = draw._daysUntil !== undefined ? draw._daysUntil : Math.ceil((drawDate - today) / (1000 * 60 * 60 * 24));
            const label = daysUntil === 0 ? 'TODAY' : 'TOMORROW';
            const type = draw.type || 'Early Bird';
            const num = draw.number ? ` #${draw.number}` : '';
            context += `- ${label}: ${type}${num} - ${draw.prize}!\n`;
        }
        context += '\n';
    }

    // Upcoming early birds
    const upcoming = earlyBirds.filter(eb => {
        if (!eb.date) return false;
        const drawDate = new Date(eb.date);
        drawDate.setHours(0, 0, 0, 0);
        return drawDate >= today;
    }).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 5);

    if (upcoming.length > 0) {
        context += `UPCOMING EARLY BIRD DRAWS:\n`;
        for (const eb of upcoming) {
            const day = eb.day || new Date(eb.date).toLocaleDateString('en-US', { weekday: 'long' });
            const qty = eb.quantity > 1 ? `${eb.quantity} x ` : '';
            context += `- ${day}, ${formatDate(eb.date)}: Early Bird #${eb.number} - ${qty}${eb.prize}\n`;
        }
    }

    // Include pricing if available
    const pricing = typeof schedule.pricing === 'string' ? JSON.parse(schedule.pricing) : (schedule.pricing || []);
    if (pricing.length > 0) {
        context += `\nTICKET PRICING:\n`;
        for (const p of pricing) {
            context += `- ${p.price} = ${p.numbers} numbers\n`;
        }
    }

    return context;
}

/**
 * Get draw schedule AI context — uses org-specific schedule from database only.
 * No hardcoded fallback — each org must configure their own draw schedule.
 */
function getDrawScheduleContext() {
    if (orgDrawSchedule) {
        return getOrgDrawScheduleAIContext(orgDrawSchedule);
    }
    return '';
}

function renderDrawSchedule() {
    const container = document.getElementById("drawScheduleContainer");
    if (!container) return;

    // Prefer org-specific schedule for the display too
    if (orgDrawSchedule) {
        const schedule = orgDrawSchedule;
        const earlyBirds = typeof schedule.early_birds === 'string' ? JSON.parse(schedule.early_birds) : (schedule.early_birds || []);
        let html = `<div class="draw-schedule-content">`;
        html += `<div class="draw-info-header">
            <strong>${schedule.draw_name}</strong>`;
        if (schedule.grand_prize_date) {
            const gpd = new Date(schedule.grand_prize_date);
            html += `<span class="draw-prize-badge">Grand Prize: ${schedule.guaranteed_prize || ''}${schedule.guaranteed_prize ? '+' : ''} on ${gpd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>`;
        }
        html += `</div>`;
        html += `<div class="early-bird-list">`;
        for (const eb of earlyBirds) {
            const isUpcoming = new Date(eb.date) >= new Date();
            const statusClass = isUpcoming ? 'upcoming' : 'passed';
            const day = eb.day || new Date(eb.date).toLocaleDateString('en-US', { weekday: 'long' });
            const dateStr = new Date(eb.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            html += `<div class="early-bird-item ${statusClass}">
                <span class="eb-date">${day}, ${dateStr}</span>
                <span class="eb-prize">${eb.quantity > 1 ? eb.quantity + ' x ' : ''}${eb.prize}</span>
            </div>`;
        }
        html += `</div></div>`;
        container.innerHTML = html;
    } else {
        container.innerHTML = `<div class="response-placeholder">
            <div class="placeholder-icon">📅</div>
            <div class="placeholder-text">No draw schedule configured</div>
            <div class="placeholder-subtext" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px;">
                Upload your Rules of Play document or manually add your draw schedule in Organization Settings.
            </div>
        </div>`;
    }
}

// ==================== INVITE TOKEN HANDLING ====================
function checkForInviteToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const inviteToken = urlParams.get('invite');

    if (inviteToken) {
        // Store the token for processing after login
        localStorage.setItem('pendingInviteToken', inviteToken);
        // Clean up the URL (remove the invite parameter)
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, newUrl);
    }

    return inviteToken;
}

async function processPendingInvite() {
    const pendingToken = localStorage.getItem('pendingInviteToken');

    if (!pendingToken) return;

    const authToken = localStorage.getItem('authToken');
    if (!authToken) {
        return;
    }


    try {
        const response = await fetch(`${API_BASE_URL}/api/organizations/accept-invite`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ token: pendingToken })
        });

        const data = await response.json();

        if (response.ok) {
            // Clear the pending token
            localStorage.removeItem('pendingInviteToken');

            // Update user's organization
            if (currentUser && data.organization) {
                currentUser.organization = data.organization;
                localStorage.setItem("lightspeed_users", JSON.stringify(users));
            }

            showToast(`Successfully joined ${data.organization?.name || 'the organization'}!`, 'success');

            // Refresh team page if on it
            if (document.getElementById('teamsPage')?.classList.contains('active')) {
                loadTeamData();
            }
        } else {
            // Clear invalid token
            localStorage.removeItem('pendingInviteToken');

            if (data.error === 'You are already a member of this organization') {
                showToast('You are already a member of this organization.', 'info');
            } else {
                showToast(data.error || 'Failed to accept invitation', 'error');
            }
        }
    } catch (error) {
        console.error('Error processing invite:', error);
        // Don't clear the token on network error - user can retry
        showToast('Failed to process invitation. Please try again.', 'error');
    }
}

// ==================== INITIALIZATION ====================
function init() {
    // Check for invite token in URL first
    checkForInviteToken();

    // Setup auth event listeners first
    setupAuthEventListeners();

    // Check if user is logged in
    const savedUserId = localStorage.getItem("lightspeed_current_user");

    if (savedUserId) {
        const user = users.find(u => u.id === savedUserId);
        if (user) {
            loginUser(user, false); // false = don't show message
            return;
        } else {
            // User ID exists but user not found - clear stale session
            localStorage.removeItem("lightspeed_current_user");
        }
    }

    // Not logged in — route to the right view
    const path = window._initialPath || window.location.pathname;
    const route = ROUTES[path];
    if (route && (route.view === 'login')) {
        document.getElementById("landingPage").classList.add("hidden");
        showLoginPage();
    } else {
        // Show landing page for non-logged-in users
        document.getElementById("landingPage").classList.remove("hidden");
    }

    // If there's a pending invite, show a message prompting login
    if (localStorage.getItem('pendingInviteToken')) {
        showToast('Please sign in to accept your invitation', 'info');
    }

    // Setup all event listeners
    setupEventListeners();
    setupDataAnalysisListeners();
}

function setupAuthEventListeners() {
    // Landing page CTAs - show login/register
    const launchAppBtns = [
        document.getElementById("navLaunchAppBtn"),
        document.getElementById("heroGetStartedBtn")
    ];

    launchAppBtns.forEach(btn => {
        if (btn) {
            btn.addEventListener("click", () => {
                document.getElementById("landingPage").classList.add("hidden");
                showLoginPage();
            });
        }
    });

    // Demo tab switching
    document.querySelectorAll('.landing-demo-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active tab
            document.querySelectorAll('.landing-demo-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Show corresponding panel
            const demoId = tab.dataset.demo;
            document.querySelectorAll('.landing-demo-panel').forEach(p => p.classList.remove('active'));

            // Update tool description
            document.querySelectorAll('.tool-description-panel').forEach(d => d.classList.remove('active'));
            const descPanel = document.querySelector(`.tool-description-panel[data-tool="${demoId}"]`);
            if (descPanel) descPanel.classList.add('active');

            let activePanel;
            if (demoId === 'draft') {
                activePanel = document.getElementById('demoDraft');
            } else if (demoId === 'response') {
                activePanel = document.getElementById('demoResponse');
            } else if (demoId === 'insights') {
                activePanel = document.getElementById('demoInsights');
            } else if (demoId === 'normalizer') {
                activePanel = document.getElementById('demoNormalizer');
            }
            if (activePanel) {
                activePanel.classList.add('active');
                revealDemoPanel(activePanel);
            }
        });
    });

    // FAQ accordion
    document.querySelectorAll('.landing-faq-question').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.landing-faq-item');
            const wasOpen = item.classList.contains('open');
            // Close all items
            document.querySelectorAll('.landing-faq-item').forEach(i => i.classList.remove('open'));
            // Toggle clicked item
            if (!wasOpen) {
                item.classList.add('open');
            }
        });
    });

    // Contact form submission
    const contactForm = document.getElementById('landingContactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById('contactSubmitBtn');
            const status = document.getElementById('contactFormStatus');
            submitBtn.disabled = true;
            submitBtn.innerHTML = 'Sending... <span>→</span>';
            status.textContent = '';
            status.className = 'contact-form-status';

            try {
                const response = await fetch(API_BASE_URL + '/api/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: document.getElementById('contactName').value.trim(),
                        title: document.getElementById('contactTitle').value.trim(),
                        organizationName: document.getElementById('contactOrg').value.trim(),
                        phone: document.getElementById('contactPhone').value.trim(),
                        email: document.getElementById('contactEmail').value.trim(),
                        message: document.getElementById('contactMessage').value.trim()
                    })
                });

                const data = await response.json();

                if (response.ok) {
                    status.textContent = data.message || 'Message sent! We\'ll be in touch soon.';
                    status.className = 'contact-form-status success';
                    contactForm.reset();
                } else {
                    status.textContent = data.error || 'Something went wrong. Please try again.';
                    status.className = 'contact-form-status error';
                }
            } catch (error) {
                status.textContent = 'Unable to send message. Please email us directly at torin@launchpadsolutions.ca';
                status.className = 'contact-form-status error';
            }

            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Send Message <span>→</span>';
        });
    }

    // OAuth sign-in only - no email/password forms

    // User menu (in main app)
    document.getElementById("userMenuBtn").addEventListener("click", toggleUserDropdown);
    document.getElementById("logoutBtn").addEventListener("click", handleLogout);
    document.getElementById("accountBtn").addEventListener("click", () => {
        closeUserDropdown();
        document.getElementById("settingsModal").classList.add("show");
    });

    // Tool Menu logout
    document.getElementById("menuLogoutBtn").addEventListener("click", handleLogout);

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
        const userMenu = document.getElementById("userMenuBtn");
        const dropdown = document.getElementById("userDropdown");
        if (!userMenu.contains(e.target) && !dropdown.contains(e.target)) {
            closeUserDropdown();
        }
    });

    // Tool selection cards
    document.getElementById("toolDraftAssistant").addEventListener("click", () => openTool('draft-assistant'));
    document.getElementById("toolCustomerResponse").addEventListener("click", () => openTool('customer-response'));
    document.getElementById("toolDataAnalysis").addEventListener("click", () => openTool('data-analysis'));
    document.getElementById("toolListNormalizer").addEventListener("click", () => openTool('list-normalizer'));
    document.getElementById("toolAskLightspeed").addEventListener("click", () => openTool('ask-lightspeed'));
    document.getElementById("toolRulesOfPlay").addEventListener("click", () => openTool('rules-of-play'));

    // Back to menu button (in sidebar)
    document.getElementById("backToMenuBtn").addEventListener("click", goBackToMenu);

    // Google Sign-In button
    document.getElementById("googleSignInBtn").addEventListener("click", handleGoogleSignIn);

    // Microsoft Sign-In button
    document.getElementById("microsoftSignInBtn").addEventListener("click", handleMicrosoftSignIn);

    // Pricing buttons - wire up all "Start Free Trial" and "Get Started" buttons
    const pricingTrialBtn = document.getElementById("pricingTrialBtn");
    const pricingMonthlyBtn = document.getElementById("pricingMonthlyBtn");
    const pricingAnnualBtn = document.getElementById("pricingAnnualBtn");

    if (pricingTrialBtn) {
        pricingTrialBtn.addEventListener("click", () => {
            document.getElementById("landingPage").classList.add("hidden");
            showLoginPage();
        });
    }

    if (pricingMonthlyBtn) {
        pricingMonthlyBtn.addEventListener("click", () => {
            startCheckout('monthly');
        });
    }

    if (pricingAnnualBtn) {
        pricingAnnualBtn.addEventListener("click", () => {
            startCheckout('annual');
        });
    }

    // Also wire up any other "Start Free Trial" or "Get Started" buttons in the hero/landing sections
    document.querySelectorAll('.hero-cta, .landing-cta-primary').forEach(btn => {
        if (btn && !btn.id) { // Don't double-bind buttons with specific IDs
            btn.addEventListener("click", () => {
                document.getElementById("landingPage").classList.add("hidden");
                showLoginPage();
            });
        }
    });
}

// ==================== GOOGLE OAUTH ====================
function handleGoogleSignIn() {
    // Initialize Google Identity Services
    if (typeof google === 'undefined' || !google.accounts) {
        showToast("Google Sign-In is loading. Please try again.", "error");
        return;
    }

    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredentialResponse,
        auto_select: false
    });

    // Show the Google One Tap UI
    google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            // Fallback: use popup sign-in
            google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: 'email profile',
                callback: handleGoogleTokenResponse
            }).requestAccessToken();
        }
    });
}

// Store the Google credential temporarily for backend auth
let pendingGoogleCredential = null;

async function handleGoogleCredentialResponse(response) {
    // Store the credential for backend verification
    pendingGoogleCredential = response.credential;

    // Decode the JWT credential to get user info for display
    const payload = parseJwt(response.credential);

    if (payload && payload.email) {
        await processGoogleUser(payload, response.credential);
    } else {
        showToast("Failed to get user information from Google", "error");
    }
}

async function handleGoogleTokenResponse(tokenResponse) {
    // Fetch user info using the access token
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
        });
        const userInfo = await response.json();

        if (userInfo.email) {
            // Pass the access token so the backend can verify it via Google's API
            await processGoogleUser(userInfo, null, tokenResponse.access_token);
        } else {
            showToast("Failed to get user information from Google", "error");
        }
    } catch (error) {
        console.error("Google OAuth error:", error);
        showToast("Failed to sign in with Google", "error");
    }
}

async function processGoogleUser(googleUser, credential, accessToken) {
    const email = googleUser.email;
    const name = googleUser.name || googleUser.given_name || email.split('@')[0];
    const picture = googleUser.picture || null;

    // Show loading state
    showToast("Signing in...", "info");

    // Authenticate with backend FIRST
    try {
        // Build request body - use credential (JWT) if available, otherwise send access token
        const actualCredential = credential || pendingGoogleCredential;
        let requestBody;
        if (actualCredential) {
            requestBody = { credential: actualCredential };
        } else if (accessToken) {
            requestBody = { accessToken: accessToken };
        } else {
            showToast("Authentication failed. Please try again.", "error");
            return;
        }

        const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (response.ok) {
            const data = await response.json();

            // Save auth token
            if (data.token) {
                localStorage.setItem('authToken', data.token);
            }

            // Create/update local user object with backend data
            let user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

            if (!user) {
                user = {
                    id: data.user?.id || generateUserId(),
                    email: email,
                    name: name,
                    password: null,
                    googleId: googleUser.sub || null,
                    picture: picture,
                    createdAt: new Date().toISOString(),
                    settings: {
                        defaultName: name.split(" ")[0],
                        orgName: data.organization?.name || ""
                    },
                    data: {
                        customKnowledge: [],
                        feedbackList: [],
                        responseHistory: [],
                        favorites: []
                    }
                };
                users.push(user);
            }

            // Update with backend data
            user.backendId = data.user?.id;
            user.isSuperAdmin = data.user?.isSuperAdmin || false;
            user.organization = data.organization || null;
            user.needsOrganization = data.needsOrganization || false;

            localStorage.setItem("lightspeed_users", JSON.stringify(users));

            // Check if user needs to create an organization (new user)
            if (data.needsOrganization) {
                currentUser = user;
                localStorage.setItem("lightspeed_current_user", user.id);
                showOrganizationSetup(user);
                return;
            }

            // Log the user in
            loginUser(user, true);
            const greeting = data.isNewUser ? "Welcome to Lightspeed" : "Welcome back";
            showToast(`${greeting}, ${user.name.split(" ")[0]}!`, "success");

        } else {
            const errorData = await response.json().catch(() => ({}));
            console.error('Backend auth failed:', errorData);
            showToast(errorData.error || "Sign in failed. Please try again.", "error");
        }
    } catch (error) {
        console.error('Backend auth error:', error);
        showToast("Connection error. Please check your internet and try again.", "error");
    }
}

// ==================== MICROSOFT OAUTH ====================
async function handleMicrosoftSignIn() {
    const instance = await getMsalInstance();
    if (!instance) {
        showToast("Microsoft Sign-In is loading. Please try again.", "error");
        return;
    }

    try {
        const loginResponse = await instance.loginPopup({
            scopes: ['openid', 'profile', 'email', 'User.Read'],
            prompt: 'select_account'
        });

        if (loginResponse && loginResponse.account) {
            await processMicrosoftUser(loginResponse);
        } else {
            showToast("Failed to get user information from Microsoft", "error");
        }
    } catch (error) {
        if (error.errorCode === 'user_cancelled' || error.errorMessage?.includes('cancelled')) {
            // User closed the popup — no toast needed
            return;
        }
        console.error("Microsoft OAuth error:", error);
        showToast("Failed to sign in with Microsoft", "error");
    }
}

async function processMicrosoftUser(loginResponse) {
    const account = loginResponse.account;
    const email = account.username || loginResponse.idTokenClaims?.email || loginResponse.idTokenClaims?.preferred_username;
    const name = account.name || loginResponse.idTokenClaims?.name || email.split('@')[0];

    showToast("Signing in...", "info");

    try {
        // The MSAL popup flow returns tokens directly (not an auth code).
        // Get an access token for Microsoft Graph, then send it to our backend
        // which will verify it by calling Graph API.
        const accessToken = loginResponse.accessToken;

        const response = await fetch(`${API_BASE_URL}/api/auth/microsoft`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accessToken: accessToken,
                email: email,
                name: name,
                microsoftId: account.homeAccountId
            })
        });

        return await handleMicrosoftAuthResponse(response, email, name, account);
    } catch (error) {
        console.error('Microsoft backend auth error:', error);
        showToast("Connection error. Please check your internet and try again.", "error");
    }
}

async function handleMicrosoftAuthResponse(response, email, name, account) {
    if (response.ok) {
        const data = await response.json();

        if (data.token) {
            localStorage.setItem('authToken', data.token);
        }

        let user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

        if (!user) {
            user = {
                id: data.user?.id || generateUserId(),
                email: email,
                name: name,
                password: null,
                microsoftId: account.homeAccountId || null,
                picture: data.user?.picture || null,
                createdAt: new Date().toISOString(),
                settings: {
                    defaultName: name.split(" ")[0],
                    orgName: data.organization?.name || ""
                },
                data: {
                    customKnowledge: [],
                    feedbackList: [],
                    responseHistory: [],
                    favorites: []
                }
            };
            users.push(user);
        }

        user.backendId = data.user?.id;
        user.isSuperAdmin = data.user?.isSuperAdmin || false;
        user.organization = data.organization || null;
        user.needsOrganization = data.needsOrganization || false;
        user.picture = data.user?.picture || user.picture;

        localStorage.setItem("lightspeed_users", JSON.stringify(users));

        if (data.needsOrganization) {
            currentUser = user;
            localStorage.setItem("lightspeed_current_user", user.id);
            showOrganizationSetup(user);
            return;
        }

        loginUser(user, true);
        const greeting = data.isNewUser ? "Welcome to Lightspeed" : "Welcome back";
        showToast(`${greeting}, ${user.name.split(" ")[0]}!`, "success");
    } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Microsoft backend auth failed:', errorData);
        showToast(errorData.error || "Sign in failed. Please try again.", "error");
    }
}

// ==================== ONBOARDING WIZARD (5-Step) ====================
let _wizardOrgId = null;  // Set after Step 1 creates the org
let _wizardStep = 1;
let _wizardInvites = [];  // Track invites sent during wizard

function showOrganizationSetup(user) {
    // Hide other pages
    document.getElementById("landingPage").classList.add("hidden");
    document.getElementById("loginPage").classList.remove("visible");
    document.getElementById("toolMenuPage").classList.remove("visible", "with-sidebar");

    _wizardStep = 1;
    _wizardOrgId = null;
    _wizardInvites = [];

    let modal = document.getElementById("orgSetupModal");
    if (modal) modal.remove();

    modal = document.createElement("div");
    modal.id = "orgSetupModal";
    modal.className = "modal-overlay";
    modal.innerHTML = `
        <div class="modal-content wizard-modal">
            <!-- Progress Bar -->
            <div class="wizard-progress">
                <div class="wizard-progress-bar" id="wizardProgressBar" style="width: 20%"></div>
            </div>
            <div class="wizard-steps-indicator" id="wizardStepsIndicator">
                <span class="wizard-dot active" data-step="1"></span>
                <span class="wizard-dot" data-step="2"></span>
                <span class="wizard-dot" data-step="3"></span>
                <span class="wizard-dot" data-step="4"></span>
                <span class="wizard-dot" data-step="5"></span>
            </div>

            <!-- Step Container -->
            <div class="wizard-step-container" id="wizardStepContainer">
                ${_renderWizardStep1()}
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Add styles
    if (!document.getElementById("orgSetupStyles")) {
        const styles = document.createElement("style");
        styles.id = "orgSetupStyles";
        styles.textContent = _getWizardStyles();
        document.head.appendChild(styles);
    }

    // Bind Step 1 form
    _bindWizardStep1();

    modal.classList.add("show");
}

/* ---------- Step Renderers ---------- */

function _renderWizardStep1() {
    return `
        <div class="wizard-step" id="wizardStep1">
            <div class="wizard-step-header">
                <div class="wizard-step-icon">&#127891;</div>
                <div class="wizard-step-label">Step 1 of 5</div>
                <h2>Welcome to Lightspeed!</h2>
                <p>Let's set up your organization to get started with your <strong>14-day free trial</strong>.</p>
            </div>
            <form id="wizardForm1" class="wizard-form">
                <div class="wizard-field-group">
                    <label for="wizOrgName">Organization Name <span class="required">*</span></label>
                    <input type="text" id="wizOrgName" placeholder="e.g., Thunder Bay Regional Health Sciences Foundation" required>
                    <span class="wizard-hint">Your nonprofit or charity name</span>
                </div>
                <div class="wizard-field-row">
                    <div class="wizard-field-group">
                        <label for="wizWebsite">Website</label>
                        <input type="url" id="wizWebsite" placeholder="https://www.example.org">
                    </div>
                    <div class="wizard-field-group">
                        <label for="wizLicence">License / RAF Number</label>
                        <input type="text" id="wizLicence" placeholder="e.g., RAF-12345">
                    </div>
                </div>
                <div class="wizard-actions">
                    <div></div>
                    <button type="submit" class="wizard-btn wizard-btn-primary" id="wizBtn1">
                        Create Organization
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </button>
                </div>
                <div class="wizard-footer-note">No credit card required. Full access for 14 days.</div>
            </form>
        </div>`;
}

function _renderWizardStep2() {
    return `
        <div class="wizard-step" id="wizardStep2">
            <div class="wizard-step-header">
                <div class="wizard-step-icon">&#127970;</div>
                <div class="wizard-step-label">Step 2 of 5</div>
                <h2>Organization Profile</h2>
                <p>Help our AI tools generate accurate, on-brand content by filling in your org's key details.</p>
            </div>
            <form id="wizardForm2" class="wizard-form">
                <div class="wizard-field-group">
                    <label for="wizMission">Mission Statement</label>
                    <textarea id="wizMission" rows="3" placeholder="e.g., To raise funds for healthcare excellence in Northwestern Ontario..."></textarea>
                </div>
                <div class="wizard-field-row">
                    <div class="wizard-field-group">
                        <label for="wizSupportEmail">Support Email</label>
                        <input type="email" id="wizSupportEmail" placeholder="support@example.org">
                    </div>
                    <div class="wizard-field-group">
                        <label for="wizStoreLocation">Ticket Purchase Location</label>
                        <input type="text" id="wizStoreLocation" placeholder="e.g., 123 Main St, Thunder Bay">
                    </div>
                </div>
                <div class="wizard-field-row">
                    <div class="wizard-field-group">
                        <label for="wizCeoName">CEO / President Name</label>
                        <input type="text" id="wizCeoName" placeholder="e.g., Jane Smith">
                    </div>
                    <div class="wizard-field-group">
                        <label for="wizCeoTitle">Title</label>
                        <input type="text" id="wizCeoTitle" placeholder="e.g., Executive Director">
                    </div>
                </div>
                <div class="wizard-field-row">
                    <div class="wizard-field-group">
                        <label for="wizMediaName">Media Contact Name</label>
                        <input type="text" id="wizMediaName" placeholder="e.g., John Doe">
                    </div>
                    <div class="wizard-field-group">
                        <label for="wizMediaEmail">Media Contact Email</label>
                        <input type="email" id="wizMediaEmail" placeholder="media@example.org">
                    </div>
                </div>
                <div class="wizard-actions">
                    <button type="button" class="wizard-btn wizard-btn-ghost" onclick="_wizardSkip()">Skip for Now</button>
                    <button type="submit" class="wizard-btn wizard-btn-primary" id="wizBtn2">
                        Save &amp; Continue
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </button>
                </div>
            </form>
        </div>`;
}

function _renderWizardStep3() {
    return `
        <div class="wizard-step" id="wizardStep3">
            <div class="wizard-step-header">
                <div class="wizard-step-icon">&#9881;&#65039;</div>
                <div class="wizard-step-label">Step 3 of 5</div>
                <h2>Content Configuration</h2>
                <p>Set defaults so your AI-generated content is accurate from day one.</p>
            </div>
            <form id="wizardForm3" class="wizard-form">
                <div class="wizard-field-row">
                    <div class="wizard-field-group">
                        <label for="wizDrawTime">Default Draw Time</label>
                        <input type="text" id="wizDrawTime" placeholder="e.g., 11:00 AM">
                    </div>
                    <div class="wizard-field-group">
                        <label for="wizDeadlineTime">Ticket Deadline</label>
                        <input type="text" id="wizDeadlineTime" placeholder="e.g., 11:59 PM">
                    </div>
                </div>
                <div class="wizard-field-group">
                    <label for="wizCtaWebsite">Catch the Ace Website URL</label>
                    <input type="url" id="wizCtaWebsite" placeholder="https://www.example.org/catch-the-ace">
                </div>
                <div class="wizard-field-group">
                    <label for="wizSocialLine">Required Social Media Line</label>
                    <textarea id="wizSocialLine" rows="2" placeholder="e.g., Lottery License #M000000. Must be 18+ to play."></textarea>
                    <span class="wizard-hint">This line will be appended to all AI-generated social media posts</span>
                </div>
                <div class="wizard-field-group">
                    <label for="wizBrandTerms">Brand Terminology Rules</label>
                    <textarea id="wizBrandTerms" rows="3" placeholder="One rule per line, e.g.:\nAlways say &quot;50/50 Raffle&quot; not &quot;fifty-fifty&quot;\nUse &quot;supporters&quot; instead of &quot;customers&quot;"></textarea>
                    <span class="wizard-hint">AI tools will follow these rules when generating content</span>
                </div>
                <div class="wizard-actions">
                    <button type="button" class="wizard-btn wizard-btn-ghost" onclick="_wizardSkip()">Skip for Now</button>
                    <button type="submit" class="wizard-btn wizard-btn-primary" id="wizBtn3">
                        Save &amp; Continue
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </button>
                </div>
            </form>
        </div>`;
}

function _renderWizardStep4() {
    return `
        <div class="wizard-step" id="wizardStep4">
            <div class="wizard-step-header">
                <div class="wizard-step-icon">&#128101;</div>
                <div class="wizard-step-label">Step 4 of 5</div>
                <h2>Invite Your Team</h2>
                <p>Collaboration is better together. Invite team members to your organization.</p>
            </div>
            <div class="wizard-form">
                <div class="wizard-invite-form" id="wizardInviteForm">
                    <div class="wizard-field-row wizard-invite-row">
                        <div class="wizard-field-group" style="flex:2">
                            <label for="wizInviteEmail">Email Address</label>
                            <input type="email" id="wizInviteEmail" placeholder="colleague@example.org">
                        </div>
                        <div class="wizard-field-group" style="flex:1">
                            <label for="wizInviteRole">Role</label>
                            <select id="wizInviteRole" class="wizard-select">
                                <option value="member">Member</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div class="wizard-field-group wizard-invite-btn-wrap">
                            <label>&nbsp;</label>
                            <button type="button" class="wizard-btn wizard-btn-secondary" id="wizSendInviteBtn" onclick="_wizardSendInvite()">Send Invite</button>
                        </div>
                    </div>
                </div>
                <div class="wizard-invite-list" id="wizardInviteList"></div>
                <div class="wizard-actions">
                    <button type="button" class="wizard-btn wizard-btn-ghost" onclick="_wizardSkip()">Skip for Now</button>
                    <button type="button" class="wizard-btn wizard-btn-primary" onclick="_wizardGoTo(5)">
                        Continue
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </button>
                </div>
            </div>
        </div>`;
}

function _renderWizardStep5() {
    const inviteCount = _wizardInvites.length;
    const inviteNote = inviteCount > 0
        ? `<div class="wizard-summary-item"><span class="wizard-summary-check">&#10003;</span> ${inviteCount} team invite${inviteCount > 1 ? 's' : ''} sent</div>`
        : '';

    return `
        <div class="wizard-step wizard-step-final" id="wizardStep5">
            <div class="wizard-step-header">
                <div class="wizard-step-icon wizard-confetti">&#127881;</div>
                <div class="wizard-step-label">Step 5 of 5</div>
                <h2>You're All Set!</h2>
                <p>Your organization is ready to go. Here's what's waiting for you:</p>
            </div>
            <div class="wizard-form">
                <div class="wizard-summary">
                    <div class="wizard-summary-item"><span class="wizard-summary-check">&#10003;</span> 14-day free trial activated</div>
                    <div class="wizard-summary-item"><span class="wizard-summary-check">&#10003;</span> Organization created</div>
                    ${inviteNote}
                </div>
                <div class="wizard-tools-preview">
                    <h3>Your Toolkit</h3>
                    <div class="wizard-tools-grid">
                        <div class="wizard-tool-card">
                            <span class="wizard-tool-icon">&#9889;</span>
                            <div><strong>Response Assistant</strong><br><small>AI-powered customer replies</small></div>
                        </div>
                        <div class="wizard-tool-card">
                            <span class="wizard-tool-icon">&#9997;&#65039;</span>
                            <div><strong>Draft Assistant</strong><br><small>Social, email &amp; media content</small></div>
                        </div>
                        <div class="wizard-tool-card">
                            <span class="wizard-tool-icon">&#128200;</span>
                            <div><strong>Insights Engine</strong><br><small>Data analytics dashboards</small></div>
                        </div>
                        <div class="wizard-tool-card">
                            <span class="wizard-tool-icon">&#10024;</span>
                            <div><strong>Ask Lightspeed</strong><br><small>Your all-in-one AI assistant</small></div>
                        </div>
                    </div>
                </div>
                <div class="wizard-actions wizard-actions-center">
                    <button type="button" class="wizard-btn wizard-btn-primary wizard-btn-finish" onclick="_wizardFinish()">
                        Go to Dashboard
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </button>
                </div>
                <div class="wizard-footer-note">You can update all of these settings anytime from the Teams page.</div>
            </div>
        </div>`;
}

/* ---------- Step Navigation ---------- */

function _wizardGoTo(step) {
    _wizardStep = step;
    const container = document.getElementById('wizardStepContainer');
    const renderers = {
        1: _renderWizardStep1,
        2: _renderWizardStep2,
        3: _renderWizardStep3,
        4: _renderWizardStep4,
        5: _renderWizardStep5
    };
    container.innerHTML = renderers[step]();

    // Update progress
    document.getElementById('wizardProgressBar').style.width = `${step * 20}%`;
    document.querySelectorAll('.wizard-dot').forEach(dot => {
        const s = parseInt(dot.dataset.step);
        dot.classList.toggle('active', s === step);
        dot.classList.toggle('completed', s < step);
    });

    // Bind form handlers
    if (step === 1) _bindWizardStep1();
    if (step === 2) _bindWizardStep2();
    if (step === 3) _bindWizardStep3();
}

function _wizardSkip() {
    _wizardGoTo(_wizardStep + 1);
}

function _bindWizardStep1() {
    document.getElementById('wizardForm1').addEventListener('submit', async (e) => {
        e.preventDefault();
        const orgName = document.getElementById('wizOrgName').value.trim();
        if (!orgName) { showToast('Please enter your organization name', 'error'); return; }

        const btn = document.getElementById('wizBtn1');
        btn.disabled = true;
        btn.innerHTML = 'Creating...';

        try {
            const token = localStorage.getItem('authToken');
            const response = await fetch(`${API_BASE_URL}/api/auth/create-organization`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name: orgName })
            });

            if (response.ok) {
                const data = await response.json();
                currentUser.organization = data.organization;
                currentUser.needsOrganization = false;
                currentUser.settings.orgName = data.organization.name;

                const userIndex = users.findIndex(u => u.id === currentUser.id);
                if (userIndex >= 0) {
                    users[userIndex] = currentUser;
                    localStorage.setItem("lightspeed_users", JSON.stringify(users));
                }

                _wizardOrgId = data.organization.id;

                // Save optional fields from step 1 (website, licence) if provided
                const website = document.getElementById('wizWebsite').value.trim();
                const licence = document.getElementById('wizLicence').value.trim();
                if (website || licence) {
                    await _wizardPatchOrg({ websiteUrl: website || undefined, licenceNumber: licence || undefined });
                }

                _wizardGoTo(2);
            } else {
                const errorData = await response.json().catch(() => ({}));
                showToast(errorData.error || 'Failed to create organization', 'error');
            }
        } catch (error) {
            console.error('Wizard step 1 error:', error);
            showToast('Connection error. Please try again.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Create Organization <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
        }
    });
}

function _bindWizardStep2() {
    document.getElementById('wizardForm2').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('wizBtn2');
        btn.disabled = true;
        btn.innerHTML = 'Saving...';

        try {
            await _wizardPatchOrg({
                mission: document.getElementById('wizMission').value.trim() || undefined,
                supportEmail: document.getElementById('wizSupportEmail').value.trim() || undefined,
                storeLocation: document.getElementById('wizStoreLocation').value.trim() || undefined,
                ceoName: document.getElementById('wizCeoName').value.trim() || undefined,
                ceoTitle: document.getElementById('wizCeoTitle').value.trim() || undefined,
                mediaContactName: document.getElementById('wizMediaName').value.trim() || undefined,
                mediaContactEmail: document.getElementById('wizMediaEmail').value.trim() || undefined
            });
            _wizardGoTo(3);
        } catch (error) {
            showToast('Failed to save profile. You can update this later.', 'error');
            _wizardGoTo(3);
        } finally {
            btn.disabled = false;
        }
    });
}

function _bindWizardStep3() {
    document.getElementById('wizardForm3').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('wizBtn3');
        btn.disabled = true;
        btn.innerHTML = 'Saving...';

        try {
            const brandTermsRaw = document.getElementById('wizBrandTerms').value.trim();
            const brandTerminology = brandTermsRaw
                ? JSON.stringify({ notes: brandTermsRaw.split('\n').map(l => l.trim()).filter(Boolean) })
                : undefined;

            await _wizardPatchOrg({
                defaultDrawTime: document.getElementById('wizDrawTime').value.trim() || undefined,
                ticketDeadlineTime: document.getElementById('wizDeadlineTime').value.trim() || undefined,
                ctaWebsiteUrl: document.getElementById('wizCtaWebsite').value.trim() || undefined,
                socialRequiredLine: document.getElementById('wizSocialLine').value.trim() || undefined,
                brandTerminology
            });
            _wizardGoTo(4);
        } catch (error) {
            showToast('Failed to save configuration. You can update this later.', 'error');
            _wizardGoTo(4);
        } finally {
            btn.disabled = false;
        }
    });
}

async function _wizardSendInvite() {
    const emailInput = document.getElementById('wizInviteEmail');
    const roleSelect = document.getElementById('wizInviteRole');
    const email = emailInput.value.trim();
    if (!email) { showToast('Please enter an email address', 'error'); return; }

    const btn = document.getElementById('wizSendInviteBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/organizations/${_wizardOrgId}/invite`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ email, role: roleSelect.value })
        });

        if (response.ok) {
            const data = await response.json();
            _wizardInvites.push({ email, role: roleSelect.value, emailSent: data.emailSent });
            emailInput.value = '';

            // Update invite list display
            const list = document.getElementById('wizardInviteList');
            list.innerHTML = _wizardInvites.map(inv => `
                <div class="wizard-invite-item">
                    <span class="wizard-invite-email">${inv.email}</span>
                    <span class="wizard-invite-role">${inv.role}</span>
                    <span class="wizard-invite-status">${inv.emailSent ? 'Email sent' : 'Link created'}</span>
                </div>
            `).join('');

            showToast(`Invitation sent to ${email}`, 'success');
        } else {
            const errData = await response.json().catch(() => ({}));
            showToast(errData.error || 'Failed to send invitation', 'error');
        }
    } catch (error) {
        console.error('Invite error:', error);
        showToast('Connection error. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send Invite';
    }
}

async function _wizardPatchOrg(fields) {
    // Remove undefined values
    const payload = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) payload[k] = v;
    }
    if (Object.keys(payload).length === 0) return;

    const response = await fetch(`${API_BASE_URL}/api/organizations/${_wizardOrgId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        const data = await response.json();
        currentUser.organization = { ...currentUser.organization, ...data.organization };
    }
}

function _wizardFinish() {
    document.getElementById('orgSetupModal').classList.remove('show');

    // Check if user selected a plan before signing up
    const selectedPlan = localStorage.getItem('selectedPlan');
    if (selectedPlan) localStorage.removeItem('selectedPlan');

    loginUser(currentUser, false);

    if (selectedPlan) {
        showToast('Setting up your subscription...', 'info');
        startCheckout(selectedPlan);
    } else {
        showToast('Welcome to Lightspeed! Your 14-day trial has started.', 'success');
    }
}

/* ---------- Wizard Styles ---------- */

function _getWizardStyles() {
    return `
    /* Overlay */
    #orgSetupModal {
        background: linear-gradient(135deg, #E91E8C 0%, #F5A623 100%);
    }

    /* Modal container */
    .wizard-modal {
        max-width: 620px;
        width: 95vw;
        padding: 0;
        background: #ffffff;
        border-radius: 16px;
        overflow: hidden;
        max-height: 90vh;
        overflow-y: auto;
    }

    /* Progress bar */
    .wizard-progress {
        height: 4px;
        background: #e2e8f0;
        border-radius: 4px 4px 0 0;
        overflow: hidden;
    }
    .wizard-progress-bar {
        height: 100%;
        background: linear-gradient(90deg, #E91E8C, #F5A623);
        transition: width 0.4s ease;
        border-radius: 0 2px 2px 0;
    }

    /* Step dots */
    .wizard-steps-indicator {
        display: flex;
        justify-content: center;
        gap: 10px;
        padding: 16px 0 0;
    }
    .wizard-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #e2e8f0;
        transition: all 0.3s;
    }
    .wizard-dot.active {
        background: linear-gradient(135deg, #E91E8C, #F5A623);
        transform: scale(1.2);
    }
    .wizard-dot.completed {
        background: #48bb78;
    }

    /* Step container */
    .wizard-step-container {
        padding: 24px 36px 32px;
    }
    @media (max-width: 600px) {
        .wizard-step-container { padding: 20px 20px 24px; }
    }

    /* Step header */
    .wizard-step-header {
        text-align: center;
        margin-bottom: 28px;
    }
    .wizard-step-icon {
        font-size: 40px;
        margin-bottom: 8px;
        display: inline-block;
    }
    .wizard-step-label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #a0aec0;
        margin-bottom: 6px;
    }
    .wizard-step-header h2 {
        margin: 0 0 8px 0;
        font-size: 24px;
        font-weight: 700;
        color: #1a1a2e;
    }
    .wizard-step-header p {
        margin: 0;
        color: #4a5568;
        font-size: 15px;
        line-height: 1.5;
    }
    .wizard-step-header p strong { color: #0A2540; }

    /* Form fields */
    .wizard-form { text-align: left; }
    .wizard-field-group {
        margin-bottom: 18px;
    }
    .wizard-field-group label {
        display: block;
        margin-bottom: 6px;
        font-weight: 600;
        color: #1a1a2e;
        font-size: 13px;
    }
    .wizard-field-group label .required { color: #E91E8C; }
    .wizard-field-group input,
    .wizard-field-group textarea,
    .wizard-field-group select {
        width: 100%;
        padding: 12px 14px;
        border: 2px solid #e2e8f0;
        border-radius: 10px;
        font-size: 15px;
        transition: all 0.2s;
        background: #f8fafc;
        color: #1a1a2e;
        box-sizing: border-box;
        font-family: inherit;
    }
    .wizard-field-group input::placeholder,
    .wizard-field-group textarea::placeholder {
        color: #a0aec0;
    }
    .wizard-field-group input:focus,
    .wizard-field-group textarea:focus,
    .wizard-field-group select:focus {
        outline: none;
        border-color: #0A2540;
        background: #fff;
    }
    .wizard-field-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
    }
    @media (max-width: 500px) {
        .wizard-field-row { grid-template-columns: 1fr; }
    }
    .wizard-hint {
        display: block;
        margin-top: 6px;
        font-size: 12px;
        color: #718096;
    }
    .wizard-select {
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23718096' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 14px center;
        padding-right: 36px;
    }

    /* Buttons */
    .wizard-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 24px;
        gap: 12px;
    }
    .wizard-actions-center {
        justify-content: center;
    }
    .wizard-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 24px;
        font-size: 15px;
        font-weight: 600;
        border-radius: 10px;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
        font-family: inherit;
    }
    .wizard-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none !important;
    }
    .wizard-btn-primary {
        background: linear-gradient(135deg, #E91E8C 0%, #F5A623 100%);
        color: #fff;
    }
    .wizard-btn-primary:hover:not(:disabled) { transform: translateY(-2px); }
    .wizard-btn-ghost {
        background: transparent;
        color: #718096;
        padding: 12px 16px;
    }
    .wizard-btn-ghost:hover { color: #1a1a2e; }
    .wizard-btn-secondary {
        background: #0A2540;
        color: #fff;
        padding: 12px 18px;
        font-size: 14px;
    }
    .wizard-btn-secondary:hover:not(:disabled) { background: #163a5c; }
    .wizard-btn-finish {
        padding: 16px 36px;
        font-size: 18px;
    }

    .wizard-footer-note {
        text-align: center;
        margin-top: 16px;
        font-size: 13px;
        color: #718096;
    }
    .wizard-footer-note::before {
        content: "\\2713  ";
        color: #48bb78;
    }

    /* Step 4: Invite list */
    .wizard-invite-row {
        align-items: end;
    }
    .wizard-invite-btn-wrap {
        flex: 0 0 auto !important;
    }
    .wizard-invite-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 4px;
    }
    .wizard-invite-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background: #f0fdf4;
        border-radius: 8px;
        font-size: 14px;
    }
    .wizard-invite-email { flex: 1; color: #1a1a2e; font-weight: 500; }
    .wizard-invite-role {
        text-transform: capitalize;
        color: #718096;
        font-size: 12px;
        background: #e2e8f0;
        padding: 2px 8px;
        border-radius: 4px;
    }
    .wizard-invite-status { color: #48bb78; font-size: 12px; }

    /* Step 5: Summary & tools */
    .wizard-summary {
        background: #f8fafc;
        border-radius: 12px;
        padding: 16px 20px;
        margin-bottom: 24px;
    }
    .wizard-summary-item {
        padding: 6px 0;
        font-size: 15px;
        color: #2d3748;
    }
    .wizard-summary-check {
        color: #48bb78;
        font-weight: 700;
        margin-right: 8px;
    }
    .wizard-tools-preview h3 {
        margin: 0 0 14px 0;
        font-size: 16px;
        font-weight: 600;
        color: #1a1a2e;
        text-align: center;
    }
    .wizard-tools-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
    }
    @media (max-width: 500px) {
        .wizard-tools-grid { grid-template-columns: 1fr; }
    }
    .wizard-tool-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px;
        background: #f8fafc;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
        transition: border-color 0.2s;
    }
    .wizard-tool-card:hover { border-color: #E91E8C; }
    .wizard-tool-icon {
        font-size: 28px;
        flex-shrink: 0;
        width: 40px;
        text-align: center;
    }
    .wizard-tool-card strong {
        font-size: 14px;
        color: #1a1a2e;
    }
    .wizard-tool-card small {
        font-size: 12px;
        color: #718096;
    }

    /* Confetti effect on step 5 icon */
    .wizard-confetti {
        animation: wizardBounce 0.6s ease;
    }
    @keyframes wizardBounce {
        0% { transform: scale(0.3); opacity: 0; }
        50% { transform: scale(1.15); }
        100% { transform: scale(1); opacity: 1; }
    }
    `;
}

function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        console.error("Failed to parse JWT:", e);
        return null;
    }
}

function showLoginPage() {
    pushRoute('/login');
    document.getElementById("loginPage").classList.add("visible");
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("dataAnalysisApp").classList.remove("visible");
    document.getElementById("draftAssistantApp").classList.remove("visible");
    document.getElementById("toolMenuPage").classList.remove("visible", "with-sidebar");
}

function showToolMenu() {
    pushRoute('/dashboard');
    document.getElementById("landingPage").classList.add("hidden");
    document.getElementById("loginPage").classList.remove("visible");

    // Show appWrapper (sidebar) alongside dashboard
    document.getElementById("appWrapper").classList.add("visible");

    // Hide all tool apps
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("dataAnalysisApp").classList.remove("visible");
    document.getElementById("draftAssistantApp").classList.remove("visible");
    document.getElementById("listNormalizerApp").classList.remove("visible");

    // Show dashboard with sidebar offset
    const toolMenuPage = document.getElementById("toolMenuPage");
    toolMenuPage.classList.add("visible", "with-sidebar");

    // Update sidebar: Dashboard active, no tool active
    document.querySelectorAll(".sidebar-btn[data-tool]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tool === "dashboard");
    });
    const responsePages = document.getElementById("sidebarResponsePages");
    if (responsePages) responsePages.style.display = 'none';
    closeSidebar();

    // Update greeting based on time of day
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const greetingEl = document.getElementById("menuGreeting");
    if (greetingEl && currentUser) {
        const firstName = currentUser.name ? currentUser.name.split(' ')[0] : '';
        greetingEl.textContent = firstName ? `${timeGreeting}, ${firstName}.` : `${timeGreeting}.`;
    } else if (greetingEl) {
        greetingEl.textContent = `${timeGreeting}.`;
    }

    // Update user info in menu
    if (currentUser) {
        document.getElementById("menuUserName").textContent = currentUser.name;
        document.getElementById("menuUserEmail").textContent = currentUser.email;

        // Add Admin Dashboard button for super admins
        const toolMenuUser = document.querySelector('.tool-menu-user');
        const existingAdminBtn = document.getElementById('menuAdminBtn');

        if (currentUser.isSuperAdmin && !existingAdminBtn && toolMenuUser) {
            const adminBtn = document.createElement('button');
            adminBtn.id = 'menuAdminBtn';
            adminBtn.className = 'tool-menu-admin-btn';
            adminBtn.innerHTML = '🛡️ Admin Dashboard';
            adminBtn.style.cssText = 'background: linear-gradient(135deg, #E91E8C 0%, #F5A623 100%); color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; margin-right: 12px; font-size: 14px;';
            adminBtn.onclick = function() {
                openTool('customer-response');
                switchPage('admin');
                if (typeof window.loadAdminDashboard === 'function') {
                    window.loadAdminDashboard();
                }
            };
            toolMenuUser.insertBefore(adminBtn, toolMenuUser.firstChild);
        } else if (!currentUser.isSuperAdmin && existingAdminBtn) {
            existingAdminBtn.remove();
        }
    }

    // Fetch subscription status and show billing button if subscribed
    const billingBtn = document.getElementById('menuBillingBtn');
    if (billingBtn) {
        fetch(`${API_BASE_URL}/api/billing/subscription`, { headers: getAuthHeaders() })
            .then(r => r.ok ? r.json() : null)
            .then(sub => {
                if (sub && sub.hasPaymentMethod) {
                    billingBtn.style.display = '';
                }
            })
            .catch(() => {}); // Silently ignore — not critical
    }

}

function openTool(toolId) {
    currentTool = toolId;
    document.getElementById("toolMenuPage").classList.remove("visible", "with-sidebar");

    // Update URL
    pushRoute(TOOL_ROUTES[toolId] || '/dashboard');

    // Show the app wrapper (contains sidebar + all tools)
    document.getElementById("appWrapper").classList.add("visible");

    // Hide all tool apps first
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("dataAnalysisApp").classList.remove("visible");
    document.getElementById("draftAssistantApp").classList.remove("visible");
    document.getElementById("listNormalizerApp").classList.remove("visible");
    document.getElementById("askLightspeedApp").classList.remove("visible");
    document.getElementById("rulesOfPlayApp").classList.remove("visible");

    if (toolId === 'customer-response') {
        document.getElementById("mainApp").classList.add("visible");
    } else if (toolId === 'data-analysis') {
        document.getElementById("dataAnalysisApp").classList.add("visible");
        setupDataAnalysisListeners();
    } else if (toolId === 'draft-assistant') {
        document.getElementById("draftAssistantApp").classList.add("visible");
        setupDraftAssistant();
    } else if (toolId === 'list-normalizer') {
        document.getElementById("listNormalizerApp").classList.add("visible");
        setupListNormalizerListeners();
        showNormalizerHub();
    } else if (toolId === 'ask-lightspeed') {
        document.getElementById("askLightspeedApp").classList.add("visible");
        initAskLightspeedPage();
    } else if (toolId === 'rules-of-play') {
        document.getElementById("rulesOfPlayApp").classList.add("visible");
        initRulesOfPlay();
    }

    // Update sidebar active states
    updateSidebarForTool(toolId);
}

function updateSidebarForTool(toolId) {
    // Update tool-level buttons
    document.querySelectorAll(".sidebar-btn[data-tool]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tool === toolId);
    });

    // Show/hide Response Assistant sub-pages group
    const responsePages = document.getElementById("sidebarResponsePages");
    if (responsePages) {
        responsePages.style.display = toolId === 'customer-response' ? 'block' : 'none';
    }

    // If switching to Response Assistant, make sure Generator is active by default
    if (toolId === 'customer-response') {
        const hasActivePage = document.querySelector(".sidebar-btn[data-page].active");
        if (!hasActivePage) {
            const genBtn = document.querySelector('.sidebar-btn[data-page="response"]');
            if (genBtn) genBtn.classList.add("active");
        }
    }
}

function goBackToMenu() {
    currentTool = null;
    // Don't hide appWrapper - sidebar stays visible
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("dataAnalysisApp").classList.remove("visible");
    document.getElementById("draftAssistantApp").classList.remove("visible");
    document.getElementById("listNormalizerApp").classList.remove("visible");
    document.getElementById("askLightspeedApp").classList.remove("visible");
    document.getElementById("rulesOfPlayApp").classList.remove("visible");
    showToolMenu();
}

// ==================== ASK LIGHTSPEED ====================
const ASK_SAMPLE_PROMPTS = [
    "How should I respond to a donor asking about tax receipts?",
    "Write a thank-you message for a monthly subscriber",
    "Help me brainstorm social media content ideas for this month",
    "How do I handle a complaint about a ticket purchase?",
    "Draft a professional email to a corporate sponsor",
    "What should I say to someone who didn't win the draw?",
    "Give me 3 ideas for an engaging Facebook post about our next draw",
    "How do I explain the 50/50 lottery to someone new?",
    "Write a brief announcement for our Early Bird draw winner",
    "Help me respond to a customer having trouble with their account",
    "What's a good way to promote subscriptions to existing buyers?",
    "Draft a friendly follow-up to a lapsed donor",
    "How should I announce a record-breaking Grand Prize?",
    "Help me write a subject line for our next email campaign",
    "What tone should I use for a draw reminder email?",
    "Give me ideas for an Impact Sunday story",
    "Write a short blurb about where lottery funds go",
    "How do I politely decline a request we can't fulfill?",
    "Suggest some calls-to-action for our website",
    "Help me rewrite this paragraph to sound more exciting"
];

let askConversation = [];
let askTone = 'professional';
let askListenersSetup = false;

function saveAskConversation() {
    try {
        localStorage.setItem('lightspeed_ask_conversation', JSON.stringify(askConversation));
        localStorage.setItem('lightspeed_ask_tone', askTone);
    } catch (e) {
        // localStorage full or unavailable — silently fail
    }
}

function loadAskConversation() {
    try {
        const saved = localStorage.getItem('lightspeed_ask_conversation');
        const savedTone = localStorage.getItem('lightspeed_ask_tone');
        if (saved) {
            askConversation = JSON.parse(saved);
        }
        if (savedTone) {
            askTone = savedTone;
        }
    } catch (e) {
        askConversation = [];
    }
}

function restoreAskChat() {
    if (askConversation.length === 0) return;

    // Show chat area, hide sample prompts
    const chatArea = document.getElementById('askChat');
    const prompts = document.getElementById('askPrompts');
    if (chatArea) chatArea.style.display = 'block';
    if (prompts) prompts.style.display = 'none';

    // Restore tone pill
    document.querySelectorAll('.ask-tone').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tone === askTone);
    });

    // Re-render all messages
    askConversation.forEach(msg => {
        appendAskMessage(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
    });
}

function initAskLightspeed() {
    loadAskConversation();

    if (askConversation.length > 0) {
        restoreAskChat();
    } else {
        renderSamplePrompts();
    }

    if (!askListenersSetup) {
        askListenersSetup = true;

        // Tone pills
        document.querySelectorAll('.ask-tone').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.ask-tone').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                askTone = btn.dataset.tone;
                saveAskConversation();
            });
        });

        // Send button
        document.getElementById('askSendBtn').addEventListener('click', sendAskMessage);

        // Input - enter to send, shift+enter for newline, auto-resize
        const askInput = document.getElementById('askInput');
        askInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAskMessage();
            }
        });
        askInput.addEventListener('input', () => {
            askInput.style.height = 'auto';
            askInput.style.height = Math.min(askInput.scrollHeight, 120) + 'px';
        });
    }
}

function renderSamplePrompts() {
    const container = document.getElementById('askPrompts');
    if (!container) return;

    // Pick 4 random prompts
    const shuffled = [...ASK_SAMPLE_PROMPTS].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 4);

    container.innerHTML = selected.map(prompt =>
        `<button class="ask-prompt-chip" onclick="fillAskPrompt(this)">${escapeHtml(prompt)}</button>`
    ).join('');
}

function fillAskPrompt(el) {
    const input = document.getElementById('askInput');
    input.value = el.textContent;
    input.focus();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}

async function sendAskMessage() {
    const input = document.getElementById('askInput');
    const message = input.value.trim();
    if (!message) return;

    const sendBtn = document.getElementById('askSendBtn');
    sendBtn.disabled = true;

    // Show chat area
    const chatArea = document.getElementById('askChat');
    chatArea.style.display = 'block';

    // Hide sample prompts after first message
    const prompts = document.getElementById('askPrompts');
    if (prompts) prompts.style.display = 'none';

    // Add user message
    askConversation.push({ role: 'user', content: message });
    appendAskMessage('user', message);
    saveAskConversation();

    // Clear input
    input.value = '';
    input.style.height = 'auto';

    // Show typing indicator
    const messagesEl = document.getElementById('askMessages');
    const typingEl = document.createElement('div');
    typingEl.className = 'ask-typing';
    typingEl.id = 'askTyping';
    typingEl.innerHTML = '<div class="ask-typing-dot"></div><div class="ask-typing-dot"></div><div class="ask-typing-dot"></div>';
    messagesEl.appendChild(typingEl);
    chatArea.scrollTop = chatArea.scrollHeight;

    try {
        const toneDesc = askTone === 'professional' ? 'professional and helpful' :
                         askTone === 'friendly' ? 'warm, friendly, and conversational' :
                         'casual and relaxed';

        const orgName = currentUser?.organization?.name || 'your organization';

        const systemPrompt = `You are Lightspeed AI, a powerful, full-featured AI assistant built by Launchpad Solutions. You work for ${orgName}.

TONE: Respond in a ${toneDesc} tone.
${getLanguageInstruction()}
CORE BEHAVIOR — ALWAYS FOLLOW:
Before generating any content (emails, posts, documents, strategies, analyses, code, or anything substantial), you MUST first ask 2-3 clarifying questions to understand exactly what the user needs. This includes understanding context, audience, goals, constraints, and preferences. Only after the user answers should you produce the final output. This makes your work dramatically more accurate and tailored.

Exception: If the user's request is a simple factual question, a quick calculation, or a brief answer that doesn't require generation — answer directly without asking clarifying questions.

You are a fully capable AI assistant. You can help with absolutely anything:
- Drafting emails, social media posts, marketing content, and communications
- Charitable gaming, lotteries, raffles, AGCO rules, and nonprofit operations
- Customer service, donor relations, and response strategies
- Data analysis, spreadsheets, reporting, and business intelligence
- Writing, editing, proofreading, and content strategy
- Coding, technical questions, and troubleshooting
- Research, brainstorming, planning, and general knowledge
- Anything else the user asks — you are not limited in scope

Keep responses concise but thorough. Use markdown formatting when helpful.`;

        // KB entries are now picked server-side by the Haiku relevance picker
        // when we pass `inquiry` to /api/generate.

        // Inject rated examples from feedback loop, filtered by topic relevance
        const ratedExamples = await getRatedExamples('ask_lightspeed', null, message);
        const feedbackSection = buildRatedExamplesContext(ratedExamples);

        // Inject draw schedule context for accurate date/prize awareness
        const drawScheduleSection = getDrawScheduleContext();
        const fullSystemPrompt = systemPrompt + '\n\nKnowledge base:\n' + (drawScheduleSection ? '\n\n' + drawScheduleSection : '') + feedbackSection;

        // Remove typing indicator and create streaming message div
        const typing = document.getElementById('askTyping');
        if (typing) typing.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = 'ask-msg ask-msg-ai';
        messagesEl.appendChild(msgDiv);

        const { text: aiText } = await fetchStream({
            system: fullSystemPrompt,
            inquiry: message,
            messages: askConversation.map(m => ({ role: m.role, content: m.content })),
            max_tokens: 4096
        }, {
            onText: (chunk) => {
                // Render streamed markdown incrementally
                msgDiv.innerHTML = renderSimpleMarkdown(msgDiv._rawText = (msgDiv._rawText || '') + chunk);
                chatArea.scrollTop = chatArea.scrollHeight;
            }
        });

        askConversation.push({ role: 'assistant', content: aiText });
        saveAskConversation();

        // Save to response history for feedback loop
        const lastUserMsg = askConversation.filter(m => m.role === 'user').slice(-1)[0];
        let askHistoryId = null;
        try {
            const histRes = await fetch(`${API_BASE_URL}/api/response-history`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    inquiry: lastUserMsg ? lastUserMsg.content : '',
                    response: aiText,
                    format: 'chat',
                    tone: askTone,
                    tool: 'ask_lightspeed'
                })
            });
            if (histRes.ok) {
                const histData = await histRes.json();
                askHistoryId = histData.entry.id;
            }
        } catch (e) {
            console.warn('Could not save ask history:', e);
        }

        // Final render with action buttons
        appendAskMessageActions(msgDiv, askHistoryId);

    } catch (error) {
        const typing = document.getElementById('askTyping');
        if (typing) typing.remove();
        console.error('Ask Lightspeed error:', error);
        appendAskMessage('ai', 'Sorry, I ran into an issue. Please try again.');
    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

/** Render simple markdown (bold, italic, code, line breaks) from raw text */
function renderSimpleMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.04);padding:1px 5px;border-radius:4px;font-size:0.84em;">$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

/** Append action buttons (Copy, New chat, rating) to a streaming message div */
function appendAskMessageActions(msgDiv, historyId) {
    const actions = document.createElement('div');
    actions.className = 'ask-msg-actions';
    let actionsHtml = `<button class="ask-copy-btn" onclick="copyAskMessage(this)">Copy</button>
        <button class="ask-clear-btn" onclick="clearAskChat()">New chat</button>`;
    if (historyId) {
        actionsHtml += `
            <button class="rating-btn thumbs-up" onclick="rateAskMessage('${historyId}', 'positive', this)" title="Good response">👍</button>
            <button class="rating-btn thumbs-down" onclick="rateAskMessage('${historyId}', 'negative', this)" title="Needs improvement">👎</button>`;
    }
    actions.innerHTML = actionsHtml;
    msgDiv.appendChild(actions);
}

/** Append action buttons (Copy, New chat, rating) to an Als streaming message div */
function appendAlsMessageActions(msgDiv, historyId) {
    const actions = document.createElement('div');
    actions.className = 'als-msg-actions';
    let actionsHtml = `<button onclick="copyAlsMessage(this)">Copy</button>
        <button onclick="clearAlsChat()">New chat</button>`;
    if (historyId) {
        actionsHtml += `
            <button class="rating-btn thumbs-up" onclick="rateAlsMessage('${historyId}', 'positive', this)" title="Good response">👍</button>
            <button class="rating-btn thumbs-down" onclick="rateAlsMessage('${historyId}', 'negative', this)" title="Needs improvement">👎</button>`;
    }
    actions.innerHTML = actionsHtml;
    msgDiv.appendChild(actions);
}

function appendAskMessage(role, text, historyId) {
    const messagesEl = document.getElementById('askMessages');
    const chatArea = document.getElementById('askChat');
    const msgDiv = document.createElement('div');
    msgDiv.className = `ask-msg ask-msg-${role}`;

    if (role === 'ai') {
        // Simple markdown: bold, italic, code blocks, line breaks
        let html = escapeHtml(text);
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
        html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:4px;font-size:0.84em;">$1</code>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/\n/g, '<br>');
        msgDiv.innerHTML = html;

        // Add copy button + rating buttons
        const actions = document.createElement('div');
        actions.className = 'ask-msg-actions';
        let actionsHtml = `<button class="ask-copy-btn" onclick="copyAskMessage(this)">Copy</button>
            <button class="ask-clear-btn" onclick="clearAskChat()">New chat</button>`;
        if (historyId) {
            actionsHtml += `
                <button class="rating-btn thumbs-up" onclick="rateAskMessage('${historyId}', 'positive', this)" title="Good response">👍</button>
                <button class="rating-btn thumbs-down" onclick="rateAskMessage('${historyId}', 'negative', this)" title="Needs improvement">👎</button>`;
        }
        actions.innerHTML = actionsHtml;
        msgDiv.appendChild(actions);
    } else {
        msgDiv.textContent = text;
    }

    messagesEl.appendChild(msgDiv);
    chatArea.scrollTop = chatArea.scrollHeight;
}

function copyAskMessage(btn) {
    const msgDiv = btn.closest('.ask-msg');
    // Get text content excluding the action buttons
    const clone = msgDiv.cloneNode(true);
    const actions = clone.querySelector('.ask-msg-actions');
    if (actions) actions.remove();
    const text = clone.textContent.trim();
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
}

function clearAskChat() {
    askConversation = [];
    saveAskConversation();
    document.getElementById('askMessages').innerHTML = '';
    document.getElementById('askChat').style.display = 'none';
    document.getElementById('askPrompts').style.display = 'flex';
    renderSamplePrompts();
}

async function rateAskMessage(historyId, rating, button) {
    // Update UI
    const actions = button.closest('.ask-msg-actions');
    actions.querySelectorAll('.rating-btn').forEach(btn => btn.classList.remove('selected'));
    button.classList.add('selected');

    if (rating === 'positive') {
        try {
            await fetch(`${API_BASE_URL}/api/response-history/${historyId}/rate`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ rating, feedback: null })
            });
        } catch (e) {
            console.warn('Could not rate message:', e);
        }
        const ratingBtns = actions.querySelectorAll('.rating-btn');
        ratingBtns.forEach(btn => btn.remove());
        const conf = document.createElement('span');
        conf.className = 'rating-label';
        conf.style.fontSize = '0.75rem';
        conf.textContent = '👍 Thanks!';
        actions.appendChild(conf);
    } else {
        // Get the message text for context
        const msgDiv = button.closest('.ask-msg');
        const clone = msgDiv.cloneNode(true);
        const actionsClone = clone.querySelector('.ask-msg-actions');
        if (actionsClone) actionsClone.remove();
        const responseText = clone.textContent.trim();
        const lastUserMsg = askConversation.filter(m => m.role === 'user').slice(-1)[0];
        const inquiryText = lastUserMsg ? lastUserMsg.content : '';
        showFeedbackModal(historyId, inquiryText, responseText);
    }
}

// ==================== ASK LIGHTSPEED DEDICATED PAGE ====================
let alsListenersSetup = false;
let alsCurrentConversationId = null;
let alsKbEntries = []; // KB entries for current response (for citations)
let alsSidebarTab = 'my';

function initAskLightspeedPage() {
    loadAskConversation();

    if (askConversation.length > 0) {
        restoreAlsChat();
    } else {
        renderAlsSamplePrompts();
    }

    if (!alsListenersSetup) {
        alsListenersSetup = true;

        // Tone pills
        document.querySelectorAll('.als-tone').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.als-tone').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                askTone = btn.dataset.tone;
                saveAskConversation();
            });
        });

        // Send button
        document.getElementById('alsSendBtn').addEventListener('click', sendAlsMessage);

        // Input
        const alsInput = document.getElementById('alsInput');
        alsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAlsMessage();
            }
        });
        alsInput.addEventListener('input', () => {
            alsInput.style.height = 'auto';
            alsInput.style.height = Math.min(alsInput.scrollHeight, 120) + 'px';
        });

        // Sidebar toggle
        document.getElementById('alsSidebarToggle').addEventListener('click', toggleAlsSidebar);
        document.getElementById('alsSidebarOverlay').addEventListener('click', closeAlsSidebar);
        document.getElementById('alsSidebarNewBtn').addEventListener('click', () => {
            clearAlsChat();
            closeAlsSidebar();
        });

        // Sidebar search
        let alsSearchTimeout;
        document.getElementById('alsSidebarSearch').addEventListener('input', (e) => {
            clearTimeout(alsSearchTimeout);
            alsSearchTimeout = setTimeout(() => loadAlsSidebarContent(e.target.value), 300);
        });

        // Sidebar tabs
        document.querySelectorAll('.als-sidebar-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.als-sidebar-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                alsSidebarTab = tab.dataset.tab;
                loadAlsSidebarContent();
            });
        });
    }

    // Load sidebar conversations
    loadAlsSidebarContent();
}

// ===== SIDEBAR: Conversations, Team Activity, Shared Prompts =====

function toggleAlsSidebar() {
    const sidebar = document.getElementById('alsSidebar');
    const overlay = document.getElementById('alsSidebarOverlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible', sidebar.classList.contains('open'));
}

function closeAlsSidebar() {
    document.getElementById('alsSidebar').classList.remove('open');
    document.getElementById('alsSidebarOverlay').classList.remove('visible');
}

async function loadAlsSidebarContent(search) {
    const searchVal = search !== undefined ? search : (document.getElementById('alsSidebarSearch')?.value || '');
    const listEl = document.getElementById('alsSidebarList');
    if (!listEl) return;

    if (alsSidebarTab === 'my' || alsSidebarTab === 'team') {
        await loadAlsConversationsList(listEl, searchVal, alsSidebarTab === 'team');
    } else if (alsSidebarTab === 'prompts') {
        await loadAlsSharedPrompts(listEl, searchVal);
    }
}

async function loadAlsConversationsList(container, search, teamView) {
    try {
        let url = `${API_BASE_URL}/api/conversations?limit=50`;
        if (teamView) url += '&team=true';
        if (search) url += `&search=${encodeURIComponent(search)}`;

        const response = await fetch(url, { headers: getAuthHeaders() });
        if (!response.ok) {
            container.innerHTML = '<div class="als-sidebar-empty">Could not load conversations.</div>';
            return;
        }

        const data = await response.json();
        const conversations = data.conversations || [];

        if (conversations.length === 0) {
            container.innerHTML = `<div class="als-sidebar-empty">
                ${search ? 'No matching conversations.' : 'No saved conversations yet.<br>Start chatting and your conversations will be saved automatically.'}
            </div>`;
            return;
        }

        container.innerHTML = conversations.map(conv => {
            const date = new Date(conv.updated_at);
            const timeAgo = alsGetTimeAgo(date);
            const msgCount = conv.message_count || 0;
            const isActive = conv.id === alsCurrentConversationId;
            const teamLabel = teamView && conv.first_name ? `${escapeHtml(conv.first_name)} · ` : '';

            return `<div class="als-sidebar-item${isActive ? ' active' : ''}" data-conv-id="${conv.id}" onclick="loadAlsConversation('${conv.id}')">
                <div class="als-sidebar-item-title">${escapeHtml(conv.title || 'Untitled')}</div>
                <div class="als-sidebar-item-meta">
                    <span>${teamLabel}${msgCount} msgs</span>
                    <span>${timeAgo}</span>
                </div>
                ${!teamView ? `<button class="als-sidebar-item-delete" onclick="event.stopPropagation(); deleteAlsConversation('${conv.id}')" title="Delete">&#10005;</button>` : ''}
            </div>`;
        }).join('');
    } catch (e) {
        console.warn('Failed to load conversations:', e);
        container.innerHTML = '<div class="als-sidebar-empty">Failed to load.</div>';
    }
}

async function loadAlsSharedPrompts(container, search) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/shared-prompts?sort=popular`, { headers: getAuthHeaders() });
        if (!response.ok) {
            container.innerHTML = '<div class="als-sidebar-empty">Could not load prompts.</div>';
            return;
        }

        const data = await response.json();
        let prompts = data.prompts || [];

        if (search) {
            const s = search.toLowerCase();
            prompts = prompts.filter(p => p.title.toLowerCase().includes(s) || p.prompt_text.toLowerCase().includes(s));
        }

        if (prompts.length === 0) {
            container.innerHTML = `<div class="als-sidebar-empty">
                ${search ? 'No matching prompts.' : 'No shared prompts yet.<br>Save useful prompts to share with your team.'}
            </div>`;
            return;
        }

        container.innerHTML = prompts.map(p => {
            const author = p.first_name ? `${p.first_name} ${(p.last_name || '').charAt(0)}.` : 'Unknown';
            return `<div class="als-shared-prompt-item" onclick="useAlsSharedPrompt('${p.id}', this)" data-prompt="${escapeHtml(p.prompt_text)}">
                <div class="als-shared-prompt-title">${escapeHtml(p.title)}</div>
                <div class="als-shared-prompt-meta">${escapeHtml(author)} · Used ${p.usage_count || 0}x · ${escapeHtml(p.category || 'general')}</div>
            </div>`;
        }).join('');
    } catch (e) {
        console.warn('Failed to load shared prompts:', e);
        container.innerHTML = '<div class="als-sidebar-empty">Failed to load.</div>';
    }
}

function alsGetTimeAgo(date) {
    const now = new Date();
    const diff = (now - date) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function loadAlsConversation(convId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/conversations/${convId}`, { headers: getAuthHeaders() });
        if (!response.ok) return;

        const data = await response.json();
        const conv = data.conversation;

        alsCurrentConversationId = conv.id;
        askConversation = conv.messages || [];
        askTone = conv.tone || 'professional';
        saveAskConversation();

        // Restore tone pill
        document.querySelectorAll('.als-tone').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tone === askTone);
        });

        const messagesEl = document.getElementById('alsMessages');
        if (messagesEl) messagesEl.innerHTML = '';

        const chatArea = document.getElementById('alsChatArea');
        chatArea.style.display = 'block';
        const prompts = document.getElementById('alsPrompts');
        if (prompts) prompts.style.display = 'none';

        const hero = document.getElementById('alsHero');
        const caps = document.getElementById('alsCapabilities');
        if (hero) hero.style.display = 'none';
        if (caps) caps.style.display = 'none';

        if (conv.summary) {
            showAlsSummaryBanner(conv.summary);
        }

        askConversation.forEach(msg => {
            appendAlsMessage(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
        });

        updateAlsContextBar();

        document.querySelectorAll('.als-sidebar-item').forEach(el => {
            el.classList.toggle('active', el.dataset.convId === convId);
        });

        closeAlsSidebar();
    } catch (e) {
        console.warn('Failed to load conversation:', e);
    }
}

async function saveAlsConversationToServer() {
    if (askConversation.length === 0) return;

    try {
        if (alsCurrentConversationId) {
            await fetch(`${API_BASE_URL}/api/conversations/${alsCurrentConversationId}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ messages: askConversation, tone: askTone })
            });
        } else {
            const response = await fetch(`${API_BASE_URL}/api/conversations`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ messages: askConversation, tone: askTone })
            });
            if (response.ok) {
                const data = await response.json();
                alsCurrentConversationId = data.conversation.id;
            }
        }
    } catch (e) {
        console.warn('Failed to save conversation to server:', e);
    }
}

async function deleteAlsConversation(convId) {
    try {
        await fetch(`${API_BASE_URL}/api/conversations/${convId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (convId === alsCurrentConversationId) {
            clearAlsChat();
        }

        loadAlsSidebarContent();
    } catch (e) {
        console.warn('Failed to delete conversation:', e);
    }
}

function useAlsSharedPrompt(promptId, el) {
    const input = document.getElementById('alsInput');
    const promptText = el.dataset.prompt;
    // Decode HTML entities
    const tmp = document.createElement('textarea');
    tmp.innerHTML = promptText;
    input.value = tmp.value;
    input.focus();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';

    fetch(`${API_BASE_URL}/api/shared-prompts/${promptId}/use`, {
        method: 'POST',
        headers: getAuthHeaders()
    }).catch(() => {});

    closeAlsSidebar();
}

// ===== RESTORE CHAT =====

function restoreAlsChat() {
    if (askConversation.length === 0) return;

    const chatArea = document.getElementById('alsChatArea');
    const prompts = document.getElementById('alsPrompts');
    if (chatArea) chatArea.style.display = 'block';
    if (prompts) prompts.style.display = 'none';

    const hero = document.getElementById('alsHero');
    const caps = document.getElementById('alsCapabilities');
    if (hero) hero.style.display = 'none';
    if (caps) caps.style.display = 'none';

    document.querySelectorAll('.als-tone').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tone === askTone);
    });

    const messagesEl = document.getElementById('alsMessages');
    if (messagesEl) messagesEl.innerHTML = '';
    askConversation.forEach(msg => {
        appendAlsMessage(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
    });

    updateAlsContextBar();
}

function renderAlsSamplePrompts() {
    const container = document.getElementById('alsPrompts');
    if (!container) return;

    const shuffled = [...ASK_SAMPLE_PROMPTS].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 4);

    container.innerHTML = selected.map(prompt =>
        `<button class="als-prompt-chip" onclick="fillAlsPrompt(this)">${escapeHtml(prompt)}</button>`
    ).join('');
}

function fillAlsPrompt(el) {
    const input = document.getElementById('alsInput');
    input.value = el.textContent;
    input.focus();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}

// ===== SEND MESSAGE (with citations, teach mode, context mgmt) =====

async function sendAlsMessage() {
    const input = document.getElementById('alsInput');
    const message = input.value.trim();
    if (!message) return;

    const sendBtn = document.getElementById('alsSendBtn');
    sendBtn.disabled = true;

    const chatArea = document.getElementById('alsChatArea');
    chatArea.style.display = 'block';

    const prompts = document.getElementById('alsPrompts');
    if (prompts) prompts.style.display = 'none';

    const hero = document.getElementById('alsHero');
    const caps = document.getElementById('alsCapabilities');
    if (hero) hero.style.display = 'none';
    if (caps) caps.style.display = 'none';

    askConversation.push({ role: 'user', content: message });
    appendAlsMessage('user', message);
    saveAskConversation();

    input.value = '';
    input.style.height = 'auto';

    const messagesEl = document.getElementById('alsMessages');
    const typingEl = document.createElement('div');
    typingEl.className = 'als-typing';
    typingEl.id = 'alsTyping';
    typingEl.innerHTML = '<div class="als-typing-dot"></div><div class="als-typing-dot"></div><div class="als-typing-dot"></div>';
    messagesEl.appendChild(typingEl);
    chatArea.scrollTop = chatArea.scrollHeight;

    try {
        const toneDesc = askTone === 'professional' ? 'professional and helpful' :
                         askTone === 'friendly' ? 'warm, friendly, and conversational' :
                         'casual and relaxed';

        const orgName = currentUser?.organization?.name || 'your organization';

        // Build messages to send — include summary as context if available
        let messagesToSend = askConversation.map(m => ({ role: m.role, content: m.content }));

        const summaryBanner = document.querySelector('.als-summary-banner');
        if (summaryBanner && summaryBanner.dataset.summary) {
            messagesToSend = [
                { role: 'user', content: `[Context from earlier in our conversation: ${summaryBanner.dataset.summary}]` },
                { role: 'assistant', content: 'Understood, I have that context. How can I help?' },
                ...messagesToSend
            ];
        }

        const systemPrompt = `You are Lightspeed AI, a powerful, full-featured AI assistant built by Launchpad Solutions. You work for ${orgName}.

TONE: Respond in a ${toneDesc} tone.
${getLanguageInstruction()}
CORE BEHAVIOR — ALWAYS FOLLOW:
Before generating any content (emails, posts, documents, strategies, analyses, code, or anything substantial), you MUST first ask 2-3 clarifying questions to understand exactly what the user needs. This includes understanding context, audience, goals, constraints, and preferences. Only after the user answers should you produce the final output. This makes your work dramatically more accurate and tailored.

Exception: If the user's request is a simple factual question, a quick calculation, or a brief answer that doesn't require generation — answer directly without asking clarifying questions.

TEACH MODE: If the user says something like "remember that...", "our policy is...", "when someone asks about X, tell them Y", or similar knowledge-sharing statements, acknowledge what you've learned and confirm you'll remember it. Format your response to clearly state what knowledge was captured.

You are a fully capable AI assistant. You can help with absolutely anything:
- Drafting emails, social media posts, marketing content, and communications
- Charitable gaming, lotteries, raffles, AGCO rules, and nonprofit operations
- Customer service, donor relations, and response strategies
- Data analysis, spreadsheets, reporting, and business intelligence
- Writing, editing, proofreading, and content strategy
- Coding, technical questions, and troubleshooting
- Research, brainstorming, planning, and general knowledge
- Anything else the user asks — you are not limited in scope

Keep responses concise but thorough. Use markdown formatting when helpful.`;

        const ratedExamples = await getRatedExamples('ask_lightspeed', null, message);
        const feedbackSection = buildRatedExamplesContext(ratedExamples);
        const drawScheduleSection = getDrawScheduleContext();
        const fullSystemPrompt = systemPrompt + '\n\nKnowledge base:\n' + (drawScheduleSection ? '\n\n' + drawScheduleSection : '') + feedbackSection;

        const typing = document.getElementById('alsTyping');
        if (typing) typing.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = 'als-msg als-msg-ai';
        messagesEl.appendChild(msgDiv);

        // Reset KB entries for this response
        alsKbEntries = [];

        const { text: aiText, referencedKbEntries } = await fetchStream({
            system: fullSystemPrompt,
            inquiry: message,
            messages: messagesToSend,
            max_tokens: 4096
        }, {
            onText: (chunk) => {
                msgDiv._rawText = (msgDiv._rawText || '') + chunk;
                msgDiv.innerHTML = renderAlsMarkdownWithCitations(msgDiv._rawText, alsKbEntries);
                chatArea.scrollTop = chatArea.scrollHeight;
            },
            onKb: (entries) => {
                alsKbEntries = entries;
            }
        });

        askConversation.push({ role: 'assistant', content: aiText });
        saveAskConversation();

        // Final render with citations
        msgDiv.innerHTML = renderAlsMarkdownWithCitations(aiText, alsKbEntries);

        // Save to response history
        const lastUserMsg = askConversation.filter(m => m.role === 'user').slice(-1)[0];
        let askHistoryId = null;
        try {
            const histRes = await fetch(`${API_BASE_URL}/api/response-history`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    inquiry: lastUserMsg ? lastUserMsg.content : '',
                    response: aiText,
                    format: 'chat',
                    tone: askTone,
                    tool: 'ask_lightspeed'
                })
            });
            if (histRes.ok) {
                const histData = await histRes.json();
                askHistoryId = histData.entry.id;
            }
        } catch (e) {
            console.warn('Could not save ask history:', e);
        }

        // Add action buttons + refinement buttons + citation sources
        appendAlsEnhancedActions(msgDiv, askHistoryId, alsKbEntries);

        // Check for teach mode
        if (isTeachModeMessage(message)) {
            appendAlsTeachConfirm(msgDiv, message, aiText);
        }

        // Save conversation to server
        await saveAlsConversationToServer();

        // Refresh sidebar list
        loadAlsSidebarContent();

        // Update context bar
        updateAlsContextBar();

    } catch (error) {
        const typing = document.getElementById('alsTyping');
        if (typing) typing.remove();
        console.error('Ask Lightspeed error:', error);
        appendAlsMessage('ai', 'Sorry, I ran into an issue. Please try again.');
    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

// ===== KB CITATION RENDERING =====

function renderAlsMarkdownWithCitations(text, kbEntries) {
    let html = renderSimpleMarkdown(text);

    if (kbEntries && kbEntries.length > 0) {
        html = html.replace(/\[(\d+)\]/g, (match, num) => {
            const idx = parseInt(num);
            const entry = kbEntries.find(e => e.citation_index === idx);
            if (entry) {
                return `<span class="als-citation" title="${escapeHtml(entry.title)}" onclick="showAlsCitationDetail(${idx})">[${num}]</span>`;
            }
            return match;
        });
    }

    return html;
}

function showAlsCitationDetail(citationIndex) {
    const entry = alsKbEntries.find(e => e.citation_index === citationIndex);
    if (!entry) return;

    const sourcesPanel = document.querySelector('.als-sources-panel');
    if (sourcesPanel) {
        const sourceItem = sourcesPanel.querySelector(`[data-source="${citationIndex}"]`);
        if (sourceItem) {
            sourceItem.style.background = 'rgba(233, 30, 140, 0.06)';
            sourceItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => { sourceItem.style.background = ''; }, 2000);
        }
    }
}

function buildAlsSourcesPanel(kbEntries) {
    if (!kbEntries || kbEntries.length === 0) return '';

    const sources = kbEntries.map(entry =>
        `<div class="als-source-item" data-source="${entry.citation_index}">
            <span class="als-source-num">[${entry.citation_index}]</span>
            <span class="als-source-text">
                <strong>${escapeHtml(entry.title)}</strong>
                <span class="als-source-category">${escapeHtml(entry.category)}</span>
            </span>
        </div>`
    ).join('');

    return `<div class="als-sources-panel">
        <div class="als-sources-title">Sources</div>
        ${sources}
    </div>`;
}

// ===== ENHANCED ACTION BUTTONS (with refinements) =====

function appendAlsEnhancedActions(msgDiv, historyId, kbEntries) {
    // Sources panel
    if (kbEntries && kbEntries.length > 0) {
        const sourcesHtml = buildAlsSourcesPanel(kbEntries);
        const sourcesDiv = document.createElement('div');
        sourcesDiv.innerHTML = sourcesHtml;
        if (sourcesDiv.firstElementChild) {
            msgDiv.appendChild(sourcesDiv.firstElementChild);
        }
    }

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'als-msg-actions';
    let actionsHtml = `<button onclick="copyAlsMessage(this)">Copy</button>
        <button onclick="clearAlsChat()">New chat</button>
        <button onclick="showAlsSavePromptModal()">Save prompt</button>`;
    if (historyId) {
        actionsHtml += `
            <button class="rating-btn thumbs-up" onclick="rateAlsMessage('${historyId}', 'positive', this)" title="Good response">👍</button>
            <button class="rating-btn thumbs-down" onclick="rateAlsMessage('${historyId}', 'negative', this)" title="Needs improvement">👎</button>`;
    }
    actions.innerHTML = actionsHtml;
    msgDiv.appendChild(actions);

    // Refinement buttons
    const refinements = document.createElement('div');
    refinements.className = 'als-refinements';
    refinements.innerHTML = `
        <button class="als-refine-btn" onclick="sendAlsRefinement('Make it shorter and more concise')">Shorter</button>
        <button class="als-refine-btn" onclick="sendAlsRefinement('Make it longer with more detail')">Longer</button>
        <button class="als-refine-btn" onclick="sendAlsRefinement('Rewrite in a more formal, professional tone')">More formal</button>
        <button class="als-refine-btn" onclick="sendAlsRefinement('Rewrite in a more casual, friendly tone')">More casual</button>
        <button class="als-refine-btn" onclick="sendAlsRefinement('Convert this into bullet points')">Bullet points</button>
        <button class="als-refine-btn" onclick="sendAlsRefinement('Generate 2 alternative versions with different angles')">Alternatives</button>`;
    msgDiv.appendChild(refinements);
}

function sendAlsRefinement(instruction) {
    const input = document.getElementById('alsInput');
    input.value = instruction;
    sendAlsMessage();
}

// ===== TEACH MODE =====

function isTeachModeMessage(message) {
    const lc = message.toLowerCase();
    const teachPatterns = [
        'remember that', 'remember this', 'our policy is', 'our policy on',
        'when someone asks about', 'when people ask', 'the answer to',
        'always tell them', 'never say', 'important: ', 'note that',
        'for reference,', 'fyi:', 'keep in mind', 'going forward,'
    ];
    return teachPatterns.some(p => lc.includes(p));
}

function appendAlsTeachConfirm(msgDiv, userMessage, aiResponse) {
    const confirm = document.createElement('div');
    confirm.className = 'als-teach-confirm';
    confirm.dataset.teachMsg = userMessage;
    confirm.innerHTML = `
        <div class="als-teach-confirm-text">Save this to your organization's knowledge base so Lightspeed always remembers?</div>
        <div class="als-teach-confirm-actions">
            <button class="als-teach-save" onclick="saveAlsTeachToKB(this)">Save to Knowledge Base</button>
            <button onclick="this.closest('.als-teach-confirm').remove()">Dismiss</button>
        </div>`;
    msgDiv.appendChild(confirm);
}

async function saveAlsTeachToKB(btn) {
    const confirmDiv = btn.closest('.als-teach-confirm');
    const userMessage = confirmDiv.dataset.teachMsg;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const title = userMessage.length > 80 ? userMessage.substring(0, 80) + '...' : userMessage;

        const response = await fetch(`${API_BASE_URL}/api/knowledge-base`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                title: title,
                content: userMessage,
                category: 'policies',
                tags: ['source:teach_mode']
            })
        });

        if (response.ok) {
            confirmDiv.innerHTML = '<div style="font-size: 0.8rem; color: #059669; font-weight: 600; padding: 4px 0;">Saved to knowledge base! Lightspeed will remember this.</div>';
            setTimeout(() => confirmDiv.remove(), 3000);
        } else {
            throw new Error('Failed to save');
        }
    } catch (e) {
        console.warn('Failed to save to KB:', e);
        confirmDiv.innerHTML = '<div style="font-size: 0.8rem; color: #dc2626; padding: 4px 0;">Failed to save. Please try again or add manually in Knowledge Base.</div>';
    }
}

// ===== CONTEXT WINDOW MANAGEMENT =====

function updateAlsContextBar() {
    const barEl = document.getElementById('alsContextBar');
    if (!barEl) return;

    const msgCount = askConversation.length;
    const CONTEXT_THRESHOLD = 16;

    if (msgCount >= CONTEXT_THRESHOLD) {
        barEl.style.display = 'block';
        barEl.innerHTML = `<div class="als-context-bar">
            <span class="als-context-bar-text"><strong>${msgCount} messages</strong> in this conversation. Summarize older messages to keep responses sharp.</span>
            <button onclick="summarizeAlsConversation()">Summarize</button>
        </div>`;
    } else {
        barEl.style.display = 'none';
        barEl.innerHTML = '';
    }
}

async function summarizeAlsConversation() {
    if (!alsCurrentConversationId) {
        await saveAlsConversationToServer();
    }

    if (!alsCurrentConversationId) return;

    const barEl = document.getElementById('alsContextBar');
    if (barEl) {
        barEl.innerHTML = '<div class="als-context-bar"><span class="als-context-bar-text">Summarizing conversation...</span></div>';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/conversations/${alsCurrentConversationId}/summarize`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ keepRecent: 6 })
        });

        if (!response.ok) throw new Error('Failed to summarize');

        const data = await response.json();

        if (data.summarized) {
            askConversation = data.messages;
            saveAskConversation();

            const messagesEl = document.getElementById('alsMessages');
            if (messagesEl) messagesEl.innerHTML = '';

            showAlsSummaryBanner(data.summary);

            askConversation.forEach(msg => {
                appendAlsMessage(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
            });

            if (barEl) {
                barEl.style.display = 'none';
                barEl.innerHTML = '';
            }
        }
    } catch (e) {
        console.warn('Failed to summarize:', e);
        if (barEl) {
            barEl.innerHTML = '<div class="als-context-bar"><span class="als-context-bar-text">Could not summarize. Try again later.</span></div>';
        }
    }
}

function showAlsSummaryBanner(summary) {
    const messagesEl = document.getElementById('alsMessages');
    if (!messagesEl) return;

    const existing = messagesEl.querySelector('.als-summary-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'als-summary-banner';
    banner.dataset.summary = summary;
    banner.innerHTML = `<strong>Earlier in this conversation:</strong><br>${escapeHtml(summary)}`;
    messagesEl.insertBefore(banner, messagesEl.firstChild);
}

// ===== SHARED PROMPT SAVE MODAL =====

function showAlsSavePromptModal() {
    const lastUserMsg = askConversation.filter(m => m.role === 'user').slice(-1)[0];
    if (!lastUserMsg) return;

    const modal = document.createElement('div');
    modal.className = 'als-save-prompt-modal';
    modal.id = 'alsSavePromptModal';
    modal.innerHTML = `
        <div class="als-save-prompt-content">
            <h3>Save as Shared Prompt</h3>
            <input type="text" id="alsSavePromptTitle" placeholder="Give this prompt a name...">
            <select id="alsSavePromptCategory">
                <option value="general">General</option>
                <option value="emails">Emails</option>
                <option value="social_media">Social Media</option>
                <option value="customer_service">Customer Service</option>
                <option value="marketing">Marketing</option>
                <option value="fundraising">Fundraising</option>
            </select>
            <div style="font-size: 0.8rem; color: var(--text-muted); background: var(--bg-alt); border-radius: 8px; padding: 10px; margin-bottom: 8px; max-height: 80px; overflow-y: auto;">${escapeHtml(lastUserMsg.content)}</div>
            <div class="als-save-prompt-actions">
                <button onclick="closeAlsSavePromptModal()">Cancel</button>
                <button class="als-save-btn-primary" onclick="saveAlsSharedPrompt()">Save</button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAlsSavePromptModal();
    });
}

function closeAlsSavePromptModal() {
    const modal = document.getElementById('alsSavePromptModal');
    if (modal) modal.remove();
}

async function saveAlsSharedPrompt() {
    const title = document.getElementById('alsSavePromptTitle').value.trim();
    const category = document.getElementById('alsSavePromptCategory').value;
    const lastUserMsg = askConversation.filter(m => m.role === 'user').slice(-1)[0];

    if (!title) {
        document.getElementById('alsSavePromptTitle').style.borderColor = '#dc2626';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/shared-prompts`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                title,
                prompt_text: lastUserMsg.content,
                category
            })
        });

        if (response.ok) {
            closeAlsSavePromptModal();
            if (typeof showToast === 'function') {
                showToast('Prompt saved! Your team can now use it.', 'success');
            }
        }
    } catch (e) {
        console.warn('Failed to save shared prompt:', e);
    }
}

// ===== MESSAGE RENDERING =====

function appendAlsMessage(role, text, historyId) {
    const messagesEl = document.getElementById('alsMessages');
    const chatArea = document.getElementById('alsChatArea');
    const msgDiv = document.createElement('div');
    msgDiv.className = `als-msg als-msg-${role}`;

    if (role === 'ai') {
        msgDiv.innerHTML = renderAlsMarkdownWithCitations(text, []);

        const actions = document.createElement('div');
        actions.className = 'als-msg-actions';
        let actionsHtml = `<button onclick="copyAlsMessage(this)">Copy</button>
            <button onclick="clearAlsChat()">New chat</button>`;
        if (historyId) {
            actionsHtml += `
                <button class="rating-btn thumbs-up" onclick="rateAlsMessage('${historyId}', 'positive', this)" title="Good response">👍</button>
                <button class="rating-btn thumbs-down" onclick="rateAlsMessage('${historyId}', 'negative', this)" title="Needs improvement">👎</button>`;
        }
        actions.innerHTML = actionsHtml;
        msgDiv.appendChild(actions);
    } else {
        msgDiv.textContent = text;
    }

    messagesEl.appendChild(msgDiv);
    chatArea.scrollTop = chatArea.scrollHeight;
}

function appendAlsMessageActions(msgDiv, historyId) {
    const actions = document.createElement('div');
    actions.className = 'als-msg-actions';
    let actionsHtml = `<button onclick="copyAlsMessage(this)">Copy</button>
        <button onclick="clearAlsChat()">New chat</button>`;
    if (historyId) {
        actionsHtml += `
            <button class="rating-btn thumbs-up" onclick="rateAlsMessage('${historyId}', 'positive', this)" title="Good response">👍</button>
            <button class="rating-btn thumbs-down" onclick="rateAlsMessage('${historyId}', 'negative', this)" title="Needs improvement">👎</button>`;
    }
    actions.innerHTML = actionsHtml;
    msgDiv.appendChild(actions);
}

function copyAlsMessage(btn) {
    const msgDiv = btn.closest('.als-msg');
    const clone = msgDiv.cloneNode(true);
    const actions = clone.querySelector('.als-msg-actions');
    if (actions) actions.remove();
    const refinements = clone.querySelector('.als-refinements');
    if (refinements) refinements.remove();
    const sources = clone.querySelector('.als-sources-panel');
    if (sources) sources.remove();
    const teach = clone.querySelector('.als-teach-confirm');
    if (teach) teach.remove();
    const text = clone.textContent.trim();
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
}

function clearAlsChat() {
    askConversation = [];
    alsCurrentConversationId = null;
    alsKbEntries = [];
    saveAskConversation();
    document.getElementById('alsMessages').innerHTML = '';
    document.getElementById('alsChatArea').style.display = 'none';
    document.getElementById('alsPrompts').style.display = 'flex';

    const hero = document.getElementById('alsHero');
    const caps = document.getElementById('alsCapabilities');
    if (hero) hero.style.display = '';
    if (caps) caps.style.display = '';

    const barEl = document.getElementById('alsContextBar');
    if (barEl) { barEl.style.display = 'none'; barEl.innerHTML = ''; }

    renderAlsSamplePrompts();
}

async function rateAlsMessage(historyId, rating, button) {
    const actions = button.closest('.als-msg-actions');
    actions.querySelectorAll('.rating-btn').forEach(btn => btn.classList.remove('selected'));
    button.classList.add('selected');

    if (rating === 'positive') {
        try {
            await fetch(`${API_BASE_URL}/api/response-history/${historyId}/rate`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ rating, feedback: null })
            });
        } catch (e) {
            console.warn('Could not rate message:', e);
        }
        const ratingBtns = actions.querySelectorAll('.rating-btn');
        ratingBtns.forEach(btn => btn.remove());
        const conf = document.createElement('span');
        conf.className = 'rating-label';
        conf.style.fontSize = '0.75rem';
        conf.textContent = '👍 Thanks!';
        actions.appendChild(conf);
    } else {
        const msgDiv = button.closest('.als-msg');
        const clone = msgDiv.cloneNode(true);
        const actionsClone = clone.querySelector('.als-msg-actions');
        if (actionsClone) actionsClone.remove();
        const responseText = clone.textContent.trim();
        const lastUserMsg = askConversation.filter(m => m.role === 'user').slice(-1)[0];
        const inquiryText = lastUserMsg ? lastUserMsg.content : '';
        showFeedbackModal(historyId, inquiryText, responseText);
    }
}

// Make functions globally accessible
window.fillAlsPrompt = fillAlsPrompt;
window.copyAlsMessage = copyAlsMessage;
window.clearAlsChat = clearAlsChat;
window.rateAlsMessage = rateAlsMessage;
window.loadAlsConversation = loadAlsConversation;
window.deleteAlsConversation = deleteAlsConversation;
window.useAlsSharedPrompt = useAlsSharedPrompt;
window.sendAlsRefinement = sendAlsRefinement;
window.saveAlsTeachToKB = saveAlsTeachToKB;
window.summarizeAlsConversation = summarizeAlsConversation;
window.showAlsCitationDetail = showAlsCitationDetail;
window.showAlsSavePromptModal = showAlsSavePromptModal;
window.closeAlsSavePromptModal = closeAlsSavePromptModal;
window.saveAlsSharedPrompt = saveAlsSharedPrompt;

// Email/password auth removed - Google OAuth only

function loginUser(user, showMessage = true) {
    currentUser = user;
    localStorage.setItem("lightspeed_current_user", user.id);

    // Load user's data
    loadUserData(user);

    // Update UI (defensive against missing name)
    const displayName = user.name || user.email || "User";
    document.getElementById("userAvatar").textContent = displayName.charAt(0).toUpperCase();
    document.getElementById("userName").textContent = displayName.split(" ")[0];

    // Hide auth pages, show tool menu
    document.getElementById("landingPage").classList.add("hidden");
    document.getElementById("loginPage").classList.remove("visible");

    // Check if user was trying to reach a specific page before login
    const hadRedirect = handlePostLoginRedirect();
    if (!hadRedirect) {
        // Check if there's an initial path from page load (e.g. browser refresh on /list-normalizer)
        const initialPath = window._initialPath;
        const route = initialPath ? ROUTES[initialPath] : null;
        if (route && route.view === 'tool') {
            _routerNavigating = true;
            openTool(route.tool);
            if (route.page) switchPage(route.page);
            if (route.subTool) openNormalizerSubTool(route.subTool);
            _routerNavigating = false;
            history.replaceState({ path: initialPath }, '', initialPath);
        } else if (route && route.view === 'dashboard') {
            showToolMenu();
        } else {
            showToolMenu();
        }
    }

    // Setup main app event listeners if not already done
    setupEventListeners();

    // Load settings into forms
    loadSettings();

    // Initialize pages
    updateKnowledgeStats();
    renderKnowledgeList();
    updateAnalytics();
    renderFavorites();

    // Initialize admin dashboard (checks super admin status)
    if (typeof initAdminDashboard === 'function') {
        initAdminDashboard();
    }

    if (showMessage) {
        showToast(`Welcome back, ${user.name.split(" ")[0]}!`, "success");
    }

    // Process any pending invite token after login
    processPendingInvite();

    // Check if user selected a plan from the pricing page before signing in
    const selectedPlan = localStorage.getItem('selectedPlan');
    if (selectedPlan) {
        localStorage.removeItem('selectedPlan');
        startCheckout(selectedPlan);
    }

    // Check for post-checkout messages (e.g. ?checkout=success in URL)
    checkPostCheckoutMessage();
}

function loadUserData(user) {
    // Defensive: ensure nested objects exist (guards against corrupted localStorage)
    if (!user.settings) user.settings = {};
    if (!user.data) user.data = {};

    defaultName = user.settings.defaultName || (user.name ? user.name.split(" ")[0] : "User");
    orgName = user.settings.orgName || "";
    responseLanguage = user.settings.responseLanguage || "en";
    customKnowledge = user.data.customKnowledge || [];
    feedbackList = user.data.feedbackList || [];
    responseHistory = user.data.responseHistory || [];
    favorites = user.data.favorites || [];

    // Load data from backend and merge with local
    loadKnowledgeFromBackend();
    loadDrawScheduleFromBackend();
    loadContentTemplatesFromBackend();
    loadFavoritesFromBackend();
    loadResponseHistoryFromBackend();
}

async function loadKnowledgeFromBackend() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/knowledge-base`, {
            headers: getAuthHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            const backendEntries = (data.entries || []).map(entry => {
                // Extract lottery and keywords from tags
                const tags = entry.tags || [];
                const lotteryTag = tags.find(t => t.startsWith('lottery:'));
                const keywordTags = tags.filter(t => t.startsWith('keyword:')).map(t => t.replace('keyword:', ''));

                return {
                    id: entry.id,
                    lottery: lotteryTag ? lotteryTag.replace('lottery:', '') : 'both',
                    category: entry.category,
                    question: entry.title,
                    keywords: keywordTags.length > 0 ? keywordTags : [],
                    response: entry.content,
                    tags: tags,
                    dateAdded: entry.created_at
                };
            });

            // Merge: backend entries take priority, add any local-only entries
            const backendIds = new Set(backendEntries.map(e => e.id));
            const localOnly = customKnowledge.filter(k => !backendIds.has(k.id));
            customKnowledge = [...backendEntries, ...localOnly];

            // Update localStorage to stay in sync
            saveUserData();
            updateKnowledgeStats();
            renderKnowledgeList();
        }
    } catch (error) {
        console.warn('Could not load KB from backend, using localStorage:', error);
    }
}

async function loadDrawScheduleFromBackend() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/draw-schedules/active`, {
            headers: getAuthHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            if (data.schedule) {
                orgDrawSchedule = data.schedule;
                displayActiveSchedule(data.schedule);
            } else {
                orgDrawSchedule = null;
                displayNoSchedule();
            }
        }
    } catch (error) {
        console.warn('Could not load draw schedule from backend:', error);
    }
}

async function loadContentTemplatesFromBackend() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/content-templates`, {
            headers: getAuthHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            orgContentTemplates = data.templates || [];
        }
    } catch (error) {
        console.warn('Could not load content templates from backend:', error);
    }
}

function displayActiveSchedule(schedule) {
    const activeDisplay = document.getElementById('activeScheduleDisplay');
    const noDisplay = document.getElementById('noScheduleDisplay');
    const editForm = document.getElementById('scheduleEditForm');
    if (!activeDisplay) return;

    activeDisplay.style.display = 'block';
    if (noDisplay) noDisplay.style.display = 'none';
    if (editForm) editForm.style.display = 'none';

    document.getElementById('activeScheduleName').textContent = schedule.draw_name;
    document.getElementById('activeScheduleUpdated').textContent = 'Updated ' + new Date(schedule.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    let details = '';
    if (schedule.grand_prize_date) {
        const gpd = new Date(schedule.grand_prize_date);
        details += `<div>Grand Prize: ${gpd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${gpd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
        if (schedule.guaranteed_prize) details += ` — ${schedule.guaranteed_prize}`;
        details += `</div>`;
    }
    if (schedule.ticket_sales_end) {
        const tse = new Date(schedule.ticket_sales_end);
        details += `<div>Ticket Sales End: ${tse.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${tse.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>`;
    }
    const earlyBirds = typeof schedule.early_birds === 'string' ? JSON.parse(schedule.early_birds) : (schedule.early_birds || []);
    if (earlyBirds.length > 0) {
        details += `<div style="margin-top: 0.35rem;">Early Birds: ${earlyBirds.length} draw${earlyBirds.length !== 1 ? 's' : ''} scheduled</div>`;
    }
    document.getElementById('activeScheduleDetails').innerHTML = details;
}

function displayNoSchedule() {
    const activeDisplay = document.getElementById('activeScheduleDisplay');
    const noDisplay = document.getElementById('noScheduleDisplay');
    if (activeDisplay) activeDisplay.style.display = 'none';
    if (noDisplay) noDisplay.style.display = 'block';
}

async function handleDrawScheduleUpload(input) {
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    const progress = document.getElementById('scheduleUploadProgress');
    const noDisplay = document.getElementById('noScheduleDisplay');

    noDisplay.style.display = 'none';
    progress.style.display = 'block';

    try {
        const formData = new FormData();
        formData.append('document', file);

        const response = await fetch(`${API_BASE_URL}/api/draw-schedules/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: formData
        });

        progress.style.display = 'none';

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Upload failed');
        }

        const data = await response.json();
        orgDrawSchedule = data.schedule;
        displayActiveSchedule(data.schedule);
        showToast('Draw schedule uploaded and parsed!', 'success');

    } catch (error) {
        progress.style.display = 'none';
        noDisplay.style.display = 'block';
        console.error('Draw schedule upload error:', error);
        showToast('Failed to parse schedule: ' + error.message, 'error');
    }

    // Reset the file input
    input.value = '';
}

async function handleDrawSchedulePaste() {
    const textarea = document.getElementById('drawSchedulePasteInput');
    const text = textarea.value.trim();
    if (!text) {
        showToast('Please paste your draw schedule text first', 'error');
        return;
    }

    const progress = document.getElementById('scheduleUploadProgress');
    const noDisplay = document.getElementById('noScheduleDisplay');
    const btn = document.getElementById('parseScheduleTextBtn');

    noDisplay.style.display = 'none';
    progress.style.display = 'block';
    btn.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/draw-schedules/upload`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ text: text })
        });

        progress.style.display = 'none';
        btn.disabled = false;

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Parse failed');
        }

        const data = await response.json();
        orgDrawSchedule = data.schedule;
        displayActiveSchedule(data.schedule);
        textarea.value = '';
        showToast('Draw schedule parsed and saved!', 'success');

    } catch (error) {
        progress.style.display = 'none';
        noDisplay.style.display = 'block';
        btn.disabled = false;
        console.error('Draw schedule parse error:', error);
        showToast('Failed to parse schedule: ' + error.message, 'error');
    }
}

function toggleEditSchedule() {
    if (!orgDrawSchedule) return;
    const editForm = document.getElementById('scheduleEditForm');
    const activeDisplay = document.getElementById('activeScheduleDisplay');

    editForm.style.display = 'block';
    activeDisplay.style.display = 'none';

    // Populate form
    document.getElementById('editDrawName').value = orgDrawSchedule.draw_name || '';
    document.getElementById('editGuaranteedPrize').value = orgDrawSchedule.guaranteed_prize || '';
    document.getElementById('editPrizeDescription').value = orgDrawSchedule.prize_description || '';

    if (orgDrawSchedule.grand_prize_date) {
        document.getElementById('editGrandPrizeDate').value = toLocalDatetimeValue(orgDrawSchedule.grand_prize_date);
    }
    if (orgDrawSchedule.ticket_sales_start) {
        document.getElementById('editTicketSalesStart').value = toLocalDatetimeValue(orgDrawSchedule.ticket_sales_start);
    }
    if (orgDrawSchedule.ticket_sales_end) {
        document.getElementById('editTicketSalesEnd').value = toLocalDatetimeValue(orgDrawSchedule.ticket_sales_end);
    }

    // Populate early birds
    const container = document.getElementById('editEarlyBirdsContainer');
    container.innerHTML = '';
    const earlyBirds = typeof orgDrawSchedule.early_birds === 'string' ? JSON.parse(orgDrawSchedule.early_birds) : (orgDrawSchedule.early_birds || []);
    earlyBirds.forEach(eb => addEarlyBirdRow(eb));
}

function toLocalDatetimeValue(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addEarlyBirdRow(eb = {}) {
    const container = document.getElementById('editEarlyBirdsContainer');
    const row = document.createElement('div');
    row.className = 'early-bird-edit-row';
    row.innerHTML = `
        <input type="text" placeholder="#" value="${eb.number || ''}" style="width:50px" data-field="number">
        <input type="date" value="${eb.date || ''}" data-field="date">
        <input type="text" placeholder="Prize" value="${eb.prize || ''}" data-field="prize">
        <input type="text" placeholder="Day" value="${eb.day || ''}" data-field="day">
        <input type="number" placeholder="Qty" value="${eb.quantity || 1}" min="1" data-field="quantity">
        <button type="button" class="eb-remove-btn" onclick="this.parentElement.remove()">&times;</button>
    `;
    container.appendChild(row);
}

function cancelEditSchedule() {
    document.getElementById('scheduleEditForm').style.display = 'none';
    if (orgDrawSchedule) {
        displayActiveSchedule(orgDrawSchedule);
    } else {
        displayNoSchedule();
    }
}

async function saveDrawScheduleEdits() {
    if (!orgDrawSchedule) return;

    // Collect early birds from the edit rows
    const earlyBirdRows = document.querySelectorAll('#editEarlyBirdsContainer .early-bird-edit-row');
    const earlyBirds = Array.from(earlyBirdRows).map(row => ({
        number: row.querySelector('[data-field="number"]').value,
        date: row.querySelector('[data-field="date"]').value,
        prize: row.querySelector('[data-field="prize"]').value,
        day: row.querySelector('[data-field="day"]').value,
        quantity: parseInt(row.querySelector('[data-field="quantity"]').value) || 1
    })).filter(eb => eb.date); // only keep rows with a date

    const payload = {
        drawName: document.getElementById('editDrawName').value.trim(),
        grandPrizeDate: document.getElementById('editGrandPrizeDate').value || null,
        ticketSalesStart: document.getElementById('editTicketSalesStart').value || null,
        ticketSalesEnd: document.getElementById('editTicketSalesEnd').value || null,
        guaranteedPrize: document.getElementById('editGuaranteedPrize').value.trim() || null,
        prizeDescription: document.getElementById('editPrizeDescription').value.trim() || null,
        earlyBirds: earlyBirds
    };

    try {
        const response = await fetch(`${API_BASE_URL}/api/draw-schedules/${orgDrawSchedule.id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to save');
        }

        const data = await response.json();
        orgDrawSchedule = data.schedule;
        displayActiveSchedule(data.schedule);
        document.getElementById('scheduleEditForm').style.display = 'none';
        showToast('Draw schedule updated!', 'success');
    } catch (error) {
        console.error('Save draw schedule error:', error);
        showToast('Failed to save: ' + error.message, 'error');
    }
}

async function deleteDrawSchedule() {
    if (!orgDrawSchedule) return;
    if (!confirm('Remove this draw schedule? The AI tools will fall back to the default schedule.')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/draw-schedules/${orgDrawSchedule.id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to delete');
        }

        orgDrawSchedule = null;
        displayNoSchedule();
        showToast('Draw schedule removed', 'success');
    } catch (error) {
        console.error('Delete draw schedule error:', error);
        showToast('Failed to remove schedule: ' + error.message, 'error');
    }
}

async function loadFavoritesFromBackend() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/favorites`, {
            headers: getAuthHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            const backendEntries = (data.entries || []).map(entry => ({
                id: entry.id,
                title: entry.title,
                inquiry: entry.inquiry,
                response: entry.response,
                dateAdded: entry.created_at
            }));

            // Merge: backend entries take priority
            const backendIds = new Set(backendEntries.map(e => e.id));
            const localOnly = favorites.filter(f => !backendIds.has(f.id));
            favorites = [...backendEntries, ...localOnly];

            saveUserData();
            renderFavorites();
        }
    } catch (error) {
        console.warn('Could not load favorites from backend:', error);
    }
}

async function loadResponseHistoryFromBackend() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/response-history`, {
            headers: getAuthHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            const backendEntries = (data.entries || []).map(entry => ({
                id: entry.id,
                backendId: entry.id,
                inquiry: entry.inquiry,
                response: entry.response,
                staffName: `${entry.first_name || ''} ${entry.last_name || ''}`.trim() || 'Unknown',
                category: entry.format || 'email',
                timestamp: entry.created_at,
                responseTime: 0,
                rating: entry.rating || null
            }));

            // Merge: backend entries take priority, keep local-only entries
            const backendIds = new Set(backendEntries.map(e => e.id));
            const localOnly = responseHistory.filter(h => !backendIds.has(h.id) && !backendIds.has(h.backendId));
            responseHistory = [...backendEntries, ...localOnly];

            // Sort by timestamp descending
            responseHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            // Cap at 500
            if (responseHistory.length > 500) responseHistory = responseHistory.slice(0, 500);

            saveUserData();
        }
    } catch (error) {
        console.warn('Could not load response history from backend:', error);
    }
}

function saveUserData() {
    if (!currentUser) return;

    // Update user object
    currentUser.settings.defaultName = defaultName;
    currentUser.settings.orgName = orgName;
    currentUser.settings.responseLanguage = responseLanguage;
    currentUser.data.customKnowledge = customKnowledge;
    currentUser.data.feedbackList = feedbackList;
    currentUser.data.responseHistory = responseHistory;
    currentUser.data.favorites = favorites;

    // Save to localStorage
    const userIndex = users.findIndex(u => u.id === currentUser.id);
    if (userIndex >= 0) {
        users[userIndex] = currentUser;
        localStorage.setItem("lightspeed_users", JSON.stringify(users));
    }
}

function handleLogout() {
    // Save any pending data
    saveUserData();

    // Clear current user
    currentUser = null;
    currentTool = null;
    localStorage.removeItem("lightspeed_current_user");

    // Reset state
    defaultName = "Bella";
    orgName = "";
    customKnowledge = [];
    feedbackList = [];
    responseHistory = [];
    favorites = [];

    // Hide all app pages
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("dataAnalysisApp").classList.remove("visible");
    document.getElementById("draftAssistantApp").classList.remove("visible");
    document.getElementById("listNormalizerApp").classList.remove("visible");
    document.getElementById("toolMenuPage").classList.remove("visible", "with-sidebar");

    // Show landing page (marketing page)
    document.getElementById("landingPage").classList.remove("hidden");

    pushRoute('/');
    showToast("You've been signed out", "success");
}

function toggleUserDropdown() {
    document.getElementById("userDropdown").classList.toggle("show");
}

function closeUserDropdown() {
    document.getElementById("userDropdown").classList.remove("show");
}

function generateUserId() {
    return 'user_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function loadSettings() {
    const defaultNameEl = document.getElementById("defaultName");
    const staffNameEl = document.getElementById("staffName");
    const orgNameEl = document.getElementById("orgName");

    if (defaultNameEl && defaultName) {
        defaultNameEl.value = defaultName;
    }
    if (staffNameEl && defaultName) {
        staffNameEl.value = defaultName;
    }
    if (orgNameEl && orgName) {
        orgNameEl.value = orgName;
    }
    const langEl = document.getElementById("responseLanguage");
    if (langEl) {
        langEl.value = responseLanguage || 'en';
    }
}

let eventListenersSetup = false;

function setupEventListeners() {
    // Prevent double-binding
    if (eventListenersSetup) return;
    eventListenersSetup = true;

    // Navigation - tool switching buttons in sidebar (skip dashboard, handled separately)
    document.querySelectorAll(".sidebar-btn[data-tool]").forEach(btn => {
        if (btn.dataset.tool === 'dashboard') return;
        btn.addEventListener("click", () => {
            openTool(btn.dataset.tool);
            closeSidebar(); // Close mobile sidebar after tool switch
        });
    });

    // Navigation - page switching buttons in sidebar (Response Assistant sub-pages)
    document.querySelectorAll(".sidebar-btn[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
            // Ensure we're on the Response Assistant if clicking a page button
            if (currentTool !== 'customer-response') {
                openTool('customer-response');
            }
            switchPage(btn.dataset.page);
        });
    });

    // Sidebar toggle for mobile - all toggle buttons (including dashboard)
    ["sidebarToggle", "dataSidebarToggle", "draftSidebarToggle", "listNormalizerSidebarToggle", "dashboardSidebarToggle", "ropSidebarToggle"].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener("click", toggleSidebar);
    });

    // Dashboard button in sidebar
    const dashboardBtn = document.getElementById("sidebarDashboardBtn");
    if (dashboardBtn) {
        dashboardBtn.addEventListener("click", () => {
            goBackToMenu();
        });
    }

    // Create overlay for mobile sidebar
    if (!document.getElementById("sidebarOverlay")) {
        const overlay = document.createElement("div");
        overlay.id = "sidebarOverlay";
        overlay.className = "sidebar-overlay";
        overlay.addEventListener("click", closeSidebar);
        document.body.appendChild(overlay);
    }

    // Sidebar header click - go to generator page
    const sidebarHeader = document.querySelector(".sidebar-header");
    if (sidebarHeader) {
        sidebarHeader.style.cursor = "pointer";
        sidebarHeader.addEventListener("click", () => switchPage("response"));
    }

    // Response Generator
    document.getElementById("generateBtn").addEventListener("click", handleGenerate);
    document.getElementById("customerEmail").addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleGenerate();
    });

    // Smart suggestions
    document.querySelectorAll(".suggestion-chip:not(.instruction-chip)").forEach(chip => {
        chip.addEventListener("click", () => {
            document.getElementById("customerEmail").value = SUGGESTION_TEMPLATES[chip.dataset.template];
        });
    });

    // Instruction chips — append to agent instructions field
    document.querySelectorAll(".instruction-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const field = document.getElementById("agentInstructions");
            const current = field.value.trim();
            const instruction = chip.dataset.instruction;
            field.value = current ? current + ". " + instruction : instruction;
            field.focus();
        });
    });

    // Inquiry type toggle (Email vs Facebook)
    document.getElementById("toggleEmail").addEventListener("click", () => setInquiryType("email"));
    document.getElementById("toggleFacebook").addEventListener("click", () => setInquiryType("facebook"));

    // Initialize draw schedule display
    renderDrawSchedule();

    // Settings
    document.getElementById("settingsToggle").addEventListener("click", () =>
        document.getElementById("settingsModal").classList.add("show"));
    document.getElementById("closeSettings").addEventListener("click", () =>
        document.getElementById("settingsModal").classList.remove("show"));
    document.getElementById("saveSettings").addEventListener("click", saveSettings);
    document.getElementById("settingsModal").addEventListener("click", (e) => {
        if (e.target.id === "settingsModal")
            document.getElementById("settingsModal").classList.remove("show");
    });

    // Knowledge
    document.getElementById("addKnowledgeBtn").addEventListener("click", addKnowledge);
    document.getElementById("knowledgeSearchInput").addEventListener("input", (e) => {
        renderKnowledgeList(e.target.value);
    });
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentFilter = btn.dataset.filter;
            renderKnowledgeList();
        });
    });
    document.getElementById("importKnowledgeBtn").addEventListener("click", () =>
        document.getElementById("importModal").classList.add("show"));
    document.getElementById("closeImportModal").addEventListener("click", () =>
        document.getElementById("importModal").classList.remove("show"));
    document.getElementById("parseImportBtn").addEventListener("click", parseAndImportKnowledge);

    // Feedback
    document.getElementById("submitFeedbackBtn").addEventListener("click", submitFeedback);

    // Team Management
    const sendInviteBtn = document.getElementById("sendInviteBtn");
    if (sendInviteBtn) {
        sendInviteBtn.addEventListener("click", sendInvitation);
    }
    const saveOrgProfileBtn = document.getElementById("saveOrgProfileBtn");
    if (saveOrgProfileBtn) {
        saveOrgProfileBtn.addEventListener("click", saveOrgProfile);
    }
    const inviteEmailInput = document.getElementById("inviteEmail");
    if (inviteEmailInput) {
        inviteEmailInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                sendInvitation();
            }
        });
    }

    // Bulk Processing
    const bulkUploadArea = document.getElementById("bulkUploadArea");
    const bulkFileInput = document.getElementById("bulkFileInput");

    bulkUploadArea.addEventListener("click", () => bulkFileInput.click());
    bulkUploadArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        bulkUploadArea.classList.add("dragover");
    });
    bulkUploadArea.addEventListener("dragleave", () => {
        bulkUploadArea.classList.remove("dragover");
    });
    bulkUploadArea.addEventListener("drop", (e) => {
        e.preventDefault();
        bulkUploadArea.classList.remove("dragover");
        if (e.dataTransfer.files.length) handleBulkFile(e.dataTransfer.files[0]);
    });
    bulkFileInput.addEventListener("change", (e) => {
        if (e.target.files.length) handleBulkFile(e.target.files[0]);
    });
    document.getElementById("exportCsvBtn").addEventListener("click", exportBulkResults);
    document.getElementById("clearBulkBtn").addEventListener("click", clearBulkResults);

    // History Modal
    document.getElementById("closeHistoryModal").addEventListener("click", () =>
        document.getElementById("historyModal").classList.remove("show"));
    document.getElementById("copyHistoryResponse").addEventListener("click", () => {
        if (currentHistoryItem) {
            navigator.clipboard.writeText(stripCitations(currentHistoryItem.response));
            document.getElementById("copyHistoryResponse").textContent = "✓ Copied!";
            setTimeout(() => {
                document.getElementById("copyHistoryResponse").textContent = "📋 Copy Response";
            }, 1500);
        }
    });

    // Escape to close modals
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            document.querySelectorAll(".modal-overlay.show").forEach(m => m.classList.remove("show"));
            closeTemplatesDrawer();
        }
    });

    // Character count for input
    const customerEmailInput = document.getElementById("customerEmail");
    customerEmailInput.addEventListener("input", () => {
        updateCharCount();
        autoSaveDraft();
    });

    // Load saved draft
    const savedDraft = localStorage.getItem("draft_inquiry");
    if (savedDraft) {
        customerEmailInput.value = savedDraft;
        updateCharCount();
    }

    // Collapsible options section
    const optionsHeader = document.getElementById("optionsHeader");
    if (optionsHeader) {
        optionsHeader.addEventListener("click", toggleOptionsSection);
    }

    // Templates drawer
    document.getElementById("closeDrawer").addEventListener("click", closeTemplatesDrawer);
    document.getElementById("drawerOverlay").addEventListener("click", closeTemplatesDrawer);

    // Quick Reply template filters
    document.querySelectorAll(".template-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => setTemplateFilter(btn.dataset.filter, btn));
    });
}

// ==================== DATA ANALYSIS TOOL ====================
let dataAnalysisListenersSetup = false;
let dataPendingFileData = null;
let dataAnalysisResults = {};

// Northern Ontario cities database
const NORTHERN_ONTARIO_CITIES = new Set([
    'thunder bay', 'sudbury', 'greater sudbury', 'grand sudbury', 'sault ste. marie', 'sault ste marie',
    'sault saint marie', 'sault st marie', 'sault st. marie', 'north bay', 'timmins', 'kenora',
    'dryden', 'fort frances', 'sioux lookout', 'kapuskasing', 'hearst', 'elliot lake', 'temiskaming shores',
    'kirkland lake', 'cochrane', 'iroquois falls', 'espanola', 'blind river', 'marathon', 'geraldton',
    'longlac', 'nipigon', 'red rock', 'terrace bay', 'white river', 'wawa', 'chapleau', 'hornepayne',
    'mattawa', 'powassan', 'sturgeon falls', 'west nipissing', 'smooth rock falls', 'moosonee',
    'shuniah', 'neebing', 'oliver paipoonge', 'oliver-paipoonge', 'gillies', 'conmee', 'oshea',
    "o'connor", 'murillo', 'kakabeka falls', 'kakabeka', 'rosslyn', 'hymers', 'slate river',
    'south gillies', 'pass lake', 'dorion', 'pearl', 'cloud bay', 'nolalu',
    'hanmer', 'val caron', 'val therese', 'azilda', 'chelmsford', 'dowling', 'onaping', 'levack',
    'capreol', 'garson', 'falconbridge', 'lively', 'naughton', 'whitefish', 'copper cliff',
    'coniston', 'wahnapitae', 'skead', 'estaire',
    'prince township', 'goulais river', 'searchmont', 'batchawana bay', 'dubreuilville',
    'garden river', 'echo bay', 'bruce mines', 'hilton beach',
    'richards landing', 'thessalon', 'iron bridge', 'spanish', 'massey', 'webbwood',
    'callander', 'corbeil', 'astorville', 'bonfield', 'rutherglen', 'cache bay', 'warren',
    'markstay', 'hagar', 'field', 'verner', 'lavigne', 'noelville',
    'south porcupine', 'porcupine', 'schumacher', 'matheson', 'larder lake',
    'virginiatown', 'englehart', 'earlton', 'new liskeard', 'haileybury', 'cobalt', 'latchford',
    'atikokan', 'rainy river', 'emo', 'devlin', 'stratton', 'mine centre',
    'ear falls', 'red lake', 'pickle lake', 'ignace', 'upsala', 'savant lake',
    'armstrong', 'nakina', 'beardmore', 'jellicoe', 'orient bay', 'caramat',
    'keewatin', 'jaffray melick', 'sioux narrows', 'nestor falls', 'morson', 'bergland',
    'vermilion bay', 'eagle river', 'wabigoon', 'dinorwic', 'hudson', 'minaki', 'redditt',
    'parry sound', 'huntsville', 'bracebridge', 'gravenhurst', 'bala', 'port carling',
    'rosseau', 'windermere', 'minett', 'burks falls', 'sundridge', 'south river',
    'trout creek', 'magnetawan', 'kearney', 'emsdale', 'novar', 'katrine',
    'sprucedale', 'port loring', 'loring', 'restoule', 'commanda', 'nipissing',
    'muskoka', 'muskoka lakes', 'lake of bays', 'georgian bay', 'seguin', 'mcdougall',
    'carling', 'archipelago', 'the archipelago', 'french river', 'killarney',
    'alban', 'monetville', 'bigwood', 'cosby mason', 'baldwin', 'merritt',
    'nairn centre', 'nairn and hyman', 'sables-spanish rivers', 'st. charles', 'st charles',
    'manitoulin', 'little current', 'gore bay', 'mindemoya', 'providence bay', 'south baymouth',
    'manitowaning', 'wikwemikong', 'sheguiandah', 'meldrum bay', 'silver water', 'kagawong',
    'moosonee', 'moose factory', 'fort albany', 'kashechewan', 'attawapiskat', 'peawanuck',
    'big trout lake', 'sandy lake', 'sachigo lake', 'cat lake', 'webequie',
    'opasatika', 'mattice', 'val rita', 'moonbeam', 'fauquier', 'strickland', 'jogues',
    'constance lake', 'calstock', 'harty', 'tunis', 'dana', 'holtyre', 'ramore', 'bourke',
    'thornloe', 'harley', 'hilliardton', 'kenabeek', 'chamberlain', 'elk lake', 'gowganda',
    'matachewan', 'shining tree', 'gogama', 'biscotasing', 'sultan', 'ramsey', 'britt',
    'byng inlet', 'pointe au baril', 'depot harbour', 'mactier', 'honey harbour'
]);

function normalizeCity(city) {
    if (!city) return '';
    return city.toString().toLowerCase().trim()
        .replace(/\s+/g, ' ')
        .replace(/['']/g, "'")
        .replace(/\./g, '')
        .replace(/^st\s/g, 'st ')
        .replace(/\bste\b/g, 'ste')
        .replace(/\bsaint\b/g, 'st');
}

function isNorthernOntario(city) {
    const normalized = normalizeCity(city);
    if (NORTHERN_ONTARIO_CITIES.has(normalized)) return true;
    for (const northern of NORTHERN_ONTARIO_CITIES) {
        if (normalized.includes(northern) || northern.includes(normalized)) return true;
    }
    return false;
}

function setupDataAnalysisListeners() {
    if (dataAnalysisListenersSetup) return;

    const uploadDropzone = document.getElementById("dataUploadDropzone");
    const uploadStep = document.getElementById("dataUploadStep");
    const fileInput = document.getElementById("dataFileInput");

    if (!uploadDropzone || !fileInput) {
        console.error("Data analysis elements not found");
        return;
    }

    dataAnalysisListenersSetup = true;

    // Report type selection - now reveals upload step on same page
    const reportTypeSelect = document.getElementById("dataReportTypeSelect");
    const reportTypeDescription = document.getElementById("dataReportTypeDescription");

    if (reportTypeSelect) {
        reportTypeSelect.addEventListener("change", (e) => {
            const type = e.target.value;
            if (type && REPORT_TYPES[type]) {
                currentReportType = type;
                reportTypeDescription.innerHTML = `<h4>${REPORT_TYPES[type].name}</h4><p>${REPORT_TYPES[type].description}</p>`;
                reportTypeDescription.classList.add('visible');

                // Shopify: skip upload, go straight to data pull
                if (REPORT_TYPES[type].noUpload) {
                    uploadStep.classList.remove('active');
                    handleShopifyAnalytics();
                    return;
                }

                // Activate the upload step
                uploadStep.classList.add('active');
                document.getElementById("dataUploadTitle").textContent = REPORT_TYPES[currentReportType].uploadTitle;
                document.getElementById("dataUploadSubtitle").textContent = REPORT_TYPES[currentReportType].uploadSubtitle;
            } else {
                currentReportType = null;
                reportTypeDescription.classList.remove('visible');
                uploadStep.classList.remove('active');
            }
        });
    }

    // Drag and drop handlers for the dropzone
    uploadDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadDropzone.classList.add("dragover");
    });

    uploadDropzone.addEventListener("dragleave", () => {
        uploadDropzone.classList.remove("dragover");
    });

    uploadDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadDropzone.classList.remove("dragover");
        const file = e.dataTransfer.files[0];
        if (file) processDataFile(file);
    });

    // File input change
    fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) processDataFile(file);
    });

    // Navigation tabs
    document.querySelectorAll('.data-nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.data-nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.data-page').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('data-page-' + tab.dataset.page).classList.add('active');
        });
    });

    // Generate button
    const generateBtn = document.getElementById("dataGenerateBtn");
    if (generateBtn) {
        generateBtn.addEventListener("click", processNamedDataFile);
    }

    // Reset button
    const resetBtn = document.getElementById("dataResetBtn");

    if (resetBtn) resetBtn.addEventListener("click", resetDataAnalysis);

}

function processDataFile(file) {
    if (!file.name.match(/\.xlsx?$/i) && !file.name.match(/\.csv$/i)) {
        showToast("Please upload an Excel file (.xlsx or .xls)", "error");
        return;
    }

    document.getElementById("dataCombinedUploadSection").style.display = "none";
    document.getElementById("dataLoading").style.display = "block";

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            dataPendingFileData = XLSX.utils.sheet_to_json(sheet);

            document.getElementById("dataLoading").style.display = "none";
            document.getElementById("dataNamingSection").style.display = "block";
            document.getElementById("dataReportNameInput").focus();
        } catch (error) {
            showToast("Error reading file: " + error.message, "error");
            resetDataAnalysis();
        }
    };
    reader.readAsArrayBuffer(file);
}

function processNamedDataFile() {
    const reportName = document.getElementById("dataReportNameInput").value.trim() || "Untitled Report";
    document.getElementById("dataNamingSection").style.display = "none";
    document.getElementById("dataHeaderActions").style.display = "flex";

    // Route to the correct dashboard based on report type
    if (currentReportType === 'customers') {
        document.getElementById("dataCustomersReportName").textContent = reportName;
        document.getElementById("dataNavTabs").style.display = "none"; // Customers report has single page
        analyzeCustomersReport(dataPendingFileData);
        document.getElementById("dataCustomersDashboard").style.display = "block";
        document.getElementById("data-page-customers-overview").classList.add("active");
    } else if (currentReportType === 'payment-tickets') {
        document.getElementById("dataPaymentTicketsReportName").textContent = reportName;
        document.getElementById("dataNavTabs").style.display = "none"; // Payment Tickets report has single page
        analyzePaymentTicketsReport(dataPendingFileData);
        document.getElementById("dataPaymentTicketsDashboard").style.display = "block";
        document.getElementById("data-page-payment-tickets-overview").classList.add("active");
    } else if (currentReportType === 'sellers') {
        document.getElementById("dataSellersReportName").textContent = reportName;
        document.getElementById("dataNavTabs").style.display = "none"; // Sellers report has single page
        analyzeSellersReport(dataPendingFileData);
        document.getElementById("dataSellersDashboard").style.display = "block";
        document.getElementById("data-page-sellers-overview").classList.add("active");
    } else {
        // Default to customer-purchases
        document.getElementById("dataReportName").textContent = reportName;
        document.getElementById("dataNavTabs").style.display = "flex";
        analyzeDataFull(dataPendingFileData);
        document.getElementById("dataDashboard").classList.add("visible");
    }
}

function analyzeDataFull(data) {
    // Auto-detect column names - scan all rows for columns
    const allColumns = new Set();
    data.forEach(row => Object.keys(row).forEach(key => allColumns.add(key)));
    const columns = Array.from(allColumns);

    // Improved column matching - exact matches first, then partial
    const findCol = (exactMatches, partialMatches = []) => {
        // First try exact matches (case-insensitive)
        for (const exact of exactMatches) {
            const found = columns.find(c => c.toLowerCase().trim() === exact.toLowerCase());
            if (found) return found;
        }
        // Then try partial matches
        for (const partial of partialMatches) {
            const found = columns.find(c => c.toLowerCase().includes(partial.toLowerCase()));
            if (found) return found;
        }
        return null;
    };

    const emailCol = findCol(['e-mail', 'email', 'email address'], ['email']);
    const spentCol = findCol(['total spent', 'amount', 'total', 'spent'], ['spent', 'amount']);
    const cityCol = findCol(['city'], ['city']);
    const nameCol = findCol(['customer', 'customer name', 'name', 'full name'], ['customer']);
    const ticketCol = findCol(['quantity', 'tickets', 'number count'], ['ticket', 'quantity']);
    const phoneCol = findCol(['phone', 'phone number'], ['phone']);
    const zipCol = findCol(['zip code', 'postal code', 'zip', 'postal'], ['zip', 'postal']);


    const PACKAGES = [100, 75, 50, 20, 10];
    const SINGLE_PACKAGE_AMOUNTS = new Set([10, 20, 50, 75, 100]);

    function estimatePackages(totalSpent) {
        let remaining = totalSpent;
        let packages = [];
        for (const pkg of PACKAGES) {
            while (remaining >= pkg) {
                packages.push(pkg);
                remaining -= pkg;
            }
        }
        return packages;
    }

    // Basic metrics
    const totalRevenue = data.reduce((sum, row) => sum + (Number(row[spentCol]) || 0), 0);
    const totalTransactions = data.length;

    // Package-level analysis
    let totalPackageValue = 0;
    let totalPackageCount = 0;
    let packageCounts = { 10: 0, 20: 0, 50: 0, 75: 0, 100: 0 };

    data.forEach(row => {
        const spent = Number(row[spentCol]) || 0;
        const packages = estimatePackages(spent);
        totalPackageCount += packages.length;
        totalPackageValue += packages.reduce((sum, p) => sum + p, 0);
        packages.forEach(p => {
            if (packageCounts[p] !== undefined) packageCounts[p]++;
        });
    });

    const avgSale = totalPackageCount > 0 ? totalPackageValue / totalPackageCount : 0;

    // Unique customers by email
    const emails = new Set(data.map(row => (row[emailCol] || '').toString().toLowerCase().trim()).filter(e => e));
    const uniqueCustomers = emails.size;
    const avgPerCustomer = uniqueCustomers > 0 ? totalRevenue / uniqueCustomers : 0;

    // Repeat buyers
    let repeatBuyersCount = 0;
    data.forEach(row => {
        const spent = Number(row[spentCol]) || 0;
        if (!SINGLE_PACKAGE_AMOUNTS.has(spent)) repeatBuyersCount++;
    });

    // Total tickets
    const totalTickets = data.reduce((sum, row) => sum + (Number(row[ticketCol]) || 0), 0);

    // Geographic analysis
    let northernRevenue = 0, northernCount = 0, southernRevenue = 0, southernCount = 0;
    let rsuRevenue = 0, rsuCount = 0;

    const cityData = {};
    const postalData = {};
    const customerSpending = {};
    const tierData = {};

    // Track if we have geographic data
    const hasGeographicData = !!cityCol;

    data.forEach(row => {
        let rawCity = cityCol ? (row[cityCol] || '').toString().trim() : '';
        const amount = Number(row[spentCol]) || 0;
        const email = (row[emailCol] || '').toString().toLowerCase().trim();
        const name = row[nameCol] || 'Unknown';
        const phone = row[phoneCol] || '';
        const postal = zipCol ? (row[zipCol] || '').toString().toUpperCase().trim().substring(0, 3) : '';

        // RSU detection (only if we have city data)
        let isRSU = false;
        if (hasGeographicData) {
            isRSU = !rawCity || rawCity.toLowerCase() === 'unknown' || rawCity === '';
            if (isRSU) {
                rsuRevenue += amount;
                rsuCount++;
                rawCity = 'Thunder Bay';
            }
        }

        const normalizedCity = hasGeographicData ? normalizeCity(rawCity) : 'unknown';
        const displayCity = rawCity ? rawCity.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : 'Unknown';

        // City aggregation (only if we have city data)
        if (hasGeographicData && normalizedCity) {
            if (!cityData[normalizedCity]) {
                cityData[normalizedCity] = { revenue: 0, count: 0, displayName: displayCity };
            }
            cityData[normalizedCity].revenue += amount;
            cityData[normalizedCity].count++;
        }

        // Postal code aggregation
        if (postal && postal.length >= 3) {
            if (!postalData[postal]) postalData[postal] = { revenue: 0, count: 0 };
            postalData[postal].revenue += amount;
            postalData[postal].count++;
        }

        // Customer spending for whale analysis
        if (email) {
            if (!customerSpending[email]) {
                customerSpending[email] = { name, email, phone, city: displayCity, total: 0 };
            }
            customerSpending[email].total += amount;
        }

        // Purchase tier analysis
        if (!tierData[amount]) tierData[amount] = { count: 0, revenue: 0 };
        tierData[amount].count++;
        tierData[amount].revenue += amount;

        // Northern vs Southern Ontario (only if we have city data)
        if (hasGeographicData) {
            if (isNorthernOntario(rawCity) || isRSU) {
                northernRevenue += amount;
                northernCount++;
            } else {
                southernRevenue += amount;
                southernCount++;
            }
        }
    });

    // Store for other pages
    dataAnalysisResults = { cityData, customerSpending, totalRevenue };


    // Update UI - use exact amounts for main revenue figures
    // Set immediate values first (in case animation fails), then animate
    const el = (id) => document.getElementById(id);

    // Immediate fallback values
    if (el('dataTotalRevenue')) el('dataTotalRevenue').textContent = '$' + totalRevenue.toLocaleString();
    if (el('dataTotalPurchases')) el('dataTotalPurchases').textContent = totalTransactions.toLocaleString();
    if (el('dataTotalUniqueCustomers')) el('dataTotalUniqueCustomers').textContent = uniqueCustomers.toLocaleString();
    if (el('dataAvgSale')) el('dataAvgSale').textContent = '$' + avgSale.toFixed(2);
    if (el('dataUniqueCustomers')) el('dataUniqueCustomers').textContent = uniqueCustomers.toLocaleString();
    if (el('dataAvgPerCustomer')) el('dataAvgPerCustomer').textContent = '$' + avgPerCustomer.toFixed(2);
    if (el('dataRepeatBuyers')) el('dataRepeatBuyers').textContent = repeatBuyersCount.toLocaleString();
    if (el('dataTotalTickets')) el('dataTotalTickets').textContent = totalTickets.toLocaleString();
    if (el('dataAvgPurchase')) el('dataAvgPurchase').textContent = '$' + (totalRevenue / totalTransactions).toFixed(2);
    if (el('dataNorthernSales')) el('dataNorthernSales').textContent = '$' + northernRevenue.toLocaleString();
    if (el('dataRsuSales')) el('dataRsuSales').textContent = '$' + rsuRevenue.toLocaleString();

    // Subtext updates
    if (el('dataRevenueSubtext')) el('dataRevenueSubtext').textContent = `from ${totalTransactions.toLocaleString()} transactions`;
    if (el('dataAvgSaleSubtext')) el('dataAvgSaleSubtext').textContent = `from ${totalPackageCount.toLocaleString()} packages`;
    if (el('dataRepeatSubtext')) el('dataRepeatSubtext').textContent = `bought multiple packages`;
    if (el('dataNorthernSubtext')) el('dataNorthernSubtext').textContent = `${northernCount.toLocaleString()} customers (${totalRevenue > 0 ? ((northernRevenue/totalRevenue)*100).toFixed(1) : 0}%)`;
    if (el('dataRsuSubtext')) el('dataRsuSubtext').textContent = `${rsuCount.toLocaleString()} in-venue transactions`;

    // Now try animated updates (will overwrite the static values with animation)
    animateCurrency(el('dataTotalRevenue'), totalRevenue, 1500, true);
    animateCurrency(el('dataAvgSale'), avgSale, 1200);
    animateNumber(el('dataUniqueCustomers'), uniqueCustomers, 1200);
    animateCurrency(el('dataAvgPerCustomer'), avgPerCustomer, 1000);
    animateNumber(el('dataRepeatBuyers'), repeatBuyersCount, 1000);
    animateNumber(el('dataTotalTickets'), totalTickets, 1200);
    animateNumber(el('dataTotalPurchases'), totalTransactions, 1000);
    animateNumber(el('dataTotalUniqueCustomers'), uniqueCustomers, 1000);
    animateCurrency(el('dataAvgPurchase'), totalRevenue / totalTransactions, 1000);
    animateCurrency(el('dataNorthernSales'), northernRevenue, 1200, true);
    animateCurrency(el('dataRsuSales'), rsuRevenue, 1200, true);

    // Populate Summary Statistics Table
    const avgOrderPerCustomer = uniqueCustomers > 0 ? totalTransactions / uniqueCustomers : 0;
    const avgSalesPerCustomer = uniqueCustomers > 0 ? totalRevenue / uniqueCustomers : 0;

    // Package breakdown for summary table (calculate first so we can use for weighted average)
    const pkgRevenue10 = packageCounts[10] * 10;
    const pkgRevenue20 = packageCounts[20] * 20;
    const pkgRevenue50 = packageCounts[50] * 50;
    const pkgRevenue75 = packageCounts[75] * 75;
    const pkgRevenue100 = packageCounts[100] * 100;
    const pkgTotalRevenue = pkgRevenue10 + pkgRevenue20 + pkgRevenue50 + pkgRevenue75 + pkgRevenue100;
    const totalPackagesSold = packageCounts[10] + packageCounts[20] + packageCounts[50] + packageCounts[75] + packageCounts[100];

    // Weighted average price sold = total package revenue / total packages sold
    const weightedAvgPriceSold = totalPackagesSold > 0 ? pkgTotalRevenue / totalPackagesSold : 0;

    document.getElementById('summaryTotalRevenue').textContent = formatDataCurrency(totalRevenue, true);
    document.getElementById('summaryTotalCustomers').textContent = uniqueCustomers.toLocaleString();
    document.getElementById('summaryTotalTransactions').textContent = totalTransactions.toLocaleString();
    document.getElementById('summaryAvgPriceSold').textContent = formatDataCurrency(weightedAvgPriceSold);
    document.getElementById('summaryAvgOrderPerCustomer').textContent = avgOrderPerCustomer.toFixed(2);
    document.getElementById('summaryAvgSalesPerCustomer').textContent = formatDataCurrency(avgSalesPerCustomer);

    // Format revenue in thousands with 3 decimal places like the reference image ($1.178 = $1,178)
    const formatPkgRevenue = (val) => '$' + (val / 1000).toFixed(3).replace(/\.?0+$/, '');

    // Calculate % of sales by package count (not revenue), then multiply by price for weighted contribution
    const pct10 = totalPackagesSold > 0 ? (packageCounts[10] / totalPackagesSold) * 100 : 0;
    const pct20 = totalPackagesSold > 0 ? (packageCounts[20] / totalPackagesSold) * 100 : 0;
    const pct50 = totalPackagesSold > 0 ? (packageCounts[50] / totalPackagesSold) * 100 : 0;
    const pct75 = totalPackagesSold > 0 ? (packageCounts[75] / totalPackagesSold) * 100 : 0;
    const pct100 = totalPackagesSold > 0 ? (packageCounts[100] / totalPackagesSold) * 100 : 0;

    // Weighted contribution = percentage × price (e.g., 10.79% × $10 = $1.079)
    const weighted10 = pct10 * 10 / 100;
    const weighted20 = pct20 * 20 / 100;
    const weighted50 = pct50 * 50 / 100;
    const weighted75 = pct75 * 75 / 100;
    const weighted100 = pct100 * 100 / 100;
    const weightedTotal = weighted10 + weighted20 + weighted50 + weighted75 + weighted100;

    document.getElementById('summaryPkg10Count').textContent = packageCounts[10].toLocaleString();
    document.getElementById('summaryPkg10Pct').textContent = pct10.toFixed(2) + '%';
    document.getElementById('summaryPkg10Revenue').textContent = '$' + weighted10.toFixed(3);

    document.getElementById('summaryPkg20Count').textContent = packageCounts[20].toLocaleString();
    document.getElementById('summaryPkg20Pct').textContent = pct20.toFixed(2) + '%';
    document.getElementById('summaryPkg20Revenue').textContent = '$' + weighted20.toFixed(3);

    document.getElementById('summaryPkg50Count').textContent = packageCounts[50].toLocaleString();
    document.getElementById('summaryPkg50Pct').textContent = pct50.toFixed(2) + '%';
    document.getElementById('summaryPkg50Revenue').textContent = '$' + weighted50.toFixed(3);

    document.getElementById('summaryPkg75Count').textContent = packageCounts[75].toLocaleString();
    document.getElementById('summaryPkg75Pct').textContent = pct75.toFixed(2) + '%';
    document.getElementById('summaryPkg75Revenue').textContent = '$' + weighted75.toFixed(3);

    document.getElementById('summaryPkg100Count').textContent = packageCounts[100].toLocaleString();
    document.getElementById('summaryPkg100Pct').textContent = pct100.toFixed(2) + '%';
    document.getElementById('summaryPkg100Revenue').textContent = '$' + weighted100.toFixed(3);

    document.getElementById('summaryPkgTotalRevenue').textContent = '$' + weightedTotal.toFixed(3);

    // Render all visualizations
    renderDataChartsFull(tierData, packageCounts, northernRevenue, southernRevenue);
    renderDataCitiesTable(cityData);
    renderDataTiersTable(tierData, totalRevenue);
    renderDataPostalCodes(postalData);
    renderDataHeatmap(cityData);
    renderDataWhaleTable(customerSpending);
    generateDataInsights(totalRevenue, avgSale, uniqueCustomers, repeatBuyersCount, tierData, cityData,
                        totalTransactions, totalPackageCount, northernRevenue, northernCount, packageCounts, rsuRevenue, rsuCount);
}

function formatDataCurrency(value, exact = false) {
    if (exact) {
        return '$' + Math.round(value).toLocaleString();
    }
    if (value >= 1000000) return '$' + (value / 1000000).toFixed(2) + 'M';
    if (value >= 1000) return '$' + (value / 1000).toFixed(1) + 'K';
    return '$' + value.toFixed(2);
}

// ==================== ANIMATED COUNT-UP FUNCTIONS ====================
function animateValue(element, start, end, duration, prefix = '', suffix = '', decimals = 0) {
    if (!element) return;

    const startTime = performance.now();
    const range = end - start;

    element.classList.add('counting');

    function updateValue(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function (ease-out cubic)
        const easeOut = 1 - Math.pow(1 - progress, 3);

        const currentValue = start + (range * easeOut);

        if (decimals > 0) {
            element.textContent = prefix + currentValue.toFixed(decimals) + suffix;
        } else {
            element.textContent = prefix + Math.round(currentValue).toLocaleString() + suffix;
        }

        if (progress < 1) {
            requestAnimationFrame(updateValue);
        } else {
            element.classList.remove('counting');
        }
    }

    requestAnimationFrame(updateValue);
}

function animateCurrency(element, value, duration = 1200, exact = false) {
    if (!element) return;

    if (exact) {
        animateValue(element, 0, Math.round(value), duration, '$');
    } else if (value >= 1000000) {
        animateValue(element, 0, value / 1000000, duration, '$', 'M', 2);
    } else if (value >= 1000) {
        animateValue(element, 0, value / 1000, duration, '$', 'K', 1);
    } else {
        animateValue(element, 0, value, duration, '$', '', 2);
    }
}

function animatePercent(element, value, duration = 1000) {
    if (!element) return;
    animateValue(element, 0, value, duration, '', '%', 2);
}

function animateNumber(element, value, duration = 1000) {
    if (!element) return;
    animateValue(element, 0, value, duration);
}

function renderDataChartsFull(tierData, packageCounts, northernRevenue, southernRevenue) {
    dataCharts.forEach(chart => chart.destroy());
    dataCharts = [];

    // Enhanced chart animation defaults
    const chartAnimationOptions = {
        animation: {
            duration: 1200,
            easing: 'easeOutQuart',
            delay: (context) => context.dataIndex * 100
        },
        transitions: {
            active: { animation: { duration: 300 } },
            hide: { animation: { duration: 400 } },
            show: { animation: { duration: 600 } }
        }
    };

    const chartColors = ['#3B82F6', '#6366F1', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B'];

    // Revenue by Purchase Amount
    const topTiersByRevenue = Object.entries(tierData).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8);
    const revenueChart = new Chart(document.getElementById('dataRevenueChart'), {
        type: 'bar',
        data: {
            labels: topTiersByRevenue.map(t => '$' + t[0]),
            datasets: [{
                label: 'Revenue',
                data: topTiersByRevenue.map(t => t[1].revenue),
                backgroundColor: chartColors[0],
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + (v/1000) + 'K' } } },
            ...chartAnimationOptions
        }
    });
    dataCharts.push(revenueChart);

    // Transactions by Purchase Amount
    const topTiersByCount = Object.entries(tierData).sort((a, b) => b[1].count - a[1].count).slice(0, 8);
    const transactionsChart = new Chart(document.getElementById('dataTransactionsChart'), {
        type: 'bar',
        data: {
            labels: topTiersByCount.map(t => '$' + t[0]),
            datasets: [{
                label: 'Transactions',
                data: topTiersByCount.map(t => t[1].count),
                backgroundColor: chartColors[1],
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } },
            ...chartAnimationOptions
        }
    });
    dataCharts.push(transactionsChart);

    // Package Distribution
    const packageLabels = ['$10', '$20', '$50', '$75', '$100'];
    const packageValues = [packageCounts[10], packageCounts[20], packageCounts[50], packageCounts[75], packageCounts[100]];
    const packageChart = new Chart(document.getElementById('dataPackageChart'), {
        type: 'bar',
        data: {
            labels: packageLabels,
            datasets: [{
                label: 'Packages Sold',
                data: packageValues,
                backgroundColor: chartColors,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
    dataCharts.push(packageChart);

    // Update package counts display
    document.getElementById('dataPkg10').textContent = packageCounts[10].toLocaleString();
    document.getElementById('dataPkg20').textContent = packageCounts[20].toLocaleString();
    document.getElementById('dataPkg50').textContent = packageCounts[50].toLocaleString();
    document.getElementById('dataPkg75').textContent = packageCounts[75].toLocaleString();
    document.getElementById('dataPkg100').textContent = packageCounts[100].toLocaleString();

    // Northern vs Southern Ontario
    const regionChart = new Chart(document.getElementById('dataRegionChart'), {
        type: 'doughnut',
        data: {
            labels: ['Northern Ontario', 'Southern Ontario'],
            datasets: [{
                data: [northernRevenue, southernRevenue],
                backgroundColor: ['#059669', '#6B7280']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right' } }
        }
    });
    dataCharts.push(regionChart);
}

function renderDataCitiesTable(cityData) {
    const topCities = Object.entries(cityData).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10);
    document.getElementById('dataCitiesTable').innerHTML = topCities.map(([_, data], i) => `
        <tr>
            <td><span class="data-rank-badge ${i < 3 ? 'data-rank-' + (i+1) : 'data-rank-default'}">${i + 1}</span></td>
            <td>${data.displayName}</td>
            <td><strong>${formatDataCurrency(data.revenue)}</strong></td>
            <td>${data.count.toLocaleString()}</td>
        </tr>
    `).join('');
}

function renderDataTiersTable(tierData, totalRevenue) {
    const topTiers = Object.entries(tierData).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10);
    document.getElementById('dataTiersTable').innerHTML = topTiers.map(([amount, data]) => `
        <tr>
            <td><strong>$${Number(amount).toLocaleString()}</strong></td>
            <td>${data.count.toLocaleString()}</td>
            <td>${formatDataCurrency(data.revenue)}</td>
            <td>${((data.revenue / totalRevenue) * 100).toFixed(1)}%</td>
        </tr>
    `).join('');
}

function renderDataPostalCodes(postalData) {
    const topPostal = Object.entries(postalData).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 20);
    document.getElementById('dataPostalGrid').innerHTML = topPostal.map(([code, data]) => `
        <div class="data-postal-item">
            <span class="data-postal-code">${code}</span>
            <div class="data-postal-stats">
                <div class="data-postal-revenue">${formatDataCurrency(data.revenue)}</div>
                <div class="data-postal-count">${data.count.toLocaleString()} orders</div>
            </div>
        </div>
    `).join('');
}

function renderDataHeatmap(cityData) {
    const sortedCities = Object.entries(cityData).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 50);
    const maxRevenue = sortedCities[0] ? sortedCities[0][1].revenue : 1;

    document.getElementById('dataHeatmapGrid').innerHTML = sortedCities.map(([_, data]) => {
        const intensity = data.revenue / maxRevenue;
        // Interpolate from light purple to dark purple
        const r = Math.round(139 + (1 - intensity) * 100);
        const g = Math.round(92 - intensity * 50);
        const b = Math.round(246 - intensity * 50);
        const textColor = intensity > 0.5 ? 'white' : '#0A2540';
        return `
            <div class="data-heatmap-cell" style="background: rgb(${r}, ${g}, ${b}); color: ${textColor};" title="${data.displayName}: ${formatDataCurrency(data.revenue)}">
                <div class="data-heatmap-city">${data.displayName}</div>
                <div class="data-heatmap-value">${formatDataCurrency(data.revenue)}</div>
            </div>
        `;
    }).join('');
}

function renderDataWhaleTable(customerSpending) {
    const whales = Object.values(customerSpending).sort((a, b) => b.total - a.total).slice(0, 50);
    document.getElementById('dataWhaleTable').innerHTML = whales.map((w, i) => `
        <tr>
            <td>
                <div class="data-whale-rank">
                    <span class="data-rank-badge ${i < 3 ? 'data-rank-' + (i+1) : 'data-rank-default'}">${i + 1}</span>
                </div>
            </td>
            <td><strong>${w.name}</strong></td>
            <td>${w.email}</td>
            <td>${w.phone || '-'}</td>
            <td>${w.city}</td>
            <td class="data-whale-amount">${formatDataCurrency(w.total)}</td>
        </tr>
    `).join('');
}

function generateDataInsights(totalRevenue, avgSale, uniqueCustomers, repeatBuyersCount, tierData, cityData,
                              totalTransactions, totalPackageCount, northernRevenue, northernCount, packageCounts, rsuRevenue, rsuCount) {
    const insights = [];

    // Insight 1: Top revenue tier
    const topTier = Object.entries(tierData).sort((a, b) => b[1].revenue - a[1].revenue)[0];
    if (topTier) {
        const pct = ((topTier[1].revenue / totalRevenue) * 100).toFixed(0);
        insights.push({ icon: '💰', title: `$${topTier[0]} purchases drive ${pct}% of revenue`, text: `${topTier[1].count.toLocaleString()} transactions at this price point.` });
    }

    // Insight 2: Top city
    const topCity = Object.entries(cityData).sort((a, b) => b[1].revenue - a[1].revenue)[0];
    if (topCity) {
        const pct = ((topCity[1].revenue / totalRevenue) * 100).toFixed(0);
        insights.push({ icon: '📍', title: `${topCity[1].displayName} leads with ${pct}% of revenue`, text: `${topCity[1].count.toLocaleString()} customers contributed ${formatDataCurrency(topCity[1].revenue)}.` });
    }

    // Insight 3: Northern Ontario percentage
    const northernPct = ((northernRevenue / totalRevenue) * 100).toFixed(1);
    insights.push({ icon: '🌲', title: `Northern Ontario: ${northernPct}% of revenue`, text: `${northernCount.toLocaleString()} customers from north of Orillia.` });

    // Insight 4: RSU sales
    const rsuPct = ((rsuRevenue / totalRevenue) * 100).toFixed(1);
    insights.push({ icon: '🏪', title: `RSU in-venue sales: ${formatDataCurrency(rsuRevenue)} (${rsuPct}%)`, text: `${rsuCount.toLocaleString()} transactions from in-venue POS.` });

    // Insight 5: Most popular package
    const mostPopularPkg = Object.entries(packageCounts).sort((a, b) => b[1] - a[1])[0];
    if (mostPopularPkg) {
        const pkgPct = ((mostPopularPkg[1] / totalPackageCount) * 100).toFixed(0);
        insights.push({ icon: '🎟️', title: `$${mostPopularPkg[0]} is the most popular package (${pkgPct}%)`, text: `${mostPopularPkg[1].toLocaleString()} packages sold at this price point.` });
    }

    // Insight 6: Repeat buyers
    const repeatPct = ((repeatBuyersCount / totalTransactions) * 100).toFixed(1);
    insights.push({ icon: '🔄', title: `${repeatBuyersCount.toLocaleString()} repeat buyers (${repeatPct}%)`, text: `Customers who purchased multiple ticket packages.` });

    // Insight 7: Average package value
    insights.push({ icon: '📊', title: `Average package value: ${formatDataCurrency(avgSale)}`, text: `${totalPackageCount.toLocaleString()} packages sold to ${uniqueCustomers.toLocaleString()} customers.` });

    // Insight 8: Second largest city
    const sortedCities = Object.entries(cityData).sort((a, b) => b[1].revenue - a[1].revenue);
    if (sortedCities.length > 1) {
        const secondCity = sortedCities[1];
        const pct = ((secondCity[1].revenue / totalRevenue) * 100).toFixed(1);
        insights.push({ icon: '🏙️', title: `${secondCity[1].displayName} is #2 with ${pct}% of revenue`, text: `${secondCity[1].count.toLocaleString()} customers from this city.` });
    }

    // Insight 9: $100 package impact
    const hundredPkgRevenue = packageCounts[100] * 100;
    const hundredPct = totalRevenue > 0 ? ((hundredPkgRevenue / totalRevenue) * 100).toFixed(0) : 0;
    insights.push({ icon: '💎', title: `$100 packages generate ${hundredPct}% of revenue`, text: `${packageCounts[100].toLocaleString()} premium packages sold.` });

    // Insight 10: Entry-level vs premium ratio
    const entryLevel = packageCounts[10] + packageCounts[20];
    const premium = packageCounts[75] + packageCounts[100];
    const ratio = premium > 0 ? (entryLevel / premium).toFixed(1) : 'N/A';
    insights.push({ icon: '⚖️', title: `Entry-level to premium ratio: ${ratio}:1`, text: `${entryLevel.toLocaleString()} entry ($10-$20) vs ${premium.toLocaleString()} premium ($75-$100).` });

    // Render insights
    document.getElementById('dataInsightsList').innerHTML = insights.map(i => `
        <div class="data-insight-item">
            <div class="data-insight-icon">${i.icon}</div>
            <div class="data-insight-text">
                <strong>${i.title}</strong>
                <span>${i.text}</span>
            </div>
        </div>
    `).join('');
}

function resetDataAnalysis() {
    dataPendingFileData = null;
    dataAnalysisResults = {};
    currentReportType = null;
    dataCharts.forEach(chart => chart.destroy());
    dataCharts = [];

    // Hide all dashboards
    document.getElementById("dataDashboard").classList.remove("visible");
    document.getElementById("dataCustomersDashboard").style.display = "none";
    document.getElementById("dataPaymentTicketsDashboard").style.display = "none";
    document.getElementById("dataSellersDashboard").style.display = "none";

    // Reset sections
    document.getElementById("dataNamingSection").style.display = "none";
    document.getElementById("dataLoading").style.display = "none";
    document.getElementById("dataCombinedUploadSection").style.display = "block";
    document.getElementById("dataNavTabs").style.display = "none";
    document.getElementById("dataHeaderActions").style.display = "none";
    document.getElementById("dataFileInput").value = '';
    document.getElementById("dataReportNameInput").value = '';

    // Reset report type selection and upload step
    document.getElementById("dataReportTypeSelect").value = '';
    document.getElementById("dataReportTypeDescription").classList.remove('visible');
    document.getElementById("dataUploadStep").classList.remove('active');

    // Reset to overview page
    document.querySelectorAll('.data-nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.data-page').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-page="overview"]')?.classList.add('active');
    document.getElementById('data-page-overview')?.classList.add('active');
}

// ==================== CUSTOMERS REPORT ANALYSIS ====================
function analyzeCustomersReport(data) {
    // Auto-detect column names - scan ALL rows for columns
    const allColumns = new Set();
    data.forEach(row => Object.keys(row).forEach(key => allColumns.add(key)));
    const columns = Array.from(allColumns);

    // Improved column matching - exact matches first, then partial
    const findCol = (exactMatches, partialMatches = []) => {
        for (const exact of exactMatches) {
            const found = columns.find(c => c.toLowerCase().trim() === exact.toLowerCase());
            if (found) return found;
        }
        for (const partial of partialMatches) {
            const found = columns.find(c => c.toLowerCase().includes(partial.toLowerCase()));
            if (found) return found;
        }
        return null;
    };

    const cityCol = findCol(['city'], ['city']);
    const phoneCol = findCol(['phone', 'phone number'], ['phone']);
    const zipCol = findCol(['zip code', 'postal code', 'zip', 'postal'], ['zip', 'postal']);
    const emailCol = findCol(['e-mail', 'email', 'email address'], ['email']);


    const totalCustomers = data.length;

    // City analysis
    const cityData = {};
    // Postal code analysis (FSA - first 3 chars)
    const postalData = {};
    // Area code analysis (first 3 digits of phone)
    const areaCodeData = {};

    // Northern vs Southern count
    let northernCount = 0;
    let southernCount = 0;

    data.forEach(row => {
        // City
        let rawCity = (row[cityCol] || '').toString().trim();
        const normalizedCity = normalizeCity(rawCity);
        const displayCity = rawCity.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') || 'Unknown';

        if (!cityData[normalizedCity]) {
            cityData[normalizedCity] = { count: 0, displayName: displayCity };
        }
        cityData[normalizedCity].count++;

        // Northern vs Southern
        if (isNorthernOntario(rawCity) || !rawCity) {
            northernCount++;
        } else {
            southernCount++;
        }

        // Postal Code (FSA - first 3 characters)
        const postal = (row[zipCol] || '').toString().toUpperCase().trim().substring(0, 3);
        if (postal && postal.length >= 3) {
            if (!postalData[postal]) postalData[postal] = { count: 0 };
            postalData[postal].count++;
        }

        // Area Code (first 3 digits of phone, accounting for leading "1")
        let phone = (row[phoneCol] || '').toString().replace(/\D/g, '');
        // If phone starts with "1" and has 11 digits, strip the leading 1
        if (phone.length === 11 && phone.startsWith('1')) {
            phone = phone.substring(1);
        }
        if (phone.length >= 10) {
            const areaCode = phone.substring(0, 3);
            if (!areaCodeData[areaCode]) areaCodeData[areaCode] = { count: 0 };
            areaCodeData[areaCode].count++;
        }
    });

    const uniqueCities = Object.keys(cityData).length;
    const uniquePostal = Object.keys(postalData).length;

    // Update metrics
    // Animated metric updates
    animateNumber(document.getElementById('dataCustTotalCustomers'), totalCustomers, 1200);
    animateNumber(document.getElementById('dataCustUniqueCities'), uniqueCities, 1000);
    animateNumber(document.getElementById('dataCustUniquePostal'), uniquePostal, 1000);
    animateNumber(document.getElementById('dataCustNorthernCount'), northernCount, 1000);
    document.getElementById('dataCustNorthernPct').textContent = `${((northernCount / totalCustomers) * 100).toFixed(1)}% of customers`;

    // Render charts and tables
    renderCustomersCharts(cityData, postalData, areaCodeData, northernCount, southernCount, totalCustomers);
    renderCustomersTables(cityData, postalData, areaCodeData, totalCustomers);
}

function renderCustomersCharts(cityData, postalData, areaCodeData, northernCount, southernCount, totalCustomers) {
    // Destroy existing charts
    dataCharts.forEach(chart => chart.destroy());
    dataCharts = [];

    const chartColors = ['#3B82F6', '#6366F1', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B'];

    // Top 10 Cities Chart
    const topCities = Object.entries(cityData).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    const cityChart = new Chart(document.getElementById('dataCustCityChart'), {
        type: 'bar',
        data: {
            labels: topCities.map(c => c[1].displayName),
            datasets: [{
                label: 'Customers',
                data: topCities.map(c => c[1].count),
                backgroundColor: chartColors[0],
                borderRadius: 6
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true } }
        }
    });
    dataCharts.push(cityChart);

    // Top 10 Area Codes Chart
    const topAreaCodes = Object.entries(areaCodeData).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    const areaCodeChart = new Chart(document.getElementById('dataCustAreaCodeChart'), {
        type: 'bar',
        data: {
            labels: topAreaCodes.map(a => a[0]),
            datasets: [{
                label: 'Customers',
                data: topAreaCodes.map(a => a[1].count),
                backgroundColor: chartColors[1],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
    dataCharts.push(areaCodeChart);

    // Northern vs Southern Chart
    const regionChart = new Chart(document.getElementById('dataCustRegionChart'), {
        type: 'doughnut',
        data: {
            labels: ['Northern Ontario', 'Southern Ontario'],
            datasets: [{
                data: [northernCount, southernCount],
                backgroundColor: ['#059669', '#6B7280']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'right' } }
        }
    });
    dataCharts.push(regionChart);

    // Top 10 Postal Codes Chart
    const topPostal = Object.entries(postalData).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    const postalChart = new Chart(document.getElementById('dataCustPostalChart'), {
        type: 'bar',
        data: {
            labels: topPostal.map(p => p[0]),
            datasets: [{
                label: 'Customers',
                data: topPostal.map(p => p[1].count),
                backgroundColor: chartColors[2],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
    dataCharts.push(postalChart);
}

function renderCustomersTables(cityData, postalData, areaCodeData, totalCustomers) {
    // Top 25 Cities
    const topCities = Object.entries(cityData).sort((a, b) => b[1].count - a[1].count).slice(0, 25);
    document.getElementById('dataCustCitiesTable').innerHTML = topCities.map(([_, data], i) => `
        <tr>
            <td><span class="data-rank-badge ${i < 3 ? 'data-rank-' + (i+1) : 'data-rank-default'}">${i + 1}</span></td>
            <td>${data.displayName}</td>
            <td><strong>${data.count.toLocaleString()}</strong></td>
            <td>${((data.count / totalCustomers) * 100).toFixed(1)}%</td>
        </tr>
    `).join('');

    // Top 25 Postal Codes
    const topPostal = Object.entries(postalData).sort((a, b) => b[1].count - a[1].count).slice(0, 25);
    document.getElementById('dataCustPostalTable').innerHTML = topPostal.map(([code, data], i) => `
        <tr>
            <td><span class="data-rank-badge ${i < 3 ? 'data-rank-' + (i+1) : 'data-rank-default'}">${i + 1}</span></td>
            <td><strong>${code}</strong></td>
            <td>${data.count.toLocaleString()}</td>
            <td>${((data.count / totalCustomers) * 100).toFixed(1)}%</td>
        </tr>
    `).join('');

    // Top 25 Area Codes
    const topAreaCodes = Object.entries(areaCodeData).sort((a, b) => b[1].count - a[1].count).slice(0, 25);
    document.getElementById('dataCustAreaCodesTable').innerHTML = topAreaCodes.map(([code, data], i) => `
        <tr>
            <td><span class="data-rank-badge ${i < 3 ? 'data-rank-' + (i+1) : 'data-rank-default'}">${i + 1}</span></td>
            <td><strong>${code}</strong></td>
            <td>${data.count.toLocaleString()}</td>
            <td>${((data.count / totalCustomers) * 100).toFixed(1)}%</td>
        </tr>
    `).join('');
}

// ==================== PAYMENT TICKETS REPORT ====================
function analyzePaymentTicketsReport(data) {
    // Auto-detect column names - scan ALL rows for columns
    const allColumns = new Set();
    data.forEach(row => Object.keys(row).forEach(key => allColumns.add(key)));
    const columns = Array.from(allColumns);

    // Improved column matching - exact matches first, then partial
    const findCol = (exactMatches, partialMatches = []) => {
        for (const exact of exactMatches) {
            const found = columns.find(c => c.toLowerCase().trim() === exact.toLowerCase());
            if (found) return found;
        }
        for (const partial of partialMatches) {
            const found = columns.find(c => c.toLowerCase().includes(partial.toLowerCase()));
            if (found) return found;
        }
        return null;
    };

    const sellerCol = findCol(['seller'], ['seller']);
    const amountCol = findCol(['amount'], ['amount']);


    // Analyze seller data
    const sellerData = {};
    let totalSales = 0;
    let totalRevenue = 0;
    let shopifySales = 0;
    let shopifyRevenue = 0;

    data.forEach(row => {
        const seller = (row[sellerCol] || 'Unknown').toString().trim();
        const amount = Number(row[amountCol]) || 0;

        if (!sellerData[seller]) {
            sellerData[seller] = { sales: 0, revenue: 0 };
        }
        sellerData[seller].sales++;
        sellerData[seller].revenue += amount;

        totalSales++;
        totalRevenue += amount;

        // Check if Shopify
        if (seller.toLowerCase().includes('shopify')) {
            shopifySales++;
            shopifyRevenue += amount;
        }
    });

    const inPersonSales = totalSales - shopifySales;
    const inPersonRevenue = totalRevenue - shopifyRevenue;

    // Update Overview UI
    // Animated metric updates
    animateNumber(document.getElementById('dataPTTotalSales'), totalSales, 1200);
    animatePercent(document.getElementById('dataPTShopifyPct'), (shopifySales / totalSales) * 100, 1000);
    document.getElementById('dataPTShopifyCount').textContent = shopifySales.toLocaleString() + ' transactions';
    animatePercent(document.getElementById('dataPTInPersonPct'), (inPersonSales / totalSales) * 100, 1000);
    document.getElementById('dataPTInPersonCount').textContent = inPersonSales.toLocaleString() + ' transactions';

    animateCurrency(document.getElementById('dataPTTotalRevenue'), totalRevenue, 1200, true);
    animateCurrency(document.getElementById('dataPTShopifyRevenue'), shopifyRevenue, 1200, true);
    animateCurrency(document.getElementById('dataPTInPersonRevenue'), inPersonRevenue, 1200, true);

    // Categorize sellers (Foundation Office = Seller 1, Seller 2; Store = all others except Shopify)
    const foundationSellers = {};
    const storeSellers = {};

    Object.entries(sellerData).forEach(([seller, data]) => {
        if (seller.toLowerCase().includes('shopify')) {
            // Skip Shopify - it's in the overview
            return;
        }

        const sellerLower = seller.toLowerCase();
        // Foundation Donation Office: Seller 1 and Seller 2
        if (sellerLower === 'seller 1' || sellerLower === 'seller 2' ||
            sellerLower === 'seller1' || sellerLower === 'seller2') {
            foundationSellers[seller] = data;
        } else {
            // Thunder Bay 50/50 Store: all other sellers
            storeSellers[seller] = data;
        }
    });

    // Render charts and tables
    renderPaymentTicketsCharts(foundationSellers, storeSellers, inPersonSales, inPersonRevenue);
    renderPaymentTicketsTables(foundationSellers, storeSellers, inPersonSales, inPersonRevenue);
}

function renderPaymentTicketsCharts(foundationSellers, storeSellers, totalInPerson, totalInPersonRevenue) {
    // Destroy existing charts
    dataCharts.forEach(chart => chart.destroy());
    dataCharts = [];

    // Combine all in-person sellers for chart
    const allInPersonSellers = { ...foundationSellers, ...storeSellers };
    const sortedBySales = Object.entries(allInPersonSellers).sort((a, b) => b[1].sales - a[1].sales);
    const sortedByRevenue = Object.entries(allInPersonSellers).sort((a, b) => b[1].revenue - a[1].revenue);

    // Sales by Seller Bar Chart
    const sellerChart = new Chart(document.getElementById('dataPTSellerChart'), {
        type: 'bar',
        data: {
            labels: sortedBySales.map(([name]) => name),
            datasets: [{
                label: 'Sales',
                data: sortedBySales.map(([_, data]) => data.sales),
                backgroundColor: sortedBySales.map((_, i) => {
                    // Color based on seller type
                    const seller = sortedBySales[i][0].toLowerCase();
                    if (seller === 'seller 1' || seller === 'seller 2' || seller === 'seller1' || seller === 'seller2') {
                        return 'rgba(59, 130, 246, 0.8)'; // Blue for Foundation
                    }
                    return 'rgba(5, 150, 105, 0.8)'; // Green for Store
                }),
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: function(context) {
                            const pct = ((context.raw / totalInPerson) * 100).toFixed(1);
                            return pct + '% of in-person sales';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Number of Sales' }
                }
            }
        }
    });
    dataCharts.push(sellerChart);

    // Revenue by Seller Bar Chart
    const revenueChart = new Chart(document.getElementById('dataPTRevenueChart'), {
        type: 'bar',
        data: {
            labels: sortedByRevenue.map(([name]) => name),
            datasets: [{
                label: 'Revenue',
                data: sortedByRevenue.map(([_, data]) => data.revenue),
                backgroundColor: sortedByRevenue.map((_, i) => {
                    const seller = sortedByRevenue[i][0].toLowerCase();
                    if (seller === 'seller 1' || seller === 'seller 2' || seller === 'seller1' || seller === 'seller2') {
                        return 'rgba(59, 130, 246, 0.8)'; // Blue for Foundation
                    }
                    return 'rgba(5, 150, 105, 0.8)'; // Green for Store
                }),
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return '$' + context.raw.toLocaleString();
                        },
                        afterLabel: function(context) {
                            const pct = ((context.raw / totalInPersonRevenue) * 100).toFixed(1);
                            return pct + '% of in-person revenue';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Revenue ($)' },
                    ticks: {
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
    dataCharts.push(revenueChart);
}

function renderPaymentTicketsTables(foundationSellers, storeSellers, totalInPerson, totalInPersonRevenue) {
    // Foundation Donation Office Table
    const foundationEntries = Object.entries(foundationSellers).sort((a, b) => b[1].sales - a[1].sales);
    let foundationTotalSales = 0;
    let foundationTotalRevenue = 0;

    document.getElementById('dataPTFoundationTable').innerHTML = foundationEntries.length > 0
        ? foundationEntries.map(([seller, data]) => {
            foundationTotalSales += data.sales;
            foundationTotalRevenue += data.revenue;
            return `
                <tr>
                    <td><strong>${seller}</strong></td>
                    <td>${data.sales.toLocaleString()}</td>
                    <td>$${data.revenue.toLocaleString()}</td>
                    <td>${((data.sales / totalInPerson) * 100).toFixed(2)}%</td>
                </tr>
            `;
        }).join('')
        : '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No Foundation Office sales in this report</td></tr>';

    document.getElementById('dataPTFoundationTotals').innerHTML = foundationEntries.length > 0
        ? `<tr>
            <td><strong>Total</strong></td>
            <td><strong>${foundationTotalSales.toLocaleString()}</strong></td>
            <td><strong>$${foundationTotalRevenue.toLocaleString()}</strong></td>
            <td><strong>${((foundationTotalSales / totalInPerson) * 100).toFixed(2)}%</strong></td>
        </tr>`
        : '';

    // Thunder Bay 50/50 Store Table
    const storeEntries = Object.entries(storeSellers).sort((a, b) => b[1].sales - a[1].sales);
    let storeTotalSales = 0;
    let storeTotalRevenue = 0;

    document.getElementById('dataPTStoreTable').innerHTML = storeEntries.length > 0
        ? storeEntries.map(([seller, data]) => {
            storeTotalSales += data.sales;
            storeTotalRevenue += data.revenue;
            return `
                <tr>
                    <td><strong>${seller}</strong></td>
                    <td>${data.sales.toLocaleString()}</td>
                    <td>$${data.revenue.toLocaleString()}</td>
                    <td>${((data.sales / totalInPerson) * 100).toFixed(2)}%</td>
                </tr>
            `;
        }).join('')
        : '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No Store sales in this report</td></tr>';

    document.getElementById('dataPTStoreTotals').innerHTML = storeEntries.length > 0
        ? `<tr>
            <td><strong>Total</strong></td>
            <td><strong>${storeTotalSales.toLocaleString()}</strong></td>
            <td><strong>$${storeTotalRevenue.toLocaleString()}</strong></td>
            <td><strong>${((storeTotalSales / totalInPerson) * 100).toFixed(2)}%</strong></td>
        </tr>`
        : '';
}

// ==================== SELLERS REPORT ====================
function analyzeSellersReport(data) {
    // Auto-detect column names - scan ALL rows for columns
    const allColumns = new Set();
    data.forEach(row => Object.keys(row).forEach(key => allColumns.add(key)));
    const columns = Array.from(allColumns);

    // Improved column matching - exact matches first, then partial
    const findCol = (exactMatches, partialMatches = []) => {
        for (const exact of exactMatches) {
            const found = columns.find(c => c.toLowerCase().trim() === exact.toLowerCase());
            if (found) return found;
        }
        for (const partial of partialMatches) {
            const found = columns.find(c => c.toLowerCase().includes(partial.toLowerCase()));
            if (found) return found;
        }
        return null;
    };

    const sellerCol = findCol(['seller'], ['seller']);
    const netSalesCol = findCol(['net sales'], ['net sales']);
    const cashCol = findCol(['cash sales'], ['cash']);
    const ccCol = findCol(['cc sales', 'credit card sales'], ['cc', 'credit card']);
    const debitCol = findCol(['debit sales'], ['debit']);
    const txCol = findCol(['total transactions', 'transactions'], ['transaction']);
    const voidedSalesCol = findCol(['voided sales'], ['voided']);
    const avgOrderCol = findCol(['average order', 'avg order'], ['avg', 'average']);
    const netNumbersCol = findCol(['net numbers', 'net tickets'], ['net number', 'net ticket']);


    // Aggregate data
    let totalNetSales = 0;
    let totalCash = 0;
    let totalCC = 0;
    let totalDebit = 0;
    let totalTx = 0;
    let totalVoided = 0;
    let totalNetNumbers = 0;
    let activeSellers = 0;

    // In-person totals (excluding Shopify)
    let ipNetSales = 0;
    let ipCash = 0;
    let ipCC = 0;
    let ipDebit = 0;

    const sellerData = [];

    data.forEach(row => {
        const seller = (row[sellerCol] || 'Unknown').toString().trim();
        const netSales = Number(row[netSalesCol]) || 0;
        const cash = Number(row[cashCol]) || 0;
        const cc = Number(row[ccCol]) || 0;
        const debit = Number(row[debitCol]) || 0;
        const tx = Number(row[txCol]) || 0;
        const voided = Number(row[voidedSalesCol]) || 0;
        const avgOrder = row[avgOrderCol];
        const netNumbers = Number(row[netNumbersCol]) || 0;

        totalNetSales += netSales;
        totalCash += cash;
        totalCC += cc;
        totalDebit += debit;
        totalTx += tx;
        totalVoided += voided;
        totalNetNumbers += netNumbers;

        if (netSales > 0 || tx > 0) {
            activeSellers++;
        }

        // Track in-person (non-Shopify)
        if (!seller.toLowerCase().includes('shopify')) {
            ipNetSales += netSales;
            ipCash += cash;
            ipCC += cc;
            ipDebit += debit;
        }

        sellerData.push({
            seller,
            netSales,
            cash,
            cc,
            debit,
            tx,
            voided,
            avgOrder: avgOrder === 'N/A' ? null : Number(avgOrder) || 0,
            netNumbers
        });
    });

    const overallAvgOrder = totalTx > 0 ? totalNetSales / totalTx : 0;

    // Update Overview Metrics
    // Animated metric updates
    animateCurrency(document.getElementById('dataSellersNetSales'), totalNetSales, 1500, true);
    animateNumber(document.getElementById('dataSellersTotalTx'), totalTx, 1200);
    animateNumber(document.getElementById('dataSellersActiveSellers'), activeSellers, 800);
    animateCurrency(document.getElementById('dataSellersAvgOrder'), overallAvgOrder, 1000);

    // Update Payment Method Overview (All Sellers) with animations
    animateCurrency(document.getElementById('dataSellersCashTotal'), totalCash, 1200, true);
    animatePercent(document.getElementById('dataSellersCashPct'), totalNetSales > 0 ? (totalCash / totalNetSales) * 100 : 0, 1000);
    animateCurrency(document.getElementById('dataSellersCCTotal'), totalCC, 1200, true);
    animatePercent(document.getElementById('dataSellersCCPct'), totalNetSales > 0 ? (totalCC / totalNetSales) * 100 : 0, 1000);
    animateCurrency(document.getElementById('dataSellersDebitTotal'), totalDebit, 1200, true);
    animatePercent(document.getElementById('dataSellersDebitPct'), totalNetSales > 0 ? (totalDebit / totalNetSales) * 100 : 0, 1000);

    // Update In-Person Payment Overview with animations
    animateCurrency(document.getElementById('dataSellersIPCashTotal'), ipCash, 1200, true);
    animatePercent(document.getElementById('dataSellersIPCashPct'), ipNetSales > 0 ? (ipCash / ipNetSales) * 100 : 0, 1000);
    animateCurrency(document.getElementById('dataSellersIPCCTotal'), ipCC, 1200, true);
    animatePercent(document.getElementById('dataSellersIPCCPct'), ipNetSales > 0 ? (ipCC / ipNetSales) * 100 : 0, 1000);
    animateCurrency(document.getElementById('dataSellersIPDebitTotal'), ipDebit, 1200, true);
    animatePercent(document.getElementById('dataSellersIPDebitPct'), ipNetSales > 0 ? (ipDebit / ipNetSales) * 100 : 0, 1000);

    // Render charts and table
    renderSellersCharts(sellerData, totalNetSales, ipNetSales, ipCash, ipCC, ipDebit);
    renderSellersTable(sellerData, totalNetSales, totalCash, totalCC, totalDebit, totalTx, totalVoided, totalNetNumbers);
}

function renderSellersCharts(sellerData, totalNetSales, ipNetSales, ipCash, ipCC, ipDebit) {
    // Destroy existing charts
    dataCharts.forEach(chart => chart.destroy());
    dataCharts = [];

    // Sort sellers by net sales (excluding zero sales)
    const sortedSellers = sellerData.filter(s => s.netSales > 0).sort((a, b) => b.netSales - a.netSales);
    const inPersonSellers = sortedSellers.filter(s => !s.seller.toLowerCase().includes('shopify'));

    // Net Sales by Seller Bar Chart
    const netChart = new Chart(document.getElementById('dataSellersNetChart'), {
        type: 'bar',
        data: {
            labels: sortedSellers.map(s => s.seller),
            datasets: [{
                label: 'Net Sales',
                data: sortedSellers.map(s => s.netSales),
                backgroundColor: sortedSellers.map(s =>
                    s.seller.toLowerCase().includes('shopify') ? 'rgba(0, 0, 0, 0.8)' : 'rgba(5, 150, 105, 0.8)'
                ),
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => '$' + ctx.raw.toLocaleString(),
                        afterLabel: (ctx) => ((ctx.raw / totalNetSales) * 100).toFixed(1) + '% of total'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: (v) => '$' + v.toLocaleString() }
                }
            }
        }
    });
    dataCharts.push(netChart);

    // Payment Methods by Seller (Stacked Bar)
    const paymentChart = new Chart(document.getElementById('dataSellersPaymentChart'), {
        type: 'bar',
        data: {
            labels: sortedSellers.map(s => s.seller),
            datasets: [
                {
                    label: 'Cash',
                    data: sortedSellers.map(s => s.cash),
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderRadius: 4
                },
                {
                    label: 'Credit Card',
                    data: sortedSellers.map(s => s.cc),
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderRadius: 4
                },
                {
                    label: 'Debit',
                    data: sortedSellers.map(s => s.debit),
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.dataset.label + ': $' + ctx.raw.toLocaleString()
                    }
                }
            },
            scales: {
                x: { stacked: true },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: { callback: (v) => '$' + v.toLocaleString() }
                }
            }
        }
    });
    dataCharts.push(paymentChart);

    // In-Person Payment Distribution (Doughnut)
    const ipPaymentChart = new Chart(document.getElementById('dataSellersInPersonPaymentChart'), {
        type: 'doughnut',
        data: {
            labels: ['Cash', 'Credit Card', 'Debit'],
            datasets: [{
                data: [ipCash, ipCC, ipDebit],
                backgroundColor: [
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(59, 130, 246, 0.8)',
                    'rgba(0, 0, 0, 0.8)'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const pct = ipNetSales > 0 ? ((ctx.raw / ipNetSales) * 100).toFixed(1) : 0;
                            return ctx.label + ': $' + ctx.raw.toLocaleString() + ' (' + pct + '%)';
                        }
                    }
                }
            }
        }
    });
    dataCharts.push(ipPaymentChart);

    // In-Person Sales by Seller Bar Chart
    const ipBarChart = new Chart(document.getElementById('dataSellersInPersonBarChart'), {
        type: 'bar',
        data: {
            labels: inPersonSellers.map(s => s.seller),
            datasets: [{
                label: 'Net Sales',
                data: inPersonSellers.map(s => s.netSales),
                backgroundColor: 'rgba(5, 150, 105, 0.8)',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => '$' + ctx.raw.toLocaleString(),
                        afterLabel: (ctx) => ((ctx.raw / ipNetSales) * 100).toFixed(1) + '% of in-person'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: (v) => '$' + v.toLocaleString() }
                }
            }
        }
    });
    dataCharts.push(ipBarChart);
}

function renderSellersTable(sellerData, totalNetSales, totalCash, totalCC, totalDebit, totalTx, totalVoided, totalNetNumbers) {
    // Sort by net sales descending
    const sorted = [...sellerData].sort((a, b) => b.netSales - a.netSales);

    document.getElementById('dataSellersTable').innerHTML = sorted.map(s => `
        <tr>
            <td><strong>${s.seller}</strong></td>
            <td>$${s.netSales.toLocaleString()}</td>
            <td>$${s.cash.toLocaleString()}</td>
            <td>$${s.cc.toLocaleString()}</td>
            <td>$${s.debit.toLocaleString()}</td>
            <td>${s.tx.toLocaleString()}</td>
            <td>${s.avgOrder !== null ? '$' + s.avgOrder.toFixed(0) : 'N/A'}</td>
            <td>$${s.voided.toLocaleString()}</td>
            <td>${s.netNumbers.toLocaleString()}</td>
        </tr>
    `).join('');

    const overallAvg = totalTx > 0 ? totalNetSales / totalTx : 0;

    document.getElementById('dataSellersTotals').innerHTML = `
        <tr>
            <td><strong>TOTAL</strong></td>
            <td><strong>$${totalNetSales.toLocaleString()}</strong></td>
            <td><strong>$${totalCash.toLocaleString()}</strong></td>
            <td><strong>$${totalCC.toLocaleString()}</strong></td>
            <td><strong>$${totalDebit.toLocaleString()}</strong></td>
            <td><strong>${totalTx.toLocaleString()}</strong></td>
            <td><strong>$${overallAvg.toFixed(0)}</strong></td>
            <td><strong>$${totalVoided.toLocaleString()}</strong></td>
            <td><strong>${totalNetNumbers.toLocaleString()}</strong></td>
        </tr>
    `;
}

// ==================== NAVIGATION ====================
function toggleSidebar() {
    const sidebar = document.getElementById("appSidebar");
    const overlay = document.getElementById("sidebarOverlay");
    if (sidebar) {
        sidebar.classList.toggle("open");
        if (overlay) overlay.classList.toggle("visible", sidebar.classList.contains("open"));
    }
}

function closeSidebar() {
    const sidebar = document.getElementById("appSidebar");
    const overlay = document.getElementById("sidebarOverlay");
    if (sidebar) sidebar.classList.remove("open");
    if (overlay) overlay.classList.remove("visible");
}

function switchPage(pageId) {
    // Update URL
    pushRoute(PAGE_ROUTES[pageId] || TOOL_ROUTES[currentTool] || '/dashboard');

    document.querySelectorAll(".sidebar-btn[data-page]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === pageId);
    });
    document.querySelectorAll(".page").forEach(page => {
        page.classList.toggle("active", page.id === `page-${pageId}`);
    });

    // Close sidebar on mobile after navigation
    closeSidebar();

    // Refresh page-specific data
    if (pageId === "knowledge") {
        updateKnowledgeStats();
        renderKnowledgeList();
    } else if (pageId === "analytics") {
        updateAnalytics();
    } else if (pageId === "favorites") {
        renderFavorites();
    } else if (pageId === "templates") {
        renderTemplates();
    } else if (pageId === "teams") {
        // Load team management data
        loadTeamData();
    } else if (pageId === "admin") {
        // Load admin dashboard data
        if (typeof loadAdminDashboard === 'function') {
            loadAdminDashboard();
        }
    }
}

// ==================== TEAM MANAGEMENT ====================
let currentOrgId = null;
let currentUserRole = null;

async function loadTeamData() {
    try {
        // Get user's organization
        const orgResponse = await fetch(`${API_BASE_URL}/api/organizations/my`, {
            headers: getAuthHeaders()
        });

        if (!orgResponse.ok) {
            throw new Error('Failed to load organization');
        }

        const orgData = await orgResponse.json();
        // Backend returns { organizations: [...] } - grab the first one
        const org = orgData.organizations?.[0] || orgData.organization || null;

        if (!org) {
            // User has no organization
            document.getElementById('orgName').textContent = 'No Organization';
            document.getElementById('userRole').textContent = '-';
            document.getElementById('subscriptionStatus').textContent = '-';
            document.getElementById('totalMembers').textContent = '0';
            document.getElementById('membersList').innerHTML = '<p class="no-invitations">You are not part of any organization yet.</p>';
            document.getElementById('inviteSection').style.display = 'none';
            document.getElementById('pendingInvitationsCard').style.display = 'none';
            document.getElementById('contentTemplatesSection').style.display = 'none';
            return;
        }

        currentOrgId = org.id;
        currentUserRole = org.role;

        // Update organization details
        document.getElementById('orgName').textContent = org.name || '-';
        document.getElementById('userRole').textContent = formatRole(org.role);
        document.getElementById('subscriptionStatus').textContent = formatSubscriptionStatus(org.subscription_status);
        document.getElementById('totalMembers').textContent = org.member_count || '-';

        // Show/hide invite section and org profile based on role
        const canManageOrg = ['owner', 'admin'].includes(currentUserRole);
        document.getElementById('inviteSection').style.display = canManageOrg ? 'block' : 'none';
        document.getElementById('orgProfileSection').style.display = canManageOrg ? 'block' : 'none';
        document.getElementById('drawScheduleSection').style.display = canManageOrg ? 'block' : 'none';
        document.getElementById('contentTemplatesSection').style.display = canManageOrg ? 'block' : 'none';

        // Populate org profile fields
        if (canManageOrg) {
            populateOrgProfile(org);
            renderOrgTemplates();
        }

        // Load members
        await loadMembers();

    } catch (error) {
        console.error('Error loading team data:', error);
        showToast('Failed to load team data', 'error');
    }
}

function populateOrgProfile(org) {
    if (!org) return;
    const fields = {
        orgProfileWebsite: org.website_url || '',
        orgProfileLicence: org.licence_number || '',
        orgProfileStoreLocation: org.store_location || '',
        orgProfileSupportEmail: org.support_email || '',
        orgProfileCeoName: org.ceo_name || '',
        orgProfileCeoTitle: org.ceo_title || '',
        orgProfileMediaContactName: org.media_contact_name || '',
        orgProfileMediaContactEmail: org.media_contact_email || '',
        orgProfileCtaWebsite: org.cta_website_url || '',
        orgProfileMission: org.mission || '',
        orgProfileDrawTime: org.default_draw_time || '',
        orgProfileDeadlineTime: org.ticket_deadline_time || '',
        orgProfileSocialLine: org.social_required_line || ''
    };
    for (const [id, value] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    // Populate brand terminology (stored as JSON)
    const bt = org.brand_terminology;
    if (bt) {
        try {
            const parsed = typeof bt === 'string' ? JSON.parse(bt) : bt;
            const el = document.getElementById('orgProfileBrandTerminology');
            if (el && parsed.notes) el.value = parsed.notes.join('\n');
        } catch (e) { /* ignore parse errors */ }
    }

    // Populate email add-ons (stored as JSON)
    const ea = org.email_addons;
    if (ea) {
        try {
            const parsed = typeof ea === 'string' ? JSON.parse(ea) : ea;
            const subEl = document.getElementById('orgProfileAddonSubscriptions');
            const ctaEl = document.getElementById('orgProfileAddonCatchTheAce');
            const otherEl = document.getElementById('orgProfileAddonOther');
            if (subEl && parsed.subscriptions) subEl.value = parsed.subscriptions;
            if (ctaEl && parsed.catchTheAce) ctaEl.value = parsed.catchTheAce;
            if (otherEl && parsed.other) otherEl.value = parsed.other;
        } catch (e) { /* ignore parse errors */ }
    }
}

async function saveOrgProfile() {
    if (!currentOrgId) return;

    const btn = document.getElementById('saveOrgProfileBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        // Build brand terminology JSON from textarea (one rule per line)
        const brandTermRaw = (document.getElementById('orgProfileBrandTerminology')?.value || '').trim();
        const brandTerminology = brandTermRaw ? JSON.stringify({
            notes: brandTermRaw.split('\n').map(l => l.trim()).filter(Boolean)
        }) : null;

        // Build email add-ons JSON
        const subText = (document.getElementById('orgProfileAddonSubscriptions')?.value || '').trim();
        const ctaText = (document.getElementById('orgProfileAddonCatchTheAce')?.value || '').trim();
        const otherText = (document.getElementById('orgProfileAddonOther')?.value || '').trim();
        const emailAddons = (subText || ctaText || otherText) ? JSON.stringify({
            subscriptions: subText || undefined,
            catchTheAce: ctaText || undefined,
            other: otherText || undefined
        }) : null;

        const payload = {
            websiteUrl: document.getElementById('orgProfileWebsite').value.trim(),
            licenceNumber: document.getElementById('orgProfileLicence').value.trim(),
            storeLocation: document.getElementById('orgProfileStoreLocation').value.trim(),
            supportEmail: document.getElementById('orgProfileSupportEmail').value.trim(),
            ceoName: document.getElementById('orgProfileCeoName').value.trim(),
            ceoTitle: document.getElementById('orgProfileCeoTitle').value.trim(),
            mediaContactName: document.getElementById('orgProfileMediaContactName').value.trim(),
            mediaContactEmail: document.getElementById('orgProfileMediaContactEmail').value.trim(),
            ctaWebsiteUrl: document.getElementById('orgProfileCtaWebsite').value.trim(),
            mission: document.getElementById('orgProfileMission').value.trim(),
            defaultDrawTime: document.getElementById('orgProfileDrawTime')?.value.trim() || null,
            ticketDeadlineTime: document.getElementById('orgProfileDeadlineTime')?.value.trim() || null,
            socialRequiredLine: document.getElementById('orgProfileSocialLine')?.value.trim() || null,
            brandTerminology,
            emailAddons
        };

        const response = await fetch(`${API_BASE_URL}/api/organizations/${currentOrgId}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        if (response.status === 409) {
            showToast('Settings were modified by someone else. Please refresh and try again.', 'error');
            btn.disabled = false;
            btn.textContent = 'Save Profile';
            return;
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to save');
        }

        const data = await response.json();

        // Update the cached organization data so Draft/Response Assistants use new values immediately
        if (currentUser) {
            currentUser.organization = { ...currentUser.organization, ...data.organization };
        }

        showToast('Organization profile saved!', 'success');
    } catch (error) {
        console.error('Save org profile error:', error);
        showToast('Failed to save profile: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Profile';
    }
}

// ==================== DATA EXPORT ====================
async function exportOrganizationData() {
    if (!currentOrgId) {
        showToast('No organization found', 'error');
        return;
    }

    const btn = document.getElementById('exportOrgDataBtn');
    btn.disabled = true;
    btn.textContent = 'Preparing export...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/organizations/${currentOrgId}/export`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Export failed');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const filename = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `lightspeed-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('Data exported successfully!', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showToast(error.message || 'Failed to export data', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '📥 Export All Data (JSON)';
    }
}
window.exportOrganizationData = exportOrganizationData;

// ==================== CONTENT TEMPLATE MANAGEMENT ====================

const TEMPLATE_TYPE_LABELS = {
    'social': 'Social Media',
    'email-new-draw': 'Email: New Draw',
    'email-reminder': 'Email: Reminder',
    'email-winners': 'Email: Winners',
    'email-impact': 'Email: Impact',
    'email-last-chance': 'Email: Last Chance',
    'media-release': 'Media Release',
    'social-ads': 'Social Ads'
};

let contentTemplateFilter = 'all';

function filterTemplates(filter) {
    contentTemplateFilter = filter;
    document.querySelectorAll('.template-type-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderOrgTemplates();
}

function renderOrgTemplates() {
    const container = document.getElementById('orgTemplatesList');
    if (!container) return;

    let templates = orgContentTemplates;
    if (contentTemplateFilter !== 'all') {
        if (contentTemplateFilter === 'email') {
            templates = templates.filter(t => t.template_type.startsWith('email-'));
        } else {
            templates = templates.filter(t => t.template_type === contentTemplateFilter);
        }
    }

    if (templates.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: #9ca3af; font-size: 0.9rem;">
            No templates yet. Import from the library or create your own.
        </div>`;
        return;
    }

    container.innerHTML = templates.map(t => `
        <div class="template-item" style="display: flex; justify-content: space-between; align-items: flex-start; padding: 0.75rem; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 0.5rem;">
            <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                    <strong style="font-size: 0.9rem;">${escapeHtml(t.name)}</strong>
                    <span style="font-size: 0.7rem; background: #f3f4f6; padding: 0.15rem 0.4rem; border-radius: 4px; color: #6b7280;">${TEMPLATE_TYPE_LABELS[t.template_type] || t.template_type}</span>
                </div>
                <div style="font-size: 0.8rem; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml((t.content || '').substring(0, 100))}${t.content.length > 100 ? '...' : ''}</div>
            </div>
            <button class="btn-secondary" style="font-size: 0.75rem; padding: 0.2rem 0.5rem; color: #dc2626; border-color: #fecaca; flex-shrink: 0; margin-left: 0.5rem;" onclick="deleteTemplate('${t.id}')">Remove</button>
        </div>
    `).join('');
}

async function showTemplateLibrary() {
    const modal = document.getElementById('templateLibraryModal');
    modal.style.display = 'block';

    const listEl = document.getElementById('templateLibraryList');
    listEl.innerHTML = '<div style="text-align: center; padding: 1rem; color: #9ca3af;">Loading library...</div>';

    try {
        const response = await fetch(`${API_BASE_URL}/api/content-templates/library`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) throw new Error('Failed to load library');

        const data = await response.json();
        const library = data.templates || [];

        if (library.length === 0) {
            listEl.innerHTML = '<div style="text-align: center; padding: 1rem; color: #9ca3af;">No system templates available.</div>';
            return;
        }

        listEl.innerHTML = library.map(t => `
            <label style="display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem; border-bottom: 1px solid #f3f4f6; cursor: pointer;">
                <input type="checkbox" class="library-template-cb" value="${t.id}" style="margin-top: 0.2rem;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <strong style="font-size: 0.85rem;">${escapeHtml(t.name)}</strong>
                        <span style="font-size: 0.65rem; background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 3px; color: #6b7280;">${TEMPLATE_TYPE_LABELS[t.template_type] || t.template_type}</span>
                    </div>
                    <div style="font-size: 0.75rem; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml((t.content || '').substring(0, 80))}</div>
                </div>
            </label>
        `).join('');
    } catch (error) {
        console.error('Load template library error:', error);
        listEl.innerHTML = '<div style="text-align: center; padding: 1rem; color: #ef4444;">Failed to load template library</div>';
    }
}

async function importSelectedTemplates() {
    const checkboxes = document.querySelectorAll('.library-template-cb:checked');
    const templateIds = Array.from(checkboxes).map(cb => cb.value);

    if (templateIds.length === 0) {
        showToast('Select at least one template to import', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/content-templates/import`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ templateIds })
        });

        if (!response.ok) throw new Error('Failed to import');

        const data = await response.json();
        showToast(data.message, 'success');

        document.getElementById('templateLibraryModal').style.display = 'none';
        await loadContentTemplatesFromBackend();
        renderOrgTemplates();
    } catch (error) {
        console.error('Import templates error:', error);
        showToast('Failed to import templates: ' + error.message, 'error');
    }
}

async function importAllTemplates() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/content-templates/import-all`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({})
        });

        if (!response.ok) throw new Error('Failed to import');

        const data = await response.json();
        showToast(data.message, 'success');

        document.getElementById('templateLibraryModal').style.display = 'none';
        await loadContentTemplatesFromBackend();
        renderOrgTemplates();
    } catch (error) {
        console.error('Import all templates error:', error);
        showToast('Failed to import templates: ' + error.message, 'error');
    }
}

function showAddTemplateForm() {
    document.getElementById('addTemplateForm').style.display = 'block';
    document.getElementById('newTemplateName').value = '';
    document.getElementById('newTemplateContent').value = '';
    document.getElementById('newTemplateSubject').value = '';
    document.getElementById('newTemplateHeadline').value = '';
}

async function saveNewTemplate() {
    const name = document.getElementById('newTemplateName').value.trim();
    const content = document.getElementById('newTemplateContent').value.trim();
    const templateType = document.getElementById('newTemplateType').value;
    const subject = document.getElementById('newTemplateSubject').value.trim();
    const headline = document.getElementById('newTemplateHeadline').value.trim();

    if (!name || !content) {
        showToast('Name and content are required', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/content-templates`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ templateType, name, content, subject: subject || null, headline: headline || null })
        });

        if (!response.ok) throw new Error('Failed to create');

        showToast('Template created!', 'success');
        document.getElementById('addTemplateForm').style.display = 'none';
        await loadContentTemplatesFromBackend();
        renderOrgTemplates();
    } catch (error) {
        console.error('Create template error:', error);
        showToast('Failed to create template: ' + error.message, 'error');
    }
}

async function deleteTemplate(id) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/content-templates/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (!response.ok) throw new Error('Failed to delete');

        showToast('Template removed', 'success');
        await loadContentTemplatesFromBackend();
        renderOrgTemplates();
    } catch (error) {
        console.error('Delete template error:', error);
        showToast('Failed to delete template: ' + error.message, 'error');
    }
}

// ==================== END CONTENT TEMPLATE MANAGEMENT ====================

async function loadMembers() {
    if (!currentOrgId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/organizations/${currentOrgId}/members`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to load members');
        }

        const data = await response.json();

        // Update total members count
        document.getElementById('totalMembers').textContent = data.members.length;

        // Render members list
        renderMembersList(data.members);

        // Render pending invitations
        renderPendingInvitations(data.pendingInvitations || []);

    } catch (error) {
        console.error('Error loading members:', error);
        document.getElementById('membersList').innerHTML = '<p class="no-invitations">Failed to load members</p>';
    }
}

function renderMembersList(members) {
    const container = document.getElementById('membersList');

    if (!members || members.length === 0) {
        container.innerHTML = '<p class="no-invitations">No team members yet</p>';
        return;
    }

    const canManage = ['owner', 'admin'].includes(currentUserRole);
    const isOwner = currentUserRole === 'owner';

    container.innerHTML = members.map(member => {
        const initials = getInitials(member.first_name, member.last_name, member.email);
        const name = `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email;
        const isCurrentUser = member.id === currentUser?.backendId;

        return `
            <div class="member-item">
                <div class="member-info">
                    <div class="member-avatar">${initials}</div>
                    <div class="member-details">
                        <span class="member-name">${escapeHtml(name)}${isCurrentUser ? ' (You)' : ''}</span>
                        <span class="member-email">${escapeHtml(member.email)}</span>
                    </div>
                </div>
                <div class="member-actions">
                    ${member.role === 'owner' ?
                        `<span class="member-role owner">👑 Owner</span>` :
                        canManage && !isCurrentUser && isOwner ?
                            `<select class="member-role-select" onchange="updateMemberRole('${member.id}', this.value)">
                                <option value="member" ${member.role === 'member' ? 'selected' : ''}>Member</option>
                                <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>` :
                            `<span class="member-role ${member.role}">${formatRole(member.role)}</span>`
                    }
                    ${canManage && member.role !== 'owner' && !isCurrentUser ?
                        `<button class="member-remove-btn" onclick="removeMember('${member.id}')" title="Remove member">🗑️</button>` :
                        ''
                    }
                </div>
            </div>
        `;
    }).join('');
}

function renderPendingInvitations(invitations) {
    const container = document.getElementById('pendingInvitations');
    const card = document.getElementById('pendingInvitationsCard');

    if (!invitations || invitations.length === 0) {
        container.innerHTML = '<p class="no-invitations">No pending invitations</p>';
        card.style.display = ['owner', 'admin'].includes(currentUserRole) ? 'block' : 'none';
        return;
    }

    card.style.display = 'block';

    container.innerHTML = invitations.map(inv => {
        const expiresAt = new Date(inv.expires_at);
        const daysLeft = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));

        return `
            <div class="invitation-item">
                <div class="invitation-info">
                    <span class="invitation-email">${escapeHtml(inv.email)}</span>
                    <span class="invitation-meta">Role: ${formatRole(inv.role)} • Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}</span>
                </div>
                <button class="invitation-cancel-btn" onclick="cancelInvitation('${inv.id}')">Cancel</button>
            </div>
        `;
    }).join('');
}

async function sendInvitation() {
    const emailInput = document.getElementById('inviteEmail');
    const roleSelect = document.getElementById('inviteRole');
    const email = emailInput.value.trim();
    const role = roleSelect.value;

    if (!email) {
        showToast('Please enter an email address', 'error');
        return;
    }

    if (!isValidEmail(email)) {
        showToast('Please enter a valid email address', 'error');
        return;
    }

    const sendBtn = document.getElementById('sendInviteBtn');
    const originalText = sendBtn.innerHTML;
    sendBtn.innerHTML = '<span>⏳</span> Sending...';
    sendBtn.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/organizations/${currentOrgId}/invite`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ email, role })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to send invitation');
        }

        emailInput.value = '';
        roleSelect.value = 'member';

        // Show the invite link modal so user can copy and share it
        if (data.inviteLink) {
            showInviteLinkModal(data.inviteLink, email, data.emailSent);
        } else {
            showToast('Invitation created successfully!', 'success');
        }

        // Reload members to show pending invitation
        await loadMembers();

    } catch (error) {
        console.error('Error sending invitation:', error);
        showToast(error.message || 'Failed to send invitation', 'error');
    } finally {
        sendBtn.innerHTML = originalText;
        sendBtn.disabled = false;
    }
}

async function removeMember(memberId) {
    if (!confirm('Are you sure you want to remove this member from the organization?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/organizations/${currentOrgId}/members/${memberId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to remove member');
        }

        showToast('Member removed successfully', 'success');
        await loadMembers();

    } catch (error) {
        console.error('Error removing member:', error);
        showToast(error.message || 'Failed to remove member', 'error');
    }
}

async function updateMemberRole(memberId, newRole) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/organizations/${currentOrgId}/members/${memberId}`, {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({ role: newRole })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to update role');
        }

        showToast('Role updated successfully', 'success');
        await loadMembers();

    } catch (error) {
        console.error('Error updating role:', error);
        showToast(error.message || 'Failed to update role', 'error');
        await loadMembers(); // Refresh to reset the select
    }
}

async function cancelInvitation(invitationId) {
    if (!confirm('Are you sure you want to cancel this invitation?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/organizations/${currentOrgId}/invitations/${invitationId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to cancel invitation');
        }

        showToast('Invitation cancelled', 'success');
        await loadMembers();

    } catch (error) {
        console.error('Error cancelling invitation:', error);
        showToast(error.message || 'Failed to cancel invitation', 'error');
    }
}

function formatRole(role) {
    const roles = {
        owner: '👑 Owner',
        admin: '🛡️ Admin',
        member: '👤 Member'
    };
    return roles[role] || role;
}

function formatSubscriptionStatus(status) {
    const statuses = {
        trialing: '🎁 Trial',
        active: '✅ Active',
        past_due: '⚠️ Past Due',
        cancelled: '❌ Cancelled',
        incomplete: '⏳ Incomplete'
    };
    return statuses[status] || status || '-';
}

function getInitials(firstName, lastName, email) {
    if (firstName && lastName) {
        return (firstName[0] + lastName[0]).toUpperCase();
    }
    if (firstName) {
        return firstName.substring(0, 2).toUpperCase();
    }
    if (email) {
        return email.substring(0, 2).toUpperCase();
    }
    return 'U';
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showInviteLinkModal(inviteLink, email, emailSent) {
    // Create modal overlay if it doesn't exist
    let modalOverlay = document.getElementById('inviteLinkModalOverlay');
    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'inviteLinkModalOverlay';
        modalOverlay.className = 'modal-overlay';
        modalOverlay.innerHTML = `
            <div class="modal invite-link-modal">
                <div class="modal-header">
                    <h3 class="modal-title" id="inviteModalTitle">Invitation Created</h3>
                    <button class="modal-close" onclick="closeInviteLinkModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="emailSentBanner" style="display:none; background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; color: #065f46;">
                        <strong>Email sent!</strong> An invitation email has been sent to <strong id="emailSentTo"></strong>.
                    </div>
                    <p class="invite-link-desc" id="inviteLinkDesc">You can also share this link directly with <strong id="inviteEmailDisplay"></strong>:</p>
                    <div class="invite-link-container">
                        <input type="text" id="inviteLinkInput" readonly class="invite-link-input">
                        <button class="btn-primary copy-link-btn" onclick="copyInviteLink()">
                            <span id="copyLinkIcon">📋</span> Copy
                        </button>
                    </div>
                    <p class="invite-link-note">This link expires in 7 days. The invited user can also just sign up with Google using this email - they'll automatically join your organization.</p>
                </div>
            </div>
        `;
        // Click outside to close
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeInviteLinkModal();
            }
        });
        document.body.appendChild(modalOverlay);
    }

    // Populate and show
    const banner = document.getElementById('emailSentBanner');
    const desc = document.getElementById('inviteLinkDesc');
    const title = document.getElementById('inviteModalTitle');

    if (emailSent) {
        title.textContent = 'Invitation Sent!';
        banner.style.display = 'block';
        document.getElementById('emailSentTo').textContent = email;
        desc.innerHTML = `You can also share this link directly with <strong id="inviteEmailDisplay"></strong>:`;
    } else {
        title.textContent = 'Invitation Created';
        banner.style.display = 'none';
        desc.innerHTML = `Share this link with <strong id="inviteEmailDisplay"></strong> to invite them to your organization:`;
    }

    document.getElementById('inviteEmailDisplay').textContent = email;
    document.getElementById('inviteLinkInput').value = inviteLink;
    modalOverlay.classList.add('show');
}

function closeInviteLinkModal() {
    const modalOverlay = document.getElementById('inviteLinkModalOverlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('show');
    }
}

async function copyInviteLink() {
    const input = document.getElementById('inviteLinkInput');
    const link = input.value;

    try {
        await navigator.clipboard.writeText(link);

        const icon = document.getElementById('copyLinkIcon');
        icon.textContent = '✅';
        showToast('Link copied to clipboard!', 'success');

        setTimeout(() => {
            icon.textContent = '📋';
        }, 2000);
    } catch (err) {
        // Fallback for older browsers or if clipboard API fails
        input.focus();
        input.select();
        input.setSelectionRange(0, 99999);

        try {
            document.execCommand('copy');
            const icon = document.getElementById('copyLinkIcon');
            icon.textContent = '✅';
            showToast('Link copied to clipboard!', 'success');
            setTimeout(() => {
                icon.textContent = '📋';
            }, 2000);
        } catch (fallbackErr) {
            showToast('Failed to copy - please select and copy manually', 'error');
        }
    }
}

// Make team functions available globally
window.sendInvitation = sendInvitation;
window.removeMember = removeMember;
window.updateMemberRole = updateMemberRole;
window.cancelInvitation = cancelInvitation;
window.closeInviteLinkModal = closeInviteLinkModal;
window.copyInviteLink = copyInviteLink;

// ==================== SETTINGS ====================
function saveSettings() {
    defaultName = document.getElementById("defaultName").value.trim() || "Bella";
    orgName = document.getElementById("orgName").value.trim();
    responseLanguage = document.getElementById("responseLanguage").value || "en";

    // Save to user data (handles localStorage automatically)
    saveUserData();

    document.getElementById("staffName").value = defaultName;

    document.getElementById("settingsModal").classList.remove("show");

    const saveBtn = document.getElementById("saveSettings");
    saveBtn.textContent = "✓ Saved!";
    showToast("Settings saved!", "success");
    setTimeout(() => saveBtn.textContent = "Save Settings", 1500);
}

// ==================== RESPONSE GENERATOR ====================
async function handleGenerate() {
    const customerEmail = document.getElementById("customerEmail").value.trim();
    const staffName = document.getElementById("staffName").value.trim() || "Bella";

    if (!customerEmail) {
        showError("Please paste a customer inquiry first.");
        return;
    }

    // Get tone and length settings
    const toneValue = document.getElementById("toneSlider").value;
    const lengthValue = document.getElementById("lengthSlider").value;
    const includeLinks = document.getElementById("includeLinks").checked;
    const includeSteps = document.getElementById("includeSteps").checked;
    const agentInstructions = document.getElementById("agentInstructions")?.value.trim() || "";

    // Show loading state
    const generateBtn = document.getElementById("generateBtn");
    generateBtn.disabled = true;
    generateBtn.innerHTML = `<span class="btn-icon">⏳</span> Generating...`;

    const responseArea = document.getElementById("responseArea");
    // Create a streaming container so the user sees text appear in real time
    responseArea.innerHTML = `
        <div class="response-section">
            <div class="response-header">
                <div class="response-label">
                    <span class="response-label-icon">⏳</span>
                    <span class="response-label-text" id="streamingLabel">Generating...</span>
                </div>
            </div>
            <div class="response-box" id="streamingResponseText"></div>
        </div>
    `;

    const streamTarget = document.getElementById("streamingResponseText");
    const startTime = Date.now();

    try {
        const relevantKnowledge = getRelevantKnowledge(customerEmail);
        const result = await generateCustomResponse(
            customerEmail, relevantKnowledge, staffName,
            { toneValue, lengthValue, includeLinks, includeSteps, agentInstructions, streamTarget }
        );

        const responseText = stripCitations(result.text);
        const referencedKbEntries = result.referencedKbEntries || [];

        const responseTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const category = detectCategory(customerEmail);

        // Save to history
        const historyEntry = {
            id: `history-${Date.now()}`,
            backendId: null,
            inquiry: customerEmail,
            response: responseText,
            referencedKbEntries: referencedKbEntries,
            staffName: staffName,
            category: category,
            timestamp: new Date().toISOString(),
            responseTime: parseFloat(responseTime),
            rating: null
        };
        responseHistory.unshift(historyEntry);
        if (responseHistory.length > 100) responseHistory.pop();

        currentResponse = responseText;
        currentInquiry = customerEmail;
        currentReferencedKb = referencedKbEntries;
        currentHistoryId = historyEntry.id;

        // Save user data with updated history
        saveUserData();

        // Also save to backend for persistent history + rating support
        try {
            const toneDesc = toneValue < 33 ? "formal" : toneValue > 66 ? "friendly" : "balanced";
            const backendResp = await fetch(`${API_BASE_URL}/api/response-history`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    inquiry: customerEmail,
                    response: responseText,
                    format: inquiryType || 'email',
                    tone: toneDesc
                })
            });
            if (backendResp.ok) {
                const backendData = await backendResp.json();
                historyEntry.backendId = backendData.entry.id;
                saveUserData();
            } else {
                showToast("Response saved locally but cloud sync failed — it won't appear on other devices", "error");
            }
        } catch (error) {
            console.warn('Failed to save response to backend:', error);
            showToast("Response saved locally but cloud sync failed — it won't appear on other devices", "error");
        }

        displayResults(responseText, historyEntry.id);

    } catch (error) {
        console.error("Error:", error);
        showError("Something went wrong. Please try again.");
    } finally {
        generateBtn.disabled = false;
        generateBtn.innerHTML = `<span class="btn-icon">⚡</span> Generate Response`;
    }
}

function detectCategory(text) {
    const lowerText = text.toLowerCase();
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some(kw => lowerText.includes(kw))) {
            return category;
        }
    }
    return "general";
}

function showError(message) {
    document.getElementById("responseArea").innerHTML = `
        <div class="response-placeholder" style="color: #dc2626;">
            <div class="placeholder-icon">⚠️</div>
            <div class="placeholder-text">${message}</div>
        </div>
    `;
}

function getAllKnowledge() {
    // Only return org-specific (database-backed) knowledge for AI prompts.
    // The hardcoded KNOWLEDGE_BASE templates are shown in the UI as reference
    // material but are NOT injected into AI prompts — this prevents one client's
    // domain knowledge from leaking into another client's AI-generated responses.
    return [...customKnowledge];
}

// Rank knowledge entries by relevance to the customer inquiry
function getRelevantKnowledge(inquiry) {
    const allKnowledge = getAllKnowledge();
    const queryWords = inquiry.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    // Score each entry by how many query words match its keywords or question
    const scored = allKnowledge.map(entry => {
        const entryText = `${entry.question} ${entry.keywords.join(' ')} ${entry.response}`.toLowerCase();
        let score = 0;
        for (const word of queryWords) {
            if (entryText.includes(word)) score++;
        }
        // Boost custom entries slightly so user-added knowledge is prioritized
        if (entry.id && entry.id.toString().startsWith('custom')) score += 2;
        return { entry, score };
    });

    // Sort by relevance score (highest first), then take top 30
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 30).map(s => s.entry);
}

// Fetch rated examples from backend for AI learning
// Optional format param ('email' or 'facebook') scopes examples to matching format
async function getRatedExamples(tool = 'response_assistant', format = null, inquiry = null) {
    try {
        let url = `${API_BASE_URL}/api/response-history/rated-examples?tool=${tool}`;
        if (format) url += `&format=${encodeURIComponent(format)}`;
        if (inquiry) url += `&inquiry=${encodeURIComponent(inquiry)}`;
        const response = await fetch(url, {
            headers: getAuthHeaders()
        });
        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.warn('Could not fetch rated examples:', error);
    }
    return { positive: [], negative: [] };
}

function buildRatedExamplesContext(ratedExamples) {
    if (!ratedExamples) return '';

    let context = '';

    if (ratedExamples.positive && ratedExamples.positive.length > 0) {
        context += '\n\nPREVIOUSLY APPROVED RESPONSES (emulate this style and approach):\n';
        ratedExamples.positive.forEach((ex, i) => {
            context += `\nExample ${i + 1}:\nCustomer inquiry: ${ex.inquiry}\nApproved response: ${ex.response}\n`;
        });
    }

    if (ratedExamples.negative && ratedExamples.negative.length > 0) {
        context += '\n\nPREVIOUSLY REJECTED RESPONSES (avoid these patterns):\n';
        ratedExamples.negative.forEach((ex, i) => {
            context += `\nExample ${i + 1}:\nCustomer inquiry: ${ex.inquiry}\nRejected response: ${ex.response}\n`;
            if (ex.rating_feedback) {
                context += `Reason for rejection: ${ex.rating_feedback}\n`;
            }
            if (ex.corrected_response) {
                context += `Correct response: ${ex.corrected_response}\n`;
            }
        });
    }

    return context;
}

async function generateCustomResponse(customerEmail, knowledge, staffName, options) {
    const { toneValue, lengthValue, includeLinks, includeSteps, agentInstructions } = options;
    const isFacebook = inquiryType === "facebook";

    const toneDesc = toneValue < 33 ? "formal and professional" :
                     toneValue > 66 ? "warm and friendly" : "balanced";
    const lengthDesc = isFacebook ? "very brief (MUST be under 400 characters total)" :
                       lengthValue < 33 ? "brief and concise" :
                       lengthValue > 66 ? "detailed and thorough" : "moderate length";

    // KB entries are now picked server-side by the Haiku relevance picker.
    // We no longer dump all entries here — the backend handles it when we pass `inquiry`.

    // Fetch rated examples for learning, scoped to the current format and filtered by topic relevance
    const currentFormat = isFacebook ? 'facebook' : 'email';
    const ratedExamples = await getRatedExamples('response_assistant', currentFormat, customerEmail);

    // Get draw schedule context (org-specific if available, else hardcoded fallback)
    const drawScheduleContext = getDrawScheduleContext();

    // Get org profile values for dynamic prompts
    const org = currentUser?.organization;
    const orgName = org?.name || 'our organization';
    const orgWebsite = org?.website_url || '';
    const orgSupportEmail = org?.support_email || '';

    // Format instructions based on inquiry type
    let formatInstructions = "";
    if (isFacebook) {
        const fbEmailDirective = orgSupportEmail
            ? `"Please email us at ${orgSupportEmail} and our team will assist you as soon as possible."`
            : '"Please email us and our team will assist you as soon as possible."';
        formatInstructions = `FORMAT: This is a FACEBOOK COMMENT response.
- CRITICAL: Response MUST be under 400 characters total (including signature)
- Write in a single paragraph - NO line breaks, NO bullet points, NO numbered lists
- Be friendly but concise
- End with a dash and the staff name (e.g., "-${staffName}")
- Do NOT include greetings like "Hi" or "Hello" - jump right into the response
- Do NOT include email signatures, contact info, or closing phrases like "Best regards"

FACEBOOK PRIVACY RULE - VERY IMPORTANT:
- NEVER offer to take direct action on Facebook (e.g., "I'll resend your tickets", "I've forwarded this to our team", "Let me look into your account")
- Facebook is a public platform where we cannot verify identity or handle sensitive account matters
- Instead, ALWAYS direct the customer to email us: ${fbEmailDirective}
- You can acknowledge their concern briefly, but the solution must be to email us`;
    } else {
        const linkInfo = orgWebsite ? `You MUST include ${orgWebsite} in the response. Reference it naturally (e.g., "Visit ${orgWebsite} for..." or "You can find more at ${orgWebsite}").` : 'Include relevant website links when helpful.';
        formatInstructions = `${includeLinks ? `LINKS: ${linkInfo}` : "LINKS: Minimize links unless essential."}
${includeSteps ? "FORMAT: Include step-by-step instructions when applicable." : "FORMAT: Use flowing paragraphs, avoid numbered lists unless necessary."}`;
    }

    // Build dynamic org info section
    let orgInfoSection = `ORGANIZATION INFO:\n- Organization: ${orgName}`;
    if (orgWebsite) orgInfoSection += `\n- Lottery Website: ${orgWebsite} (ONLY use this URL - do NOT make up other URLs)`;
    if (orgSupportEmail) orgInfoSection += `\n- Support Email: ${orgSupportEmail}`;
    if (org?.store_location) orgInfoSection += `\n- In-Person Location: ${org.store_location}`;
    if (org?.licence_number) orgInfoSection += `\n- Licence Number: ${org.licence_number}`;
    if (org?.cta_website_url) orgInfoSection += `\n- Catch The Ace Website: ${org.cta_website_url}`;

    if (orgWebsite) {
        orgInfoSection += `\n\nIMPORTANT: Only use the URLs listed above. Do NOT invent or guess other URLs - they may not exist.`;
    }
    if (org?.mission) {
        orgInfoSection += `\n\nORGANIZATION MISSION: ${org.mission}`;
    }

    const systemPrompt = `You are a helpful customer support assistant for ${orgName}, a charitable lottery organization.

TONE: Write in a ${toneDesc} tone.
LENGTH: Keep the response ${lengthDesc}.
${getLanguageInstruction()}${formatInstructions}

${orgInfoSection}

${drawScheduleContext}

GENERAL LOTTERY KNOWLEDGE (use only when relevant and not contradicted by the organization's knowledge base):
- Winners are typically contacted directly by phone
- Tax receipts generally cannot be issued for lottery tickets (they are not charitable donations under CRA rules)

DRAW DATE AWARENESS: If the customer asks about draw dates, Early Birds, or when the next draw is, use the draw schedule information above to give them accurate, specific dates. If no draw schedule is available, let the customer know they can check the organization's website for the latest schedule. If there's an Early Bird draw happening today or tomorrow and it's relevant to mention, include that information naturally.

ESCALATION: If the inquiry is unclear, bizarre, nonsensical, confrontational, threatening, or simply cannot be answered with the knowledge available, write a polite response explaining that you will pass the email along to your manager who can look into it further. Do not attempt to answer questions you don't have information for.

IMPORTANT: Only reference information from the organization knowledge base below and the draw schedule above. Do not assume details about websites, locations, game types, eligibility rules, or operational procedures that are not explicitly provided.

Knowledge base:
${buildRatedExamplesContext(ratedExamples)}`;

    const instructionsBlock = agentInstructions
        ? `\nAGENT INSTRUCTIONS (from the staff member — follow these closely):\n${agentInstructions}\n`
        : '';

    let userPrompt;
    if (isFacebook) {
        const fbEmailRef = orgSupportEmail ? `direct them to email ${orgSupportEmail} for assistance` : 'direct them to email for assistance';
        userPrompt = `Write a FACEBOOK COMMENT reply to this inquiry. Remember: under 400 characters, single paragraph, end with -${staffName}

IMPORTANT: Do NOT offer to take any direct action. Instead, ${fbEmailRef}.
${instructionsBlock}
INQUIRY:
${customerEmail}`;
    } else {
        userPrompt = `Write a response to this inquiry. Detect which lottery it's about from context.
${instructionsBlock}
INQUIRY:
${customerEmail}

Sign as: ${staffName}`;
    }

    const streamTarget = options.streamTarget;
    const requestBody = {
        system: systemPrompt,
        inquiry: customerEmail,
        messages: [{ role: "user", content: userPrompt }],
        max_tokens: isFacebook ? 200 : 1024
    };

    // Stream if a target element is provided
    if (streamTarget) {
        const { text, referencedKbEntries } = await fetchStream(requestBody, {
            onText: (chunk) => {
                streamTarget._rawText = (streamTarget._rawText || '') + chunk;
                streamTarget.innerHTML = escapeHtmlWithLinks(stripCitations(streamTarget._rawText));
            },
            onKb: (entries) => {
                // KB entries are handled after streaming completes
            }
        });
        return { text, referencedKbEntries };
    }

    // Non-streaming fallback
    const response = await fetch(`${API_BASE_URL}/api/generate`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        await handleApiError(response);
    }

    const data = await response.json();
    return {
        text: data.content[0].text,
        referencedKbEntries: data.referenced_kb_entries || []
    };
}

function displayResults(response, historyId) {
    const qualityChecks = performQualityChecks(response);

    // Get sentiment from the original inquiry
    const sentimentHtml = currentInquiry ? displaySentimentBadge(currentInquiry) : '';

    document.getElementById("responseArea").innerHTML = `
        ${sentimentHtml}
        <div class="response-section">
            <div class="response-header">
                <div class="response-label">
                    <span class="response-label-icon">✨</span>
                    <span class="response-label-text">Ready to Send</span>
                </div>
                <div class="response-actions">
                    <button class="btn-copy" id="editModeBtn" onclick="toggleEditMode()">✏️ Edit</button>
                    <button class="btn-copy" onclick="copyToClipboard('responseText', this)">📋 Copy</button>
                    <button class="btn-copy" onclick="saveToFavorites()">⭐ Save</button>
                </div>
            </div>
            <div class="edit-mode-indicator" id="editModeIndicator" style="display: none;">
                <span>✏️</span>
                <span>Edit Mode - Click in the response to make changes</span>
            </div>
            <div class="response-box" id="responseText">${escapeHtmlWithLinks(response)}</div>
            <div class="edit-actions" id="editActions" style="display: none;">
                <button class="btn-edit-save" onclick="saveEdit()">💾 Save Changes</button>
                <button class="btn-edit-cancel" onclick="cancelEdit()">Cancel</button>
            </div>
        </div>

        <div class="rating-section">
            <span class="rating-label">Did this response work?</span>
            <button class="rating-btn thumbs-up" onclick="rateResponse('${historyId}', 'positive', this)">👍</button>
            <button class="rating-btn thumbs-down" onclick="rateResponse('${historyId}', 'negative', this)">👎</button>
        </div>

        ${currentReferencedKb.length > 0 ? `
        <div class="response-sources">
            <div class="response-sources-header" onclick="toggleSources()">
                <span class="response-sources-icon">📚</span>
                <span class="response-sources-title">Sources (${currentReferencedKb.length} KB entries used)</span>
                <span class="response-sources-toggle" id="sourcesToggle">▸</span>
            </div>
            <div class="response-sources-list" id="sourcesList" style="display:none;">
                ${currentReferencedKb.map(kb => `
                    <div class="response-source-item">
                        <span class="response-source-category">${escapeHtml(kb.category)}</span>
                        <span class="response-source-title">${escapeHtml(kb.title)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <div class="quality-checks">
            ${qualityChecks.map(check => `
                <div class="quality-item ${check.status}">
                    <span>${check.status === 'quality-pass' ? '✓' : check.status === 'quality-warn' ? '⚠' : '✗'}</span>
                    <span>${check.message}</span>
                </div>
            `).join('')}
        </div>

        <div class="refine-section">
            <div class="refine-header">
                <span class="refine-icon">🔄</span>
                <span class="refine-title">Refine Response</span>
            </div>
            <div class="refine-suggestions">
                <button class="refine-chip" onclick="refineResponse('make it more apologetic')">More apologetic</button>
                <button class="refine-chip" onclick="refineResponse('make it shorter')">Shorter</button>
                <button class="refine-chip" onclick="refineResponse('make it more detailed')">More detailed</button>
                <button class="refine-chip" onclick="refineResponse('make it friendlier')">Friendlier</button>
                <button class="refine-chip" onclick="refineResponse('make it more formal')">More formal</button>
            </div>
            <div class="refine-custom">
                <input type="text" id="refineInput" class="refine-input" placeholder="Or type your own instruction... (e.g., 'add information about the Early Bird draw')">
                <button class="refine-btn" onclick="refineResponse(document.getElementById('refineInput').value)" id="refineBtn">
                    <span class="btn-icon">✨</span> Refine
                </button>
            </div>
        </div>
    `;

    // Add enter key listener for refine input
    setTimeout(() => {
        const refineInput = document.getElementById('refineInput');
        if (refineInput) {
            refineInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && refineInput.value.trim()) {
                    refineResponse(refineInput.value);
                }
            });
        }
    }, 100);
}

function toggleSources() {
    const list = document.getElementById('sourcesList');
    const toggle = document.getElementById('sourcesToggle');
    if (!list) return;
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'block' : 'none';
    if (toggle) toggle.textContent = isHidden ? '▾' : '▸';
}

// ==================== REFINE RESPONSE ====================
async function refineResponse(instruction) {
    if (!instruction || !instruction.trim()) {
        showToast("Please enter a refinement instruction", "error");
        return;
    }

    if (!currentResponse || !currentInquiry) {
        showToast("No response to refine. Generate a response first.", "error");
        return;
    }

    const refineBtn = document.getElementById("refineBtn");
    const refineInput = document.getElementById("refineInput");
    const responseBox = document.getElementById("responseText");

    // Show loading state
    refineBtn.disabled = true;
    refineBtn.innerHTML = `<span class="btn-icon">⏳</span> Refining...`;
    document.querySelectorAll(".refine-chip").forEach(chip => chip.disabled = true);

    try {
        const isFacebook = inquiryType === "facebook";

        // Build KB context so refinements can draw on factual information
        let kbContext = '';
        if (currentReferencedKb.length > 0) {
            kbContext = '\n\nKNOWLEDGE BASE (use this to add accurate details when the instruction asks for more information):\n' +
                currentReferencedKb.map(kb => `[${kb.category}] ${kb.title}: ${kb.content}`).join('\n\n');
        }

        const systemPrompt = `You are a helpful assistant that refines customer support responses.
You will be given an original customer inquiry, the current response, and an instruction for how to modify it.
${getLanguageInstruction()}
IMPORTANT RULES:
- Keep the same general meaning and information, just adjust based on the instruction
- Maintain a professional, helpful tone
- Keep the response appropriate for customer support
- If this is a Facebook response, keep it under 400 characters and end with -${defaultName}
${isFacebook ? '- Facebook responses should be a single paragraph with no line breaks' : ''}
- If asked to add details, use ONLY information from the knowledge base below — do not make up facts
- Only output the refined response, nothing else${kbContext}`;

        const userPrompt = `ORIGINAL CUSTOMER INQUIRY:
${currentInquiry}

CURRENT RESPONSE:
${currentResponse}

INSTRUCTION: ${instruction.trim()}

Please provide the refined response:`;

        // Clear and stream into the response box
        responseBox.innerHTML = '';
        responseBox._rawText = '';

        const { text: refinedResponse } = await fetchStream({
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            max_tokens: isFacebook ? 200 : 1024
        }, {
            onText: (chunk) => {
                responseBox._rawText = (responseBox._rawText || '') + chunk;
                responseBox.innerHTML = escapeHtmlWithLinks(responseBox._rawText);
            }
        });

        // Update current response
        currentResponse = refinedResponse;

        // Update the response in history
        const historyEntry = responseHistory.find(h => h.id === currentHistoryId);
        if (historyEntry) {
            historyEntry.response = refinedResponse;
            saveUserData();
        }

        // Clear the input
        if (refineInput) refineInput.value = "";

        showToast("Response refined!", "success");

    } catch (error) {
        console.error("Refinement error:", error);
        showToast(error.message || "Failed to refine response", "error");
    } finally {
        // Reset button state
        refineBtn.disabled = false;
        refineBtn.innerHTML = `<span class="btn-icon">✨</span> Refine`;
        document.querySelectorAll(".refine-chip").forEach(chip => chip.disabled = false);
    }
}

function performQualityChecks(response) {
    const checks = [];
    const isFacebook = inquiryType === 'facebook';
    const lowerResponse = response.toLowerCase();
    const wordCount = response.split(/\s+/).length;
    const charCount = response.length;

    if (isFacebook) {
        // Facebook-specific checks
        if (charCount <= 400) {
            checks.push({ status: 'quality-pass', message: `Under 400 chars (${charCount})` });
        } else {
            checks.push({ status: 'quality-fail', message: `Over 400 chars (${charCount}) — Facebook will truncate` });
        }

        if (response.includes('\n')) {
            checks.push({ status: 'quality-warn', message: 'Contains line breaks — Facebook comments should be single paragraph' });
        } else {
            checks.push({ status: 'quality-pass', message: 'Single paragraph format' });
        }

        // Facebook should direct to email, not take action
        if (lowerResponse.includes('email') || lowerResponse.includes('contact')) {
            checks.push({ status: 'quality-pass', message: 'Directs to email for follow-up' });
        }
    } else {
        // Email-specific checks
        if (wordCount < 20) {
            checks.push({ status: 'quality-warn', message: 'Response may be too brief' });
        } else if (wordCount > 300) {
            checks.push({ status: 'quality-warn', message: 'Response may be too long' });
        } else {
            checks.push({ status: 'quality-pass', message: 'Response length is appropriate' });
        }

        // Greeting check (emails should have one)
        if (lowerResponse.includes('hi there') || lowerResponse.includes('hello') || lowerResponse.includes('hi,') || lowerResponse.startsWith('dear')) {
            checks.push({ status: 'quality-pass', message: 'Includes greeting' });
        } else {
            checks.push({ status: 'quality-warn', message: 'Consider adding a greeting' });
        }

        // Sign-off check
        if (lowerResponse.includes('thank')) {
            checks.push({ status: 'quality-pass', message: 'Includes thank you' });
        } else {
            checks.push({ status: 'quality-warn', message: 'Consider thanking the customer' });
        }

        // Link check (if option was selected)
        if (document.getElementById("includeLinks").checked) {
            if (response.includes('http') || response.includes('.ca') || response.includes('.com')) {
                checks.push({ status: 'quality-pass', message: 'Includes relevant links' });
            } else {
                checks.push({ status: 'quality-warn', message: 'No links included' });
            }
        }
    }

    // KB grounding check (applies to both types)
    if (currentReferencedKb.length > 0) {
        checks.push({ status: 'quality-pass', message: `Grounded in ${currentReferencedKb.length} KB source${currentReferencedKb.length > 1 ? 's' : ''}` });
    } else {
        checks.push({ status: 'quality-warn', message: 'No KB sources matched — response uses general knowledge' });
    }

    return checks;
}

async function rateResponse(historyId, rating, button) {
    const entry = responseHistory.find(h => h.id === historyId);
    if (entry) {
        entry.rating = rating;
        saveUserData();
    }

    // Update UI
    const parent = button.parentElement;
    parent.querySelectorAll('.rating-btn').forEach(btn => btn.classList.remove('selected'));
    button.classList.add('selected');

    if (rating === 'positive') {
        // Positive: save immediately, no modal needed
        const backendId = entry ? entry.backendId : null;
        if (backendId) {
            try {
                await fetch(`${API_BASE_URL}/api/response-history/${backendId}/rate`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ rating, feedback: null })
                });
            } catch (error) {
                console.warn('Failed to save rating to backend:', error);
            }
        }
        showToast("Thanks! This helps Lightspeed learn your preferences.", "success");
    } else {
        // Negative: show feedback modal with referenced KB entries
        const backendId = entry ? entry.backendId : null;
        const kbEntries = entry?.referencedKbEntries || [];
        showFeedbackModal(backendId, entry?.inquiry, entry?.response, kbEntries);
    }
}

function showFeedbackModal(backendId, inquiryText, responseText, referencedKbEntries) {
    // Remove any existing modal
    document.getElementById('feedbackModal')?.remove();

    const inquiry = inquiryText ? escapeHtml(inquiryText).substring(0, 300) : '';
    const response = responseText ? escapeHtml(responseText).substring(0, 300) : '';
    const kbEntries = referencedKbEntries || [];

    // Build the referenced KB entries HTML for the info section
    let kbEntriesHtml = '';
    if (kbEntries.length > 0) {
        kbEntriesHtml = `
            <div class="feedback-kb-section">
                <label class="feedback-label" style="margin-bottom: 0.5rem;">Knowledge base entries used in this response:</label>
                <div class="feedback-kb-list">
                    ${kbEntries.map((kb, i) => `
                        <div class="feedback-kb-entry" data-kb-id="${kb.id}" data-kb-index="${i}">
                            <div class="feedback-kb-entry-header">
                                <span class="feedback-kb-entry-category">${escapeHtml(kb.category)}</span>
                                <span class="feedback-kb-entry-title">${escapeHtml(kb.title)}</span>
                                <button class="feedback-kb-edit-btn" onclick="toggleKbEntryEdit(${i})">Edit</button>
                            </div>
                            <div class="feedback-kb-entry-content">${escapeHtml(kb.content)}</div>
                            <div class="feedback-kb-entry-edit" id="kbEdit_${i}" style="display:none;">
                                <textarea class="feedback-textarea feedback-kb-textarea" id="kbEditContent_${i}" rows="4">${escapeHtml(kb.content)}</textarea>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    // Fallback section for when there are no referenced KB entries (or user wants to add new info)
    const newInfoHtml = `
        <div id="feedbackNewInfoSection" style="margin-top: ${kbEntries.length > 0 ? '0.75rem' : '0'};">
            <label class="feedback-label">${kbEntries.length > 0
                ? 'Or add new information to the knowledge base:'
                : 'What is the correct information?'}</label>
            <textarea id="feedbackCorrectAnswer" class="feedback-textarea" rows="3"
                placeholder="${kbEntries.length > 0
                    ? 'Add new info that\'s missing from the knowledge base (optional)'
                    : 'Type the correct information here. This will be saved to the knowledge base so Lightspeed gets it right next time.'}"></textarea>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                <div style="flex: 1;">
                    <label class="feedback-label">Category</label>
                    <select id="feedbackKBCategory" class="feedback-select">
                        <option value="faqs">FAQ</option>
                        <option value="policies">Policy</option>
                        <option value="products">Product</option>
                        <option value="other">Other</option>
                    </select>
                </div>
            </div>
        </div>`;

    const overlay = document.createElement('div');
    overlay.id = 'feedbackModal';
    overlay.className = 'feedback-modal-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) closeFeedbackModal(); };

    overlay.innerHTML = `
        <div class="feedback-modal">
            <div class="feedback-modal-header">
                <h3>What went wrong?</h3>
                <button class="feedback-modal-close" onclick="closeFeedbackModal()">&times;</button>
            </div>
            <div class="feedback-modal-body">
                <div class="feedback-type-buttons">
                    <button class="feedback-type-btn active" data-type="style" onclick="switchFeedbackType('style', this)">
                        <span class="feedback-type-icon">🎨</span>
                        <span class="feedback-type-label">Tone / Style</span>
                        <span class="feedback-type-desc">Too formal, too long, wrong format, etc.</span>
                    </button>
                    <button class="feedback-type-btn" data-type="info" onclick="switchFeedbackType('info', this)">
                        <span class="feedback-type-icon">📋</span>
                        <span class="feedback-type-label">Wrong or Missing Info</span>
                        <span class="feedback-type-desc">Incorrect facts, missing details, outdated info</span>
                    </button>
                </div>

                <!-- Style feedback (default) -->
                <div id="feedbackStyleSection" class="feedback-section">
                    <label class="feedback-label">What should be different? (optional)</label>
                    <textarea id="feedbackStyleText" class="feedback-textarea" rows="3" placeholder="e.g., Too formal — should be friendlier and shorter"></textarea>
                </div>

                <!-- Info correction (hidden by default) -->
                <div id="feedbackInfoSection" class="feedback-section" style="display:none;">
                    <div class="feedback-context">
                        <div class="feedback-context-label">You requested:</div>
                        <div class="feedback-context-text">${inquiry}...</div>
                    </div>
                    <div class="feedback-context" style="margin-top: 0.5rem;">
                        <div class="feedback-context-label">AI generated:</div>
                        <div class="feedback-context-text">${response}...</div>
                    </div>
                    ${kbEntriesHtml}
                    ${newInfoHtml}
                </div>
            </div>
            <div class="feedback-modal-footer">
                <button class="feedback-btn-cancel" onclick="closeFeedbackModal()">Skip</button>
                <button class="feedback-btn-submit" id="feedbackSubmitBtn" onclick="submitRatingFeedback()">Submit Feedback</button>
            </div>
        </div>
    `;

    // Store metadata on the modal for submitRatingFeedback to use
    overlay.dataset.inquiryText = inquiryText || '';
    overlay.dataset.backendId = backendId || '';
    overlay.dataset.kbEntries = JSON.stringify(kbEntries);

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function toggleKbEntryEdit(index) {
    const editDiv = document.getElementById(`kbEdit_${index}`);
    const contentDiv = editDiv?.previousElementSibling;
    const editBtn = editDiv?.parentElement.querySelector('.feedback-kb-edit-btn');
    if (!editDiv) return;

    const isEditing = editDiv.style.display !== 'none';
    editDiv.style.display = isEditing ? 'none' : 'block';
    if (contentDiv) contentDiv.style.display = isEditing ? 'block' : 'none';
    if (editBtn) editBtn.textContent = isEditing ? 'Edit' : 'Cancel';
}

function switchFeedbackType(type, btn) {
    document.querySelectorAll('.feedback-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('feedbackStyleSection').style.display = type === 'style' ? 'block' : 'none';
    document.getElementById('feedbackInfoSection').style.display = type === 'info' ? 'block' : 'none';
}

function closeFeedbackModal() {
    const modal = document.getElementById('feedbackModal');
    if (modal) {
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 200);
    }
}

async function submitRatingFeedback() {
    const modal = document.getElementById('feedbackModal');
    const backendId = modal?.dataset.backendId || null;
    const inquiryText = modal?.dataset.inquiryText || '';
    const activeType = document.querySelector('.feedback-type-btn.active')?.dataset.type || 'style';
    const kbEntries = JSON.parse(modal?.dataset.kbEntries || '[]');

    const submitBtn = document.getElementById('feedbackSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
        let feedback = '';
        let kbUpdated = false;

        if (activeType === 'style') {
            feedback = (document.getElementById('feedbackStyleText')?.value || '').trim();
        } else {
            // Check for edited KB entries and update them
            const editedEntries = [];
            for (let i = 0; i < kbEntries.length; i++) {
                const editDiv = document.getElementById(`kbEdit_${i}`);
                const textarea = document.getElementById(`kbEditContent_${i}`);
                if (editDiv && editDiv.style.display !== 'none' && textarea) {
                    const newContent = textarea.value.trim();
                    if (newContent && newContent !== kbEntries[i].content) {
                        editedEntries.push({ id: kbEntries[i].id, title: kbEntries[i].title, content: newContent, category: kbEntries[i].category });
                    }
                }
            }

            // Update each edited KB entry via PUT
            for (const entry of editedEntries) {
                try {
                    const updateResp = await fetch(`${API_BASE_URL}/api/knowledge-base/${entry.id}`, {
                        method: 'PUT',
                        headers: getAuthHeaders(),
                        body: JSON.stringify({ title: entry.title, content: entry.content, category: entry.category, expected_updated_at: entry.updated_at })
                    });
                    if (updateResp.status === 409) {
                        showToast(`"${entry.title}" was modified by someone else. Refresh KB and try again.`, 'error');
                    } else if (updateResp.ok) kbUpdated = true;
                } catch (err) {
                    console.warn('Failed to update KB entry:', entry.id, err);
                }
            }

            // Build feedback text from edits
            if (editedEntries.length > 0) {
                feedback = editedEntries.map(e => `Updated "${e.title}": ${e.content}`).join('\n');
            }

            // Also handle new info addition (the textarea below the KB entries)
            const newInfo = (document.getElementById('feedbackCorrectAnswer')?.value || '').trim();
            if (newInfo) {
                const category = document.getElementById('feedbackKBCategory')?.value || 'faqs';
                const title = inquiryText ? inquiryText.substring(0, 255) : 'Feedback correction';

                const kbResponse = await fetch(`${API_BASE_URL}/api/knowledge-base/from-feedback`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        responseHistoryId: backendId,
                        title: title,
                        content: newInfo,
                        category: category
                    })
                });

                if (kbResponse.ok) kbUpdated = true;
                if (feedback) {
                    feedback += '\n' + newInfo;
                } else {
                    feedback = newInfo;
                }
            }
        }

        // Save the rating + feedback to response history
        if (backendId) {
            await fetch(`${API_BASE_URL}/api/response-history/${backendId}/rate`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ rating: 'negative', feedback: feedback || null })
            });
        }

        // Reload KB if any entries were updated or created
        if (kbUpdated) {
            await loadKnowledgeFromBackend();
            showToast("Knowledge base updated — Lightspeed will get this right next time!", "success");
        } else if (activeType === 'info') {
            showToast("Got it — Lightspeed will learn from this feedback.", "info");
        } else {
            showToast("Got it — Lightspeed will learn from this feedback.", "info");
        }

        closeFeedbackModal();

    } catch (error) {
        console.warn('Failed to save feedback:', error);
        showToast("Failed to save feedback. Please try again.", "error");
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Feedback';
    }
}

async function saveToFavorites() {
    if (!currentResponse || !currentInquiry) return;

    const title = prompt("Give this template a name:", detectCategory(currentInquiry));
    if (!title) return;

    const favorite = {
        id: `fav-${Date.now()}`,
        title: title,
        inquiry: currentInquiry,
        response: currentResponse,
        dateAdded: new Date().toISOString()
    };

    // Save to backend
    try {
        const resp = await fetch(`${API_BASE_URL}/api/favorites`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ title, inquiry: currentInquiry, response: currentResponse })
        });
        if (resp.ok) {
            const data = await resp.json();
            favorite.id = data.entry.id;
        }
    } catch (error) {
        console.warn('Failed to save favorite to backend:', error);
    }

    favorites.push(favorite);
    saveUserData();

    showToast("Saved to favorites!", "success");
}

// ==================== BULK PROCESSING ====================
async function handleBulkFile(file) {
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim());

    // Parse CSV - assume first column or "inquiry" column
    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('inquiry') || header.includes('email') || header.includes('question');
    const startIdx = hasHeader ? 1 : 0;

    const inquiries = lines.slice(startIdx).map(line => {
        // Simple CSV parse (handles basic cases)
        const match = line.match(/^"?([^"]*)"?/);
        return match ? match[1].trim() : line.split(',')[0].trim();
    }).filter(i => i.length > 10);

    if (inquiries.length === 0) {
        showToast("No valid inquiries found in the file.", "error");
        return;
    }

    if (inquiries.length > 50) {
        showToast("Maximum 50 inquiries per batch. Only the first 50 will be processed.", "info");
        inquiries.length = 50;
    }

    // Show progress
    document.getElementById("bulkProgress").style.display = "block";
    document.getElementById("bulkResults").innerHTML = "";
    bulkResults = [];

    const staffName = document.getElementById("staffName").value || "Bella";
    const allKnowledge = getAllKnowledge();

    for (let i = 0; i < inquiries.length; i++) {
        const progress = ((i + 1) / inquiries.length * 100).toFixed(0);
        document.getElementById("progressFill").style.width = `${progress}%`;
        document.getElementById("progressText").textContent = `Processing ${i + 1} of ${inquiries.length}...`;

        try {
            const result = await generateCustomResponse(
                inquiries[i], allKnowledge, staffName,
                { toneValue: 50, lengthValue: 50, includeLinks: true, includeSteps: false }
            );
            bulkResults.push({ inquiry: inquiries[i], response: result.text, error: null });
        } catch (error) {
            bulkResults.push({ inquiry: inquiries[i], response: null, error: error.message });
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
    }

    // Display results
    renderBulkResults();
    document.getElementById("exportCsvBtn").style.display = "inline-flex";
    document.getElementById("clearBulkBtn").style.display = "inline-flex";
    document.getElementById("progressText").textContent = `Completed ${inquiries.length} inquiries`;
}

function renderBulkResults() {
    const container = document.getElementById("bulkResults");
    container.innerHTML = bulkResults.map((result, i) => `
        <div class="bulk-result-item">
            <div class="bulk-result-inquiry"><strong>Inquiry ${i + 1}:</strong> ${escapeHtml(result.inquiry.substring(0, 100))}...</div>
            <div class="bulk-result-response">${result.error ?
                `<span style="color: var(--danger);">Error: ${result.error}</span>` :
                escapeHtml(result.response.substring(0, 200))}...</div>
        </div>
    `).join('');
}

function exportBulkResults() {
    const csv = "Inquiry,Response\n" + bulkResults.map(r =>
        `"${r.inquiry.replace(/"/g, '""')}","${(r.response || r.error).replace(/"/g, '""')}"`
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lightspeed-responses-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
}

function clearBulkResults() {
    bulkResults = [];
    document.getElementById("bulkResults").innerHTML = "";
    document.getElementById("bulkProgress").style.display = "none";
    document.getElementById("exportCsvBtn").style.display = "none";
    document.getElementById("clearBulkBtn").style.display = "none";
}

// ==================== FAVORITES ====================
function renderFavorites() {
    const emptyState = document.getElementById("favoritesEmpty");
    const grid = document.getElementById("favoritesGrid");

    // Guard against missing elements (e.g., during login before page is fully rendered)
    if (!emptyState || !grid) {
        return;
    }

    if (favorites.length === 0) {
        emptyState.style.display = "block";
        grid.innerHTML = "";
        return;
    }

    emptyState.style.display = "none";
    grid.innerHTML = favorites.map(fav => `
        <div class="favorite-card" onclick="useFavorite('${fav.id}')">
            <div class="favorite-header">
                <div class="favorite-title">${escapeHtml(fav.title)}</div>
                <div class="favorite-actions">
                    <button class="btn-icon-only delete" onclick="event.stopPropagation(); deleteFavorite('${fav.id}')" title="Delete">🗑️</button>
                </div>
            </div>
            <div class="favorite-preview">${escapeHtml(fav.response.substring(0, 150))}...</div>
            <div class="favorite-meta">Added ${new Date(fav.dateAdded).toLocaleDateString()}</div>
        </div>
    `).join('');
}

function useFavorite(id) {
    const fav = favorites.find(f => f.id === id);
    if (fav) {
        document.getElementById("customerEmail").value = fav.inquiry;
        switchPage("response");
    }
}

async function deleteFavorite(id) {
    if (confirm("Delete this favorite?")) {
        // Delete from backend
        try {
            await fetch(`${API_BASE_URL}/api/favorites/${id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
        } catch (error) {
            console.warn('Failed to delete favorite from backend:', error);
        }

        favorites = favorites.filter(f => f.id !== id);
        saveUserData();
        renderFavorites();
        showToast("Favorite deleted", "success");
    }
}

// ==================== ANALYTICS ====================

// Get all response history from ALL users (team-wide analytics)
function getAllUsersResponseHistory() {
    const allHistory = [];

    // Get all users from localStorage
    const storedUsers = localStorage.getItem("lightspeed_users");
    if (storedUsers) {
        try {
            const allUsers = JSON.parse(storedUsers);
            allUsers.forEach(user => {
                if (user.data && user.data.responseHistory) {
                    user.data.responseHistory.forEach(entry => {
                        allHistory.push({
                            ...entry,
                            userName: user.name
                        });
                    });
                }
            });
        } catch (e) {
            console.error("Error loading users for analytics:", e);
        }
    }

    // Sort by timestamp descending (newest first)
    allHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return allHistory;
}

// Get monthly breakdown of responses
function getMonthlyBreakdown(history) {
    const months = {};

    history.forEach(h => {
        const date = new Date(h.timestamp);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        if (!months[monthKey]) {
            months[monthKey] = {
                name: monthName,
                count: 0,
                positive: 0,
                negative: 0,
                rated: 0
            };
        }

        months[monthKey].count++;
        if (h.rating === 'positive') {
            months[monthKey].positive++;
            months[monthKey].rated++;
        } else if (h.rating === 'negative') {
            months[monthKey].negative++;
            months[monthKey].rated++;
        }
    });

    // Sort by month key descending (newest first)
    return Object.entries(months)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([key, data]) => data);
}

async function updateAnalytics() {
    // Guard against missing elements
    const analyticsTotal = document.getElementById("analyticsTotal");
    if (!analyticsTotal) {
        return;
    }

    // Fetch real analytics from the backend database
    try {
        const [statsResp, historyResp] = await Promise.all([
            fetch(`${API_BASE_URL}/api/response-history/stats`, { headers: getAuthHeaders() }),
            fetch(`${API_BASE_URL}/api/response-history`, { headers: getAuthHeaders() })
        ]);

        if (!statsResp.ok || !historyResp.ok) {
            console.warn('Analytics API failed, falling back to localStorage');
            updateAnalyticsFromLocalStorage();
            return;
        }

        const stats = await statsResp.json();
        const historyData = await historyResp.json();

        // Total responses (team-wide from DB)
        analyticsTotal.textContent = stats.total;

        // Today's responses
        document.getElementById("analyticsToday").textContent = stats.today;

        // Positive rating percentage
        document.getElementById("analyticsPositive").textContent = `${stats.positiveRate}%`;

        // Average response time (not tracked in DB yet, show dash)
        document.getElementById("analyticsAvgTime").textContent = stats.total > 0 ? '-' : '0s';

        // Category chart from backend
        const categories = stats.categories || [];
        const maxCount = Math.max(...categories.map(c => parseInt(c.count)), 1);
        const chartHtml = categories.slice(0, 5).map(cat => `
            <div class="bar-item">
                <div class="bar-label">${(cat.category || 'general').charAt(0).toUpperCase() + (cat.category || 'general').slice(1)}</div>
                <div class="bar-track">
                    <div class="bar-fill" style="width: ${parseInt(cat.count) / maxCount * 100}%"></div>
                </div>
                <div class="bar-value">${cat.count}</div>
            </div>
        `).join('');

        document.getElementById("categoryChart").innerHTML = chartHtml ||
            emptyStateHtml('📊', 'No category data yet', 'Generate responses to see inquiry breakdowns.', 'Generate Response', "switchPage('response')");

        // Monthly breakdown from backend
        const monthlyData = stats.monthly || [];
        const monthlyHtml = monthlyData.length > 0 ? monthlyData.map(month => {
            const date = new Date(month.month + '-01');
            const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            const rated = parseInt(month.rated);
            const positive = parseInt(month.positive);
            return `
                <div class="monthly-stat-row">
                    <div class="monthly-stat-name">${monthName}</div>
                    <div class="monthly-stat-count">${month.count} responses</div>
                    <div class="monthly-stat-rating">${rated > 0 ? Math.round(positive / rated * 100) + '% positive' : 'No ratings'}</div>
                </div>
            `;
        }).join('') : emptyStateHtml('📅', 'No monthly data yet', 'Your monthly response trends will appear here.');

        document.getElementById("monthlyBreakdown").innerHTML = monthlyHtml;

        // Team history list from backend
        const entries = historyData.entries || [];
        const historyHtml = entries.slice(0, 15).map(h => {
            const userName = `${h.first_name || ''} ${h.last_name || ''}`.trim() || 'Unknown';
            return `
                <div class="history-item" onclick="showHistoryDetail('${h.id}')">
                    <div class="history-header">
                        <span class="history-type">${h.format || 'email'}</span>
                        <span class="history-date">${new Date(h.created_at).toLocaleDateString()}</span>
                    </div>
                    <div class="history-preview">${escapeHtml((h.inquiry || '').substring(0, 100))}...</div>
                    <div class="history-meta">
                        <span>&#128100; ${escapeHtml(userName)}</span>
                        ${h.rating ? `<span>${h.rating === 'positive' ? '&#128077;' : '&#128078;'}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        document.getElementById("historyList").innerHTML = historyHtml ||
            emptyStateHtml('📜', 'No response history yet', 'Responses from your team will appear here.', 'Generate Response', "switchPage('response')");

        // Render leaderboard from backend data
        renderLeaderboardFromData(stats.leaderboard || []);

    } catch (error) {
        console.warn('Analytics fetch error, falling back to localStorage:', error);
        updateAnalyticsFromLocalStorage();
    }
}

// Fallback analytics using localStorage (when backend is unreachable)
function updateAnalyticsFromLocalStorage() {
    const allHistory = getAllUsersResponseHistory();

    document.getElementById("analyticsTotal").textContent = allHistory.length;

    const today = new Date().toDateString();
    document.getElementById("analyticsToday").textContent = allHistory.filter(h =>
        new Date(h.timestamp).toDateString() === today
    ).length;

    const rated = allHistory.filter(h => h.rating);
    const positive = rated.filter(h => h.rating === 'positive').length;
    document.getElementById("analyticsPositive").textContent = `${rated.length > 0 ? Math.round(positive / rated.length * 100) : 0}%`;

    const times = allHistory.filter(h => h.responseTime).map(h => h.responseTime);
    document.getElementById("analyticsAvgTime").textContent = `${times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 0}s`;

    document.getElementById("categoryChart").innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Connect to see team data</div>';
    document.getElementById("monthlyBreakdown").innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Connect to see team data</div>';
    document.getElementById("historyList").innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">Connect to see team data</div>';

    renderLeaderboard();
}

function showHistoryDetail(id) {
    // Search in all users' history
    const allHistory = getAllUsersResponseHistory();
    const item = allHistory.find(h => h.id === id);
    if (!item) return;

    currentHistoryItem = item;

    document.getElementById("historyModalContent").innerHTML = `
        <div style="margin-bottom: 16px;">
            <div class="form-label">Customer Inquiry</div>
            <div style="background: var(--bg-light); padding: 12px; border-radius: var(--radius-md); font-size: 0.85rem;">
                ${escapeHtml(item.inquiry)}
            </div>
        </div>
        <div>
            <div class="form-label">Generated Response</div>
            <div style="background: var(--bg-light); padding: 12px; border-radius: var(--radius-md); font-size: 0.85rem; white-space: pre-wrap;">
                ${escapeHtml(stripCitations(item.response))}
            </div>
        </div>
        <div style="margin-top: 12px; font-size: 0.75rem; color: var(--text-muted);">
            Generated on ${new Date(item.timestamp).toLocaleString()} • ${item.responseTime}s • ${item.rating ? (item.rating === 'positive' ? '👍 Positive' : '👎 Negative') : 'Not rated'}
        </div>
    `;

    document.getElementById("historyModal").classList.add("show");
}

// ==================== KNOWLEDGE BASE ====================
function updateKnowledgeStats() {
    const statTotal = document.getElementById("statTotal");
    const stat5050 = document.getElementById("stat5050");
    const statCta = document.getElementById("statCta");

    // Guard against missing elements
    if (!statTotal || !stat5050 || !statCta) {
        return;
    }

    // Count org-specific entries (these power the AI)
    let orgCount = customKnowledge.length;
    let total5050 = 0, totalCta = 0;

    // Count templates (reference only, not used in AI prompts)
    if (typeof KNOWLEDGE_BASE !== 'undefined') {
        total5050 = KNOWLEDGE_BASE["5050"].length;
        totalCta = KNOWLEDGE_BASE["cta"].length;
    }

    customKnowledge.forEach(k => {
        if (k.lottery === "5050") total5050++;
        else if (k.lottery === "cta") totalCta++;
        else { total5050++; totalCta++; }
    });

    statTotal.textContent = orgCount;
    stat5050.textContent = total5050;
    statCta.textContent = totalCta;
}

function renderKnowledgeList(searchQuery = "") {
    const container = document.getElementById("knowledgeList");

    // Guard against missing element
    if (!container) {
        return;
    }

    let items = [];

    // Get all items based on filter
    if (currentFilter === "custom") {
        items = customKnowledge.map(k => ({ ...k, isCustom: true }));
    } else {
        if (typeof KNOWLEDGE_BASE !== 'undefined') {
            if (currentFilter === "all" || currentFilter === "5050") {
                items.push(...KNOWLEDGE_BASE["5050"].map(k => ({ ...k, lottery: "5050", isCustom: false })));
            }
            if (currentFilter === "all" || currentFilter === "cta") {
                items.push(...KNOWLEDGE_BASE["cta"].map(k => ({ ...k, lottery: "cta", isCustom: false })));
            }
        }
        if (currentFilter === "all") {
            items.push(...customKnowledge.map(k => ({ ...k, isCustom: true })));
        }
    }

    // Filter by search
    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        items = items.filter(k =>
            k.question.toLowerCase().includes(query) ||
            k.keywords.some(kw => kw.toLowerCase().includes(query)) ||
            k.response.toLowerCase().includes(query)
        );
    }

    if (items.length === 0) {
        container.innerHTML = searchQuery
            ? `<div class="empty-state"><div class="empty-state-icon">🔍</div><p class="empty-state-title">No matching entries found</p><p class="empty-state-text">Try a different search term.</p></div>`
            : emptyStateHtml('📚', 'No knowledge entries yet', 'Add entries to help Lightspeed generate more accurate responses.', 'Add Entry', "document.getElementById('addKnowledgeBtn')?.click()");
        return;
    }

    container.innerHTML = items.slice(0, 50).map((k, i) => `
        <div class="knowledge-item${k.isCustom ? '' : ' knowledge-item-template'}">
            <div class="knowledge-item-content">
                <div class="knowledge-item-question">${escapeHtml(k.question)}</div>
                <div class="knowledge-item-preview">${escapeHtml(k.response.substring(0, 120))}...</div>
                <div class="knowledge-item-meta">
                    <span class="knowledge-tag">${k.lottery === "5050" ? "50/50" : k.lottery === "cta" ? "CTA" : "Both"}</span>
                    ${k.isCustom
                        ? '<span class="knowledge-tag" style="background: #dcfce7;">Your KB</span>'
                        : '<span class="knowledge-tag" style="background: #fef3c7; color: #92400e;">Template</span>'}
                    ${k.isCustom && k.tags && k.tags.includes('source:feedback') ? '<span class="knowledge-tag" style="background: #fef3c7; color: #92400e; font-weight: 600;">From feedback</span>' : ''}
                    ${k.category ? `<span>${k.category}</span>` : ''}
                </div>
            </div>
            ${k.isCustom ? `
                <div class="knowledge-item-actions">
                    <button class="btn-icon-only delete" onclick="deleteKnowledge('${k.id}')" title="Delete">🗑️</button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

async function addKnowledge() {
    const lottery = document.getElementById("knowledgeLottery").value;
    const category = document.getElementById("knowledgeCategory").value;
    const question = document.getElementById("knowledgeQuestion").value.trim();
    const keywords = document.getElementById("knowledgeKeywords").value.split(",").map(k => k.trim().toLowerCase()).filter(k => k);
    const response = document.getElementById("knowledgeResponse").value.trim();

    if (!question || !response) {
        showToast("Please fill in the question and response fields.", "error");
        return;
    }

    const computedKeywords = keywords.length > 0 ? keywords : question.toLowerCase().split(" ").filter(w => w.length > 3);

    const newEntry = {
        id: `custom-${Date.now()}`,
        lottery: lottery,
        category: category,
        question: question,
        keywords: computedKeywords,
        response: response,
        dateAdded: new Date().toISOString()
    };

    // Save to backend API
    try {
        const apiResponse = await fetch(`${API_BASE_URL}/api/knowledge-base`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                title: question,
                content: response,
                category: category,
                lottery: lottery,
                keywords: computedKeywords
            })
        });

        if (apiResponse.ok) {
            const data = await apiResponse.json();
            // Use the backend-generated ID
            newEntry.id = data.entry.id;
        } else {
            console.warn('Backend KB save failed, using localStorage fallback');
        }
    } catch (error) {
        console.warn('Backend KB save error, using localStorage fallback:', error);
    }

    // Always save locally too (fallback + immediate UI update)
    customKnowledge.push(newEntry);
    saveUserData();

    // Clear form
    document.getElementById("knowledgeQuestion").value = "";
    document.getElementById("knowledgeKeywords").value = "";
    document.getElementById("knowledgeResponse").value = "";

    updateKnowledgeStats();
    renderKnowledgeList();

    const btn = document.getElementById("addKnowledgeBtn");
    btn.innerHTML = `<span class="btn-icon">✓</span> Added!`;
    showToast("Knowledge entry added!", "success");
    setTimeout(() => btn.innerHTML = `<span class="btn-icon">➕</span> Add to Knowledge Base`, 1500);
}

async function deleteKnowledge(id) {
    if (confirm("Delete this knowledge entry?")) {
        // Delete from backend API
        try {
            await fetch(`${API_BASE_URL}/api/knowledge-base/${id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
        } catch (error) {
            console.warn('Backend KB delete error:', error);
        }

        // Always remove locally too
        customKnowledge = customKnowledge.filter(k => k.id !== id);
        saveUserData();
        updateKnowledgeStats();
        renderKnowledgeList();
        showToast("Knowledge entry deleted", "success");
    }
}

async function uploadKnowledgeDoc(input) {
    const file = input.files[0];
    if (!file) return;

    const btn = document.getElementById('uploadDocBtn');
    btn.innerHTML = '<span class="btn-icon">⏳</span> Uploading...';
    btn.disabled = true;

    try {
        const formData = new FormData();
        formData.append('document', file);
        formData.append('category', document.getElementById('knowledgeCategory').value || 'general');

        const response = await fetch(`${API_BASE_URL}/api/knowledge-base/upload-doc`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('lightspeed_token')}`
            },
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Upload failed');
        }

        const data = await response.json();

        // Add imported entries to local customKnowledge array
        if (data.entries) {
            data.entries.forEach(entry => {
                customKnowledge.push({
                    id: entry.id,
                    question: entry.title,
                    keywords: entry.tags || [],
                    response: entry.content,
                    category: entry.category,
                    isCustom: true
                });
            });
            saveUserData();
            updateKnowledgeStats();
            renderKnowledgeList();
        }

        showToast(data.message || `Imported ${data.imported} entries`, 'success');
    } catch (error) {
        console.error('Doc upload error:', error);
        showToast('Error uploading document: ' + error.message, 'error');
    } finally {
        btn.innerHTML = '<span class="btn-icon">📄</span> Upload Word Doc';
        btn.disabled = false;
        input.value = '';
    }
}

function parseAndImportKnowledge() {
    const content = document.getElementById("importContent").value.trim();
    if (!content) {
        showToast("Please paste some content to import.", "error");
        return;
    }

    // Simple parsing: look for Q&A patterns
    const pairs = [];
    const lines = content.split('\n');
    let currentQuestion = null;
    let currentResponse = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Check if this looks like a question/header (bold markers, ends with ?, starts with Q:, etc.)
        if (trimmed.startsWith('**') || trimmed.endsWith('?') || trimmed.startsWith('Q:') ||
            (trimmed.length < 100 && trimmed.includes(':'))) {
            if (currentQuestion && currentResponse.length > 0) {
                pairs.push({
                    question: currentQuestion.replace(/\*\*/g, '').replace(/^Q:\s*/i, ''),
                    response: currentResponse.join('\n').trim()
                });
            }
            currentQuestion = trimmed;
            currentResponse = [];
        } else if (currentQuestion) {
            currentResponse.push(trimmed);
        }
    }

    // Don't forget the last one
    if (currentQuestion && currentResponse.length > 0) {
        pairs.push({
            question: currentQuestion.replace(/\*\*/g, '').replace(/^Q:\s*/i, ''),
            response: currentResponse.join('\n').trim()
        });
    }

    if (pairs.length === 0) {
        showToast("Could not parse any Q&A pairs from the content. Try formatting with clear question/answer sections.", "error");
        return;
    }

    // Add to knowledge base locally
    const newEntries = pairs.map(pair => ({
        id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        lottery: "both",
        category: "general",
        question: pair.question,
        keywords: pair.question.toLowerCase().split(" ").filter(w => w.length > 3),
        response: pair.response,
        dateAdded: new Date().toISOString()
    }));

    newEntries.forEach(entry => customKnowledge.push(entry));
    saveUserData();

    // Also sync to backend via bulk import
    try {
        const importEntries = newEntries.map(entry => ({
            title: entry.question,
            content: entry.response,
            category: entry.category,
            tags: [`lottery:${entry.lottery}`, ...entry.keywords.map(k => `keyword:${k}`)]
        }));

        fetch(`${API_BASE_URL}/api/knowledge-base/import`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ entries: importEntries })
        }).then(resp => {
            if (resp.ok) {
                // Reload from backend to get server-generated IDs
                loadKnowledgeFromBackend();
            }
        }).catch(err => console.warn('Backend import failed:', err));
    } catch (error) {
        console.warn('Backend KB import error:', error);
    }

    document.getElementById("importModal").classList.remove("show");
    document.getElementById("importContent").value = "";

    updateKnowledgeStats();
    renderKnowledgeList();

    showToast(`Imported ${pairs.length} knowledge entries!`, "success");
}

// ==================== FEEDBACK ====================
async function submitFeedback() {
    const name = document.getElementById("feedbackName").value.trim();
    const email = document.getElementById("feedbackEmail").value.trim();
    const type = document.getElementById("feedbackType").value;
    const message = document.getElementById("feedbackMessage").value.trim();

    if (!name || !message) {
        showToast("Please fill in your name and feedback message.", "error");
        return;
    }

    const feedback = {
        id: `feedback-${Date.now()}`,
        name, email, type, message,
        dateSubmitted: new Date().toISOString()
    };

    // Save to backend
    try {
        const token = localStorage.getItem('authToken');
        if (token) {
            const resp = await fetch(`${API_BASE_URL}/api/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name, email, type, message })
            });
            if (resp.ok) {
                const data = await resp.json();
                feedback.backendId = data.entry?.id;
            }
        }
    } catch (err) {
        console.error('Failed to save feedback to backend:', err);
    }

    feedbackList.push(feedback);
    saveUserData();

    // Clear form
    document.getElementById("feedbackName").value = "";
    document.getElementById("feedbackEmail").value = "";
    document.getElementById("feedbackMessage").value = "";

    document.getElementById("feedbackSuccess").style.display = "flex";
    setTimeout(() => document.getElementById("feedbackSuccess").style.display = "none", 5000);

}

// ==================== UTILITIES ====================
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, "<br>");
}

// Strip KB citation markers like [1], [2] from response text
function stripCitations(text) {
    return text.replace(/ ?\[\d+\]/g, '');
}

// Escape HTML then convert URLs to clickable links (safe: escape first, linkify after)
function escapeHtmlWithLinks(text) {
    const div = document.createElement("div");
    div.textContent = text;
    let escaped = div.innerHTML;
    // Convert URLs to anchor tags (matches http/https URLs)
    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    // Convert www. URLs without protocol
    escaped = escaped.replace(/(?<!\/\/)(www\.[^\s<]+)/g, '<a href="https://$1" target="_blank" rel="noopener noreferrer">$1</a>');
    return escaped.replace(/\n/g, "<br>");
}

function copyToClipboard(elementId, button) {
    const element = document.getElementById(elementId);
    const text = element.innerText;

    navigator.clipboard.writeText(text).then(() => {
        const originalHTML = button.innerHTML;
        button.innerHTML = "✓ Copied!";
        button.classList.add("copied");
        showToast("Copied to clipboard!", "success");
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove("copied");
        }, 2000);
    }).catch(() => {
        // Fallback
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        button.innerHTML = "✓ Copied!";
        button.classList.add("copied");
        showToast("Copied to clipboard!", "success");
        setTimeout(() => {
            button.innerHTML = "📋 Copy";
            button.classList.remove("copied");
        }, 2000);
    });
}

// ==================== CHARACTER COUNT ====================
function updateCharCount() {
    const text = document.getElementById("customerEmail").value;
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;

    document.getElementById("inputChars").textContent = chars;
    document.getElementById("inputWords").textContent = words;
}

// ==================== AUTO-SAVE DRAFTS ====================
let autoSaveTimeout = null;

function autoSaveDraft() {
    const indicator = document.getElementById("autosaveIndicator");
    const dot = indicator.querySelector(".autosave-dot");

    // Show saving indicator
    indicator.style.display = "flex";
    dot.classList.add("saving");

    // Debounce the save
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        const text = document.getElementById("customerEmail").value;
        if (text.trim()) {
            localStorage.setItem("draft_inquiry", text);
        } else {
            localStorage.removeItem("draft_inquiry");
        }
        dot.classList.remove("saving");

        // Hide indicator after a delay
        setTimeout(() => {
            indicator.style.display = "none";
        }, 2000);
    }, 1000);
}

// ==================== COLLAPSIBLE SECTIONS ====================
function toggleOptionsSection() {
    const header = document.getElementById("optionsHeader");
    const content = document.getElementById("optionsContent");

    header.classList.toggle("collapsed");
    content.classList.toggle("collapsed");
}

// ==================== TEMPLATES DRAWER ====================
function openTemplatesDrawer() {
    document.getElementById("templatesDrawer").classList.add("open");
    document.getElementById("drawerOverlay").classList.add("show");
    renderDrawerFavorites();
}

function closeTemplatesDrawer() {
    document.getElementById("templatesDrawer").classList.remove("open");
    document.getElementById("drawerOverlay").classList.remove("show");
}

function renderDrawerFavorites() {
    const container = document.getElementById("drawerContent");

    if (favorites.length === 0) {
        container.innerHTML = `
            <p style="color: var(--text-secondary); font-size: 0.9rem; text-align: center; padding: 40px 20px;">
                No saved templates yet.<br>Save responses using the ⭐ button!
            </p>
        `;
        return;
    }

    container.innerHTML = favorites.map((fav, index) => `
        <div class="drawer-item" style="padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-md); margin-bottom: 12px; cursor: pointer; transition: all 0.2s;" onclick="useDrawerFavorite(${index})">
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 4px;">
                ${new Date(fav.dateAdded).toLocaleDateString()}
            </div>
            <div style="font-size: 0.85rem; color: var(--text-primary); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">
                ${escapeHtml(fav.response.substring(0, 150))}...
            </div>
        </div>
    `).join("");
}

function useDrawerFavorite(index) {
    const fav = favorites[index];
    document.getElementById("responseOutput").innerHTML = escapeHtml(fav.response).replace(/\n/g, "<br>");
    currentResponse = fav.response;
    closeTemplatesDrawer();
    showToast("Template loaded!", "success");
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = "") {
    const toast = document.getElementById("toast");
    const messageEl = toast.querySelector(".toast-message");
    const iconEl = toast.querySelector(".toast-icon");

    messageEl.textContent = message;
    iconEl.textContent = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";

    toast.className = "toast " + type;
    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

// ==================== NAVIGATION HELPER ====================
function showPage(pageId) {
    switchPage(pageId);
}

// ==================== GLOBAL EXPORTS ====================
window.copyToClipboard = copyToClipboard;
window.deleteKnowledge = deleteKnowledge;
window.deleteFavorite = deleteFavorite;
window.useFavorite = useFavorite;
window.rateResponse = rateResponse;
window.showFeedbackModal = showFeedbackModal;
window.switchFeedbackType = switchFeedbackType;
window.closeFeedbackModal = closeFeedbackModal;
window.submitRatingFeedback = submitRatingFeedback;
window.saveToFavorites = saveToFavorites;
window.showHistoryDetail = showHistoryDetail;
window.showPage = showPage;
window.openTemplatesDrawer = openTemplatesDrawer;
window.closeTemplatesDrawer = closeTemplatesDrawer;
window.useDrawerFavorite = useDrawerFavorite;

// ==================== DRAFT ASSISTANT ====================
let draftAssistantInitialized = false;
let currentDraftType = null;
let currentDraftTone = 'balanced';
let lastDraftRequest = null;
let currentEmailType = null;
let currentDraftHistoryId = null;

/**
 * Save a draft to response history and show rating UI
 */
async function saveDraftToHistory(inquiry, response, format) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/response-history`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                inquiry,
                response,
                format: format || 'draft',
                tone: currentDraftTone,
                tool: 'draft_assistant'
            })
        });
        if (res.ok) {
            const data = await res.json();
            currentDraftHistoryId = data.entry.id;
            showDraftRatingUI();
        }
    } catch (e) {
        console.warn('Could not save draft to history:', e);
    }
}

function showDraftRatingUI() {
    // Remove existing rating UI if present
    const existing = document.getElementById('draftRatingSection');
    if (existing) existing.remove();

    const ratingDiv = document.createElement('div');
    ratingDiv.id = 'draftRatingSection';
    ratingDiv.className = 'rating-section';
    ratingDiv.innerHTML = `
        <span class="rating-label">Was this draft helpful?</span>
        <button class="rating-btn thumbs-up" onclick="rateDraft('positive', this)">👍</button>
        <button class="rating-btn thumbs-down" onclick="rateDraft('negative', this)">👎</button>
    `;

    const outputSection = document.getElementById('draftStudioOutput');
    if (outputSection) outputSection.appendChild(ratingDiv);
}

async function rateDraft(rating, button) {
    if (!currentDraftHistoryId) return;

    // Update UI
    const parent = button.parentElement;
    parent.querySelectorAll('.rating-btn').forEach(btn => btn.classList.remove('selected'));
    button.classList.add('selected');

    if (rating === 'positive') {
        // Positive: save immediately
        try {
            await fetch(`${API_BASE_URL}/api/response-history/${currentDraftHistoryId}/rate`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ rating, feedback: null })
            });
        } catch (e) {
            console.warn('Could not rate draft:', e);
        }

        const section = document.getElementById('draftRatingSection');
        if (section) {
            section.innerHTML = '<span class="rating-label">Thanks! This helps Lightspeed learn your preferences.</span>';
        }
    } else {
        // Negative: show the feedback modal with KB correction option
        const draftContent = document.getElementById('draftOutputContent')?.textContent || '';
        const draftPrompt = lastDraftRequest?.topic || lastDraftRequest?.details || 'Draft content';
        showFeedbackModal(currentDraftHistoryId, draftPrompt, draftContent);
    }
}

// Draft Assistant uses server-side API (no client-side key needed)

const DRAFT_TYPE_LABELS = {
    'social': 'Social Media Copy',
    'email': 'Email Copy',
    'media-release': 'Media Release',
    'ad': 'Facebook/Instagram Ad',
    'write-anything': 'Write Anything'
};

const DRAFT_EMPTY_STATES = {
    'email': {
        icon: '📧', title: 'Email Copy',
        text: 'Select an email type, fill in the key details, and generate. Lightspeed uses your knowledge base and past rated emails to match your brand voice.',
        tips: ['Choose a specific email type for best results', 'Include key details like prize amounts and dates', 'Use add-ons to include Subscriptions or Catch The Ace sections']
    },
    'social': {
        icon: '📱', title: 'Social Media',
        text: 'Enter your topic and tone, and Lightspeed will draft a post with your licence disclaimer and required lines included.',
        tips: ['Keep it punchy \u2014 social posts work best when short and exciting', 'Lightspeed automatically adds your licence disclaimer', 'Use the Tone selector to control energy level']
    },
    'media-release': {
        icon: '📰', title: 'Media Release',
        text: 'Provide your announcement details and add quotes from spokespeople. Lightspeed formats it in AP style.',
        tips: ['Add at least one quote for a more compelling release', 'Include specific numbers \u2014 dollar amounts, dates, and stats', 'Lightspeed structures it with headline, lead, quotes, and boilerplate']
    },
    'ad': {
        icon: '📣', title: 'Facebook/Instagram Ad',
        text: 'Describe your campaign goal. Lightspeed generates ad copy under 120 characters with your website URL.',
        tips: ['Ad copy is limited to 120 characters for best performance', 'Focus on one clear call-to-action per ad', 'Your website URL is included automatically']
    },
    'write-anything': {
        icon: '✨', title: 'Write Anything',
        text: 'Describe what you need in plain English. Set your tone, format, and length, and Lightspeed handles the rest.',
        tips: ['Be specific about your audience and purpose', 'Use the Format selector to choose structure (paragraphs, bullets, etc.)', 'Adjust Length to control how detailed the output is']
    }
};

let activeDraftTab = 'email';

const EMAIL_TYPE_LABELS = {
    'new-draw': 'New Draw Announcement',
    'draw-reminder': 'Draw Reminder',
    'winners': 'Winner(s) Announcement',
    'impact-sunday': 'Impact Sunday',
    'last-chance': 'Last Chance'
};

const EMAIL_DETAILS_PLACEHOLDERS = {
    'new-draw': 'E.g., Draw month (January), total Early Bird prizes ($125,000), number of draws (18 winners), Grand Prize draw date...',
    'draw-reminder': 'E.g., Which draw (10K Early Bird), draw date (tomorrow), current Grand Prize amount, deadline for tickets...',
    'winners': 'E.g., Winning ticket number, prize amount, winner name and city if available, current Grand Prize amount...',
    'last-chance': 'E.g., Grand Prize amount, deadline date/time, number of remaining draws, urgency messaging...'
};

const EMAIL_DETAILS_LABELS = {
    'new-draw': 'Key details about the new draw',
    'draw-reminder': 'Details about the upcoming draw',
    'winners': 'Winner information',
    'last-chance': 'Deadline and prize information'
};

const DRAFT_SYSTEM_PROMPT = `You are a professional copywriter for [Organization Name] and their 50/50 lottery program. You write content that is warm, professional, optimistic, exciting, community-focused, trustworthy, fun/playful, and can be urgent when appropriate.

CRITICAL RULES YOU MUST ALWAYS FOLLOW:
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize" instead
- NEVER say how much has been "raised" - instead highlight the total prizes awarded to date
- When mentioning impact, ALWAYS use: "Thanks to our donors, event participants, and 50/50 supporters..." before describing the impact
- Website is always: [Organization Website]
- In-store location: [In-Person Ticket Location]
- Must be 18 years or older to purchase
- Must be physically present in Ontario at time of purchase
- Monthly draws with Early Bird Prizes throughout the month, Grand Prize draw on the last Friday of the month
- The Foundation supports capital equipment purchases at our local healthcare facility

KEY PHRASES TO USE:
- "You LOVE our 50/50, and you might LOVE our other raffles just as much!"
- "Purchase tickets at [Organization Website] or at [In-Person Ticket Location]!"

PEOPLE WHO GET QUOTED:
- [CEO/President Name], [CEO/President Title], [Organization Name]
- [Media Contact Name]

EMOJI USAGE: Minimal - usually just one emoji after the first sentence/paragraph. Never overuse.

CONTENT TYPE SPECIFIC RULES:

FOR SOCIAL MEDIA:
- Lead with excitement or key announcement
- Keep it punchy but informative
- Include the disclaimer: "Must be 18 years or older to purchase: Lottery Licence [Licence Number]" (or current licence number)
- One emoji max, placed after first paragraph

FOR EMAIL:
- Less "corporate" - more fun and conversational
- Personal tone, like writing to a friend who supports healthcare
- Can be longer and more detailed

FOR MEDIA RELEASES:
- Professional journalistic style
- Include quotes from [CEO/President Name] or [Media Contact Name]
- Structure: Lead paragraph with key news, supporting details, quotes, background info
- End with "About" boilerplate if appropriate

FOR FACEBOOK/INSTAGRAM ADS:
- MAXIMUM 120 characters
- MUST include [Organization Website]
- Focus on urgency and excitement
- Goal is always ticket sales
- One emoji allowed`;

// Write Anything - Best Practices Guide & System Prompt
const WRITE_ANYTHING_GUIDE = `You are a versatile professional writer for [Organization Name]. You help create any type of written content the user requests — from internal documents to external communications, from creative pieces to formal reports.

WRITING PRINCIPLES:
1. CLARITY FIRST: Every sentence should serve a purpose. Avoid filler words, clichés, and corporate jargon unless the audience specifically expects it.
2. AUDIENCE AWARENESS: Adapt vocabulary, sentence structure, and depth of detail to the intended reader. A board report reads differently from a volunteer email.
3. STRONG OPENINGS: Lead with the most important or compelling information. Don't bury the point.
4. ACTIVE VOICE: Prefer active voice ("The team raised $50,000") over passive ("$50,000 was raised by the team") unless formality demands otherwise.
5. CONCRETE DETAILS: Use specific numbers, names, and examples instead of vague generalities. "Served 1,200 patients last quarter" beats "served many patients."
6. CONSISTENT TONE: Maintain the chosen tone throughout. Don't shift from warm to clinical mid-piece.
7. SCANNABLE STRUCTURE: Use headers, short paragraphs, and lists for longer pieces. Readers skim before they read.
8. PURPOSEFUL ENDINGS: Close with a clear call to action, summary, or forward-looking statement — never just trail off.

ORGANIZATION CONTEXT:
- Organization: [Organization Name]
- Website: [Organization Website]
- Mission: [Organization Mission]
- CEO/President: [CEO/President Name], [CEO/President Title]
- Media Contact: [Media Contact Name]
- Support Email: [Support Email]

Use this context naturally when relevant to the content being written. Don't force organization details into content where they don't belong.

TONE GUIDE:
- Balanced: Professional yet approachable. Clear and direct without being cold.
- Warm: Friendly, empathetic, community-focused. Like writing to someone you genuinely care about.
- Formal: Polished, authoritative, structured. Suitable for board reports, official correspondence, grant applications.
- Persuasive: Compelling, action-oriented, emotionally resonant. Drives the reader toward a specific outcome.
- Conversational: Casual, relatable, engaging. Like talking to a colleague over coffee.

FORMAT GUIDE:
- Paragraphs: Flowing prose with clear paragraph breaks. Best for letters, articles, narratives.
- Bullet Points: Concise, scannable items. Best for summaries, key takeaways, lists of benefits.
- Numbered List: Sequential or ranked items. Best for steps, priorities, instructions.
- Outline: Hierarchical structure with headers and sub-points. Best for plans, proposals, complex topics.

LENGTH GUIDE:
- Brief: Get to the point quickly. 100-200 words. Every word earns its place.
- Standard: Thorough but focused. 300-500 words. Room for context and detail.
- Detailed: Comprehensive coverage. 600-1000 words. Full exploration of the topic with supporting points.

IMPORTANT RULES:
- Always produce publication-ready content — no placeholder text or "[insert here]" markers
- Match the requested tone, format, and length precisely
- If the user's request relates to lotteries, fundraising, or the organization's programs, incorporate relevant context naturally
- Never fabricate statistics, quotes, or specific claims unless the user provides them
- Provide only the written content — no meta-commentary, explanations, or preamble unless asked`;

// Email-specific system prompts based on category
const EMAIL_SYSTEM_PROMPTS = {
    'new-draw': `You are a professional email copywriter for [Organization Name]'s 50/50 lottery. You write NEW DRAW ANNOUNCEMENT emails that announce the launch of a new monthly draw.

CRITICAL RULES:
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize" instead
- Website: [Organization Website]
- In-store: [In-Person Ticket Location]
- Must be 18+ and physically in Ontario to purchase
- Grand Prize draw is on the last Friday of the month

TONE & STYLE for New Draw Announcements:
- Lead with excitement about the new month's draw
- Highlight total Early Bird prizes available
- List key draws and dates in an easy-to-read format (numbered list works well)
- Create urgency around early ticket purchases
- Mention if there's a significant prize early in the month
- Use emojis sparingly (1-2 per email, typically in subject or first line)
- End with a call to action: buy tickets link

COMMON PHRASES TO USE:
- "Ring in the new [month] with plenty of chances to WIN!"
- "Here's everything you need to know about this month's draw"
- "Don't wait to get your tickets!"
- "Check out our two other raffles! You LOVE our 50/50, and you might LOVE our other raffles just as much!"

SUBJECT LINE STYLE:
- Use dollar amounts and emojis
- Examples: "$125K IN EARLY BIRDS!❄️" or "$70K IN EARLY BIRDS THIS WEEK!💰"

EMAIL STRUCTURE:
1. Exciting opener with key announcement
2. Numbered list of key details about the draw
3. Buy tickets CTA button/link
4. Mention other raffles (Catch The Ace, Pink Jeep if applicable)
5. Standard footer with lottery licence`,

    'draw-reminder': `You are a professional email copywriter for [Organization Name]'s 50/50 lottery. You write DRAW REMINDER emails that remind subscribers about upcoming draws.

CRITICAL RULES:
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize" instead
- Website: [Organization Website]
- Draws happen at 11AM - winners get called
- Must be 18+ and physically in Ontario to purchase

TONE & STYLE for Draw Reminders:
- Create urgency - there's a deadline tonight at 11:59PM
- Be direct about what draw is happening and when
- Mention the current Grand Prize amount to build excitement
- Remind them to have their ringer on for the winner call at 11AM
- Use countdown/timer reference when applicable
- Keep it shorter than new draw announcements

COMMON PHRASES TO USE:
- "DEADLINE: TONIGHT 11:59PM!"
- "TOMORROW there is a $X Early Bird draw!"
- "We're calling the winner tomorrow at 11AM, make sure you have your ringer turned on"
- "Purchase tickets before the timer runs out"
- "There's still a ton of winning left this month!"

SUBJECT LINE STYLE:
- Mention the draw type and timing
- Examples: "There's a 10K Early Bird draw TOMORROW!🙂" or "5K EARLY BIRD TOMORROW!☃️"

EMAIL STRUCTURE:
1. Urgent opener about tomorrow's draw
2. Prize amount and deadline
3. Current Grand Prize amount
4. Timer/countdown reference
5. Buy tickets CTA
6. Mention Catch The Ace
7. Standard footer`,

    'winners': `You are a professional email copywriter for [Organization Name]'s 50/50 lottery. You write WINNER ANNOUNCEMENT emails that celebrate and announce draw winners.

CRITICAL RULES:
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize" instead
- Website: [Organization Website]
- Winners get called at 11AM after the draw
- Include winning ticket numbers when announcing

TONE & STYLE for Winner Announcements:
- Celebratory and exciting!
- Share the winning ticket number prominently
- If you have winner details (name, city), share their story
- For Grand Prize winners, make it a BIG announcement with video links if available
- Encourage engagement: "What do you think the final Grand Prize amount is going to be? Reply to this email!"
- Remind there's more winning to come

COMMON PHRASES TO USE:
- "We just drew the winner of today's [X]K Early Bird draw and we're calling them RIGHT NOW!"
- "Make sure you have your ringer turned on; there's still a ton of winning left this month!"
- "Congratulations to [WINNER NAME] from [CITY]!"
- For video announcements: "Click the play button below to watch the winner call video!"

SUBJECT LINE STYLE:
- Announce the win with excitement
- Examples: "We just drew today's 10K WINNER!🤑" or "VIDEO: HE JUST WON $7.7 MILLION!🤯"

EMAIL STRUCTURE:
1. Winning ticket number announcement
2. Prize amount and draw type
3. Current Grand Prize amount (if Early Bird)
4. Call to action to keep playing
5. Mention Catch The Ace
6. Standard footer`,

    'impact-sunday': `You are a professional email copywriter for [Organization Name]. You write IMPACT SUNDAY emails that show donors how their 50/50 ticket purchases make a real difference in healthcare.

CRITICAL RULES:
- This is about DONOR IMPACT, not about winning money
- Focus on the equipment purchased or program funded
- Include quotes from hospital staff whenever possible
- Link to the organization's Impact page when available
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize"
- Always thank donors for making this possible

TONE & STYLE for Impact Sunday:
- Warm, grateful, and inspiring
- Tell the STORY of the equipment/funding and its impact
- Make it personal - mention specific departments, staff names, patient benefits
- Use phrases like "Thanks to our donors, event participants, and 50/50 supporters..."
- Show the connection between ticket purchases and healthcare improvements

COMMON PHRASES TO USE:
- "IMPACT SUNDAY: You helped make this possible!💙"
- "Thanks to our donors, event participants, and 50/50 supporters..."
- "Your support of our 50/50 directly funds..."
- "See how your support is making a difference"
- Link text: "See Your Impact" pointing to impact page

SUBJECT LINE STYLE:
- Always start with "IMPACT SUNDAY:"
- Include heart emoji 💙
- Example: "IMPACT SUNDAY: You helped make this possible!💙"

EMAIL STRUCTURE:
1. Headline about the equipment/funding
2. Story about what was purchased and why it matters
3. Quote from hospital staff (name and title)
4. Impact statistics if available
5. "See Your Impact" link to impact page
6. Reminder about current 50/50 with link to winners area
7. Standard footer with lottery licence`,

    'last-chance': `You are a professional email copywriter for [Organization Name]'s 50/50 lottery. You write LAST CHANCE emails that create urgency for final ticket purchases before major deadlines.

CRITICAL RULES:
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize" instead
- Website: [Organization Website]
- Deadline is typically 11:59PM the night before the draw
- Grand Prize draw is at 11AM on the last Friday of the month

TONE & STYLE for Last Chance emails:
- MAXIMUM URGENCY - this is the final opportunity
- Emphasize the size of the Grand Prize
- Use countdown timers and deadline language
- Make it clear this is their LAST CHANCE
- Be exciting about the potential - "We're going to make a MULTI-MILLIONAIRE!"

COMMON PHRASES TO USE:
- "THIS IS YOUR LAST CHANCE TO GET TICKETS!"
- "DEADLINE: TONIGHT 11:59PM!"
- "We are going to be making a MULTI-MILLIONAIRE!"
- "If you still haven't got your tickets, this is your LAST CHANCE!"
- "Don't miss out!"
- "The deadline to purchase tickets is [DAY] at 11:59PM!"

SUBJECT LINE STYLE:
- Create maximum urgency
- Examples: "LAST CALL FOR $2.56 MILLION+!⏰" or "WE JUST HIT $2 MILLION!🎊" or "THE [MONTH] 50/50 IS $2 MILLION+!🤩"

EMAIL STRUCTURE:
1. URGENT opener about deadline
2. Grand Prize amount (big and bold)
3. Deadline clearly stated
4. Timer/countdown if applicable
5. What's coming next (next month's draw preview if end of month)
6. Buy tickets CTA
7. Subscription reminder if applicable
8. Standard footer`
};

// Helper function to replace org profile placeholders with actual values
function replaceOrgPlaceholders(text) {
    const org = currentUser?.organization;
    if (!org || !text) return text;
    const replacements = {
        '[Organization Name]': org.name,
        '[Organization Website]': org.website_url,
        '[In-Person Ticket Location]': org.store_location,
        '[Licence Number]': org.licence_number,
        '[Catch The Ace Website]': org.cta_website_url,
        '[CEO/President Name]': org.ceo_name,
        '[CEO/President Title]': org.ceo_title,
        '[Media Contact Name]': org.media_contact_name,
        '[Media Contact Email]': org.media_contact_email,
        '[Support Email]': org.support_email,
        '[Draw Time]': org.default_draw_time,
        '[Sales Close Time]': org.ticket_deadline_time
    };
    for (const [placeholder, value] of Object.entries(replacements)) {
        if (value) {
            text = text.replaceAll(placeholder, value);
        }
    }
    return text;
}

// Helper function to build enhanced system prompt with examples from knowledge base
async function buildEnhancedSystemPrompt(contentType, emailType = null, userInquiry = null) {
    let basePrompt = '';
    let knowledgeBaseType = '';

    if (emailType) {
        // Use email-specific prompt
        basePrompt = EMAIL_SYSTEM_PROMPTS[emailType];
        // Map email type to knowledge base type
        const emailMapping = {
            'new-draw': 'email-new-draw',
            'draw-reminder': 'email-reminder',
            'winners': 'email-winners',
            'impact-sunday': 'email-impact',
            'last-chance': 'email-last-chance'
        };
        knowledgeBaseType = emailMapping[emailType];
    } else {
        // Use general draft prompt
        basePrompt = DRAFT_SYSTEM_PROMPT;
        // Map content type to knowledge base type
        const typeMapping = {
            'social': 'social',
            'media-release': 'media-release',
            'ad': 'social-ads'
        };
        knowledgeBaseType = typeMapping[contentType];
    }

    // Inject language preference
    basePrompt += getLanguageInstruction();

    // Inject org-specific brand guidelines from database (replaces former hardcoded DRAFT_KNOWLEDGE_BASE)
    const org = currentUser?.organization;
    if (org?.brand_terminology) {
        try {
            const bt = typeof org.brand_terminology === 'string' ? JSON.parse(org.brand_terminology) : org.brand_terminology;
            let guidelinesPrompt = '\nBRAND GUIDELINES:\n';
            if (bt.notes && bt.notes.length > 0) {
                bt.notes.forEach(note => { guidelinesPrompt += `- ${note}\n`; });
            }
            if (org.website_url) guidelinesPrompt += `- Website: ${org.website_url}\n`;
            if (org.store_location) guidelinesPrompt += `- Store: ${org.store_location}\n`;
            guidelinesPrompt += '\nFORMATTING:\n- Maximum 2 emojis per social post (one at end of sentence)\n- Social posts: short paragraph form with line breaks\n- All social posts must include licence disclaimer at end\n- Emails are for copy content only (not full templates with headers)\n';
            basePrompt += guidelinesPrompt;
        } catch (e) {
            console.warn('Could not parse brand_terminology:', e);
        }
    }

    // Inject org-specific content templates as examples for the current content type
    if (orgContentTemplates.length > 0 && knowledgeBaseType) {
        const relevantTemplates = orgContentTemplates.filter(t => t.template_type === knowledgeBaseType);
        if (relevantTemplates.length > 0) {
            let examplesPrompt = '\n\nEXAMPLES (use these as style/format reference):\n';
            relevantTemplates.slice(0, 3).forEach((tmpl, idx) => {
                examplesPrompt += `\n--- Example ${idx + 1} ---\n`;
                if (tmpl.subject) examplesPrompt += `Subject: ${tmpl.subject}\n`;
                if (tmpl.headline) examplesPrompt += `Headline: ${tmpl.headline}\n`;
                if (tmpl.name) examplesPrompt += `Type: ${tmpl.name}\n`;
                examplesPrompt += `${tmpl.content}\n`;
            });
            basePrompt += examplesPrompt;
        }
    }

    // Inject org-specific knowledge base entries (custom KB from database)
    if (typeof customKnowledge !== 'undefined' && customKnowledge.length > 0) {
        const kbContext = customKnowledge.slice(0, 15).map(k =>
            `Topic: ${k.question || k.title}\nContent: ${(k.response || k.content || '').substring(0, 500)}`
        ).join('\n\n---\n\n');
        basePrompt += '\n\nORGANIZATION KNOWLEDGE BASE (use this information to stay accurate and on-brand):\n' + kbContext;
    }

    // Inject draw schedule context so Draft Assistant knows current dates/prizes
    const drawCtx = getDrawScheduleContext();
    if (drawCtx) {
        basePrompt += '\n\n' + drawCtx;
    }

    // Inject rated examples from feedback loop, filtered by topic relevance
    const ratedExamples = await getRatedExamples('draft_assistant', null, userInquiry);
    basePrompt += buildRatedExamplesContext(ratedExamples);

    // Replace org profile placeholders with actual values
    basePrompt = replaceOrgPlaceholders(basePrompt);

    return basePrompt;
}

function setupDraftAssistant() {
    if (draftAssistantInitialized) return;
    draftAssistantInitialized = true;

    // Tab click handlers
    document.querySelectorAll('.draft-tab').forEach(tab => {
        tab.addEventListener('click', () => selectDraftTab(tab.dataset.draftTab));
    });

    // Tone buttons (standard panel)
    document.querySelectorAll('.draft-tone-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.draft-tone-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentDraftTone = btn.dataset.tone;
        });
    });

    // Email type dropdown
    document.getElementById('draftEmailTypeSelect').addEventListener('change', (e) => {
        const emailType = e.target.value;
        currentEmailType = emailType;
        const impactContext = document.getElementById('impactSundayContext');
        const keyDetails = document.getElementById('emailKeyDetails');
        const emailAddons = document.getElementById('emailAddonsSection');
        if (emailType === '') {
            impactContext.style.display = 'none';
            keyDetails.style.display = 'none';
            emailAddons.style.display = 'none';
        } else if (emailType === 'impact-sunday') {
            impactContext.style.display = 'block';
            keyDetails.style.display = 'none';
            emailAddons.style.display = 'block';
        } else {
            impactContext.style.display = 'none';
            keyDetails.style.display = 'block';
            emailAddons.style.display = 'block';
            document.getElementById('emailDetailsLabel').textContent = EMAIL_DETAILS_LABELS[emailType];
            document.getElementById('draftEmailDetails').placeholder = EMAIL_DETAILS_PLACEHOLDERS[emailType];
        }
    });

    // Write Anything toggle pills
    document.querySelectorAll('.wa-toggle-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const group = pill.closest('.wa-toggle-group');
            group.querySelectorAll('.wa-toggle-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
        });
    });

    // Quote toggles
    document.querySelectorAll('.draft-quote-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const quoteNum = btn.dataset.quote;
            const fields = document.getElementById('draftQuoteFields' + quoteNum);
            if (fields.style.display === 'none') {
                fields.style.display = 'flex';
                btn.textContent = '\u2212 Remove';
            } else {
                fields.style.display = 'none';
                btn.textContent = '+ Add';
                document.querySelectorAll('[data-quote="' + quoteNum + '"]').forEach(el => { if (el.value !== undefined) el.value = ''; });
            }
        });
    });

    // Unified generate button
    document.getElementById('draftStudioGenerateBtn').addEventListener('click', () => {
        if (activeDraftTab === 'email') generateEmailDraft();
        else if (activeDraftTab === 'write-anything') generateWriteAnything();
        else generateDraft();
    });

    // Copy button
    document.getElementById('draftCopyBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('draftOutputContent').textContent).then(() => {
            showToast('Copied to clipboard!', 'success');
        });
    });

    // Copy as HTML button
    document.getElementById('draftCopyHtmlBtn').addEventListener('click', () => {
        const plainText = document.getElementById('draftOutputContent').textContent;
        const htmlContent = plainText.split(/\n\n+/).map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('\n');
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        navigator.clipboard.write([new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })]).then(() => {
            showToast('Copied as HTML \u2014 paste into Mailchimp, Gmail, etc.', 'success');
        }).catch(() => {
            navigator.clipboard.writeText(plainText).then(() => showToast('Copied to clipboard', 'info'));
        });
    });

    // Regenerate button
    document.getElementById('draftRegenerateBtn').addEventListener('click', () => {
        if (lastDraftRequest) {
            if (lastDraftRequest.isWriteAnything) generateWriteAnything();
            else if (lastDraftRequest.isEmail) generateEmailDraft();
            else generateDraft();
        }
    });

    // Refine chips
    document.querySelectorAll('.draft-refine-chip').forEach(chip => {
        chip.addEventListener('click', () => refineDraft(chip.dataset.instruction));
    });

    // Refine button + Enter key
    document.getElementById('draftRefineBtn').addEventListener('click', () => {
        const input = document.getElementById('draftRefineInput');
        if (input.value.trim()) { refineDraft(input.value.trim()); input.value = ''; }
    });
    document.getElementById('draftRefineInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) { refineDraft(e.target.value.trim()); e.target.value = ''; }
    });

    // New draft button
    document.getElementById('draftNewBtn').addEventListener('click', resetDraftAssistant);

    // Initialize first tab
    selectDraftTab('email');
}

function selectDraftTab(tabId) {
    activeDraftTab = tabId;

    // Update tab active state
    document.querySelectorAll('.draft-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.querySelector('.draft-tab[data-draft-tab="' + tabId + '"]');
    if (activeTab) activeTab.classList.add('active');

    // Show correct panel
    document.getElementById('draftPanelEmail').style.display = 'none';
    document.getElementById('draftPanelStandard').style.display = 'none';
    document.getElementById('draftPanelWriteAnything').style.display = 'none';

    if (tabId === 'email') {
        document.getElementById('draftPanelEmail').style.display = 'flex';
        currentDraftType = 'email';
    } else if (tabId === 'write-anything') {
        document.getElementById('draftPanelWriteAnything').style.display = 'flex';
        currentDraftType = 'write-anything';
    } else {
        document.getElementById('draftPanelStandard').style.display = 'flex';
        currentDraftType = tabId;
        // Show quotes section only for media release
        const quoteSection = document.getElementById('draftQuoteSection');
        if (quoteSection) quoteSection.style.display = (tabId === 'media-release') ? 'block' : 'none';
    }

    // Update empty state (only if output is not showing)
    const outputEl = document.getElementById('draftStudioOutput');
    if (outputEl && outputEl.style.display === 'none') {
        updateDraftEmptyState(tabId);
    }
}

function updateDraftEmptyState(tabId) {
    const state = DRAFT_EMPTY_STATES[tabId];
    if (!state) return;
    const iconEl = document.getElementById('draftEmptyIcon');
    const titleEl = document.getElementById('draftEmptyTitle');
    const textEl = document.getElementById('draftEmptyText');
    const tipsEl = document.getElementById('draftEmptyTips');
    if (iconEl) iconEl.textContent = state.icon;
    if (titleEl) titleEl.textContent = state.title;
    if (textEl) textEl.textContent = state.text;
    if (tipsEl) {
        tipsEl.innerHTML = '<h4>Tips</h4><ul>' + state.tips.map(t => '<li>' + t + '</li>').join('') + '</ul>';
    }
}

// Helper to show/hide main area sections
function showDraftMain(section) {
    document.getElementById('draftStudioEmpty').style.display = 'none';
    document.getElementById('draftStudioLoading').style.display = 'none';
    document.getElementById('draftStudioOutput').style.display = 'none';
    if (section === 'empty') document.getElementById('draftStudioEmpty').style.display = 'flex';
    else if (section === 'loading') document.getElementById('draftStudioLoading').style.display = 'flex';
    else if (section === 'output') document.getElementById('draftStudioOutput').style.display = 'flex';
}

async function generateDraft() {
    const topic = document.getElementById('draftTopicInput').value.trim();
    if (!topic) {
        showToast('Please enter a topic or announcement', 'error');
        return;
    }

    const details = document.getElementById('draftDetailsInput').value.trim();

    // Get quote info if applicable (up to 5 quotes for media releases)
    let quoteInfo = '';
    if (currentDraftType === 'media-release') {
        const quotes = [];
        for (let i = 1; i <= 5; i++) {
            const fields = document.getElementById('draftQuoteFields' + i);
            if (fields && fields.style.display !== 'none') {
                const nameInput = document.querySelector('.draft-quote-name[data-quote="' + i + '"]');
                const titleInput = document.querySelector('.draft-quote-title[data-quote="' + i + '"]');
                const textInput = document.querySelector('.draft-quote-text[data-quote="' + i + '"]');
                const name = nameInput ? nameInput.value.trim() : '';
                const title = titleInput ? titleInput.value.trim() : '';
                const text = textInput ? textInput.value.trim() : '';
                if (name && text) {
                    quotes.push({ name, title, text });
                }
            }
        }
        if (quotes.length > 0) {
            quoteInfo = '\n\nInclude the following quotes in the media release:';
            quotes.forEach((q, idx) => {
                quoteInfo += '\n' + (idx + 1) + '. Quote from ' + q.name + (q.title ? ', ' + q.title : '') + ': "' + q.text + '"';
            });
        }
    }

    // Build the user prompt
    let userPrompt = "Write a " + DRAFT_TYPE_LABELS[currentDraftType] + " about: " + topic;
    if (details) {
        userPrompt += "\n\nKey details to include: " + details;
    }

    // Add required line for social media posts
    if (currentDraftType === 'social') {
        const org = currentUser?.organization;
        // Use org's custom social required line if set, otherwise fall back to generic placeholder
        let requiredLine = org?.social_required_line || 'Purchase tickets online at [Organization Website] or at the [In-Person Ticket Location]!';
        requiredLine = replaceOrgPlaceholders(requiredLine);
        userPrompt += '\n\nIMPORTANT: You MUST include this exact line in the post: "' + requiredLine + '"';
    }
    userPrompt += quoteInfo;
    userPrompt += "\n\nTone: " + currentDraftTone;

    if (currentDraftType === 'ad') {
        const org = currentUser?.organization;
        const adUrl = org?.website_url || '[Organization Website]';
        userPrompt += "\n\nREMEMBER: Maximum 120 characters and MUST include " + adUrl;
    }

    lastDraftRequest = { topic, details, quoteInfo };

    // Show output area immediately for streaming
    showDraftMain('output');
    document.getElementById('draftOutputBadge').textContent = DRAFT_TYPE_LABELS[currentDraftType];
    const outputEl = document.getElementById('draftOutputContent');
    outputEl.innerHTML = '';
    document.getElementById('draftCopyHtmlBtn').style.display = 'none';

    try {
        const enhancedSystemPrompt = await buildEnhancedSystemPrompt(currentDraftType, null, topic);

        const { text: generatedContent } = await fetchStream({
            system: enhancedSystemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
            max_tokens: 1024
        }, {
            onText: (chunk) => {
                outputEl._rawText = (outputEl._rawText || '') + chunk;
                outputEl.innerHTML = escapeHtmlWithLinks(outputEl._rawText);
            }
        });

        saveDraftToHistory(userPrompt, generatedContent, currentDraftType);

        const disclaimer = document.getElementById('draftDisclaimer');
        if (currentDraftType === 'ad') {
            const charCount = generatedContent.length;
            disclaimer.innerHTML = 'Character count: ' + charCount + '/120 ' + (charCount > 120 ? '\u26A0\uFE0F Over limit!' : '\u2705');
            disclaimer.style.display = 'block';
        } else {
            disclaimer.innerHTML = '\u26A0\uFE0F Always review AI-generated content before publishing. Verify all facts, dates, and figures.';
            disclaimer.style.display = 'block';
        }

    } catch (error) {
        showDraftMain('empty');
        if (!['TRIAL_EXPIRED', 'AUTH_REQUIRED'].includes(error.message)) {
            showToast('Error generating draft: ' + error.message, 'error');
        }
    }
}

async function generateWriteAnything() {
    const topic = document.getElementById('writeAnythingTopic').value.trim();
    if (!topic) {
        showToast('Please describe what you want to write', 'error');
        return;
    }

    const context = document.getElementById('writeAnythingContext').value.trim();

    // Get selected toggles
    const toneEl = document.querySelector('.wa-toggle-pill[data-wa-tone].active');
    const formatEl = document.querySelector('.wa-toggle-pill[data-wa-format].active');
    const lengthEl = document.querySelector('.wa-toggle-pill[data-wa-length].active');
    const tone = toneEl ? toneEl.dataset.waTone : 'balanced';
    const format = formatEl ? formatEl.dataset.waFormat : 'paragraphs';
    const length = lengthEl ? lengthEl.dataset.waLength : 'standard';

    // Build user prompt
    let userPrompt = topic;
    if (context) {
        userPrompt += '\n\nAdditional context: ' + context;
    }
    userPrompt += '\n\nTone: ' + tone;
    userPrompt += '\nFormat: ' + format.replace('-', ' ');
    userPrompt += '\nLength: ' + length;

    lastDraftRequest = { topic, context, isWriteAnything: true };

    // Show output area immediately for streaming
    showDraftMain('output');
    document.getElementById('draftOutputBadge').textContent = '\u2728 Write Anything';
    const outputEl = document.getElementById('draftOutputContent');
    outputEl.innerHTML = '';
    document.getElementById('draftCopyHtmlBtn').style.display = 'none';

    try {
        let systemPrompt = replaceOrgPlaceholders(WRITE_ANYTHING_GUIDE) + getLanguageInstruction();

        if (typeof customKnowledge !== 'undefined' && customKnowledge.length > 0) {
            const kbContext = customKnowledge.slice(0, 15).map(k =>
                `Topic: ${k.question || k.title}\nContent: ${(k.response || k.content || '').substring(0, 500)}`
            ).join('\n\n---\n\n');
            systemPrompt += '\n\nORGANIZATION KNOWLEDGE BASE (use this information to stay accurate and on-brand):\n' + kbContext;
        }

        const ratedExamples = await getRatedExamples('draft_assistant', null, topic);
        systemPrompt += buildRatedExamplesContext(ratedExamples);

        const { text: generatedContent } = await fetchStream({
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
            max_tokens: 2048
        }, {
            onText: (chunk) => {
                outputEl._rawText = (outputEl._rawText || '') + chunk;
                outputEl.innerHTML = escapeHtmlWithLinks(outputEl._rawText);
            }
        });

        saveDraftToHistory(userPrompt, generatedContent, 'write-anything');

        const disclaimer = document.getElementById('draftDisclaimer');
        disclaimer.innerHTML = '\u26A0\uFE0F Always review AI-generated content before publishing. Verify all facts, dates, and figures.';
        disclaimer.style.display = 'block';

    } catch (error) {
        showDraftMain('empty');
        if (!['TRIAL_EXPIRED', 'AUTH_REQUIRED'].includes(error.message)) {
            showToast('Error generating content: ' + error.message, 'error');
        }
    }
}

async function generateEmailDraft() {
    if (!currentEmailType) {
        showToast('Please select an email type', 'error');
        return;
    }

    let userPrompt = '';
    let details = '';

    if (currentEmailType === 'impact-sunday') {
        const context = document.getElementById('draftImpactContext').value.trim();
        if (!context) {
            showToast('Please paste the context about the equipment/funding', 'error');
            return;
        }
        userPrompt = "Write an Impact Sunday email based on this context about equipment or funding:\n\n" + context;
        userPrompt += "\n\nInclude a subject line at the beginning. The email should tell the story of how donor support made this possible, and include a staff quote if the context provides one.";
        details = context;
    } else {
        details = document.getElementById('draftEmailDetails').value.trim();
        if (!details) {
            showToast('Please enter the key details for the email', 'error');
            return;
        }
        userPrompt = "Write a " + EMAIL_TYPE_LABELS[currentEmailType] + " email with these details:\n\n" + details;
        userPrompt += "\n\nInclude a subject line at the beginning.";
    }

    // Check for email add-ons
    const addSubscriptions = document.getElementById('emailAddSubscriptions').checked;
    const addCatchTheAce = document.getElementById('emailAddCatchTheAce').checked;
    const addOther = document.getElementById('emailAddOther').checked;

    if (addSubscriptions || addCatchTheAce || addOther) {
        userPrompt += "\n\nAt the end of the email, include the following additional sections:";

        // Pull email add-on content from org's DB-stored config, falling back to generic placeholders
        const orgAddons = currentUser?.organization?.email_addons;
        const addons = typeof orgAddons === 'string' ? JSON.parse(orgAddons || '{}') : (orgAddons || {});

        if (addSubscriptions) {
            const subContent = addons.subscriptions || 'Did you know you can subscribe to [Organization Name]? Never miss a draw! Set up a monthly subscription and your tickets are automatically purchased each month. Visit [Organization Website] to set up your subscription today!';
            userPrompt += "\n\n--- SUBSCRIPTIONS SECTION ---\n" + replaceOrgPlaceholders(subContent);
        }

        if (addCatchTheAce) {
            const ctaContent = addons.catchTheAce || 'The [Organization Name] Catch The Ace is LIVE! Catch The Ace is a weekly progressive lottery. Come see what the fun is all about at [Catch The Ace Website]!';
            userPrompt += "\n\n--- CATCH THE ACE SECTION ---\n" + replaceOrgPlaceholders(ctaContent);
        }

        if (addOther) {
            const otherContent = addons.other || '';
            if (otherContent) {
                userPrompt += "\n\n--- ADDITIONAL PROGRAM SECTION ---\n" + replaceOrgPlaceholders(otherContent);
            }
        }
    }

    lastDraftRequest = { isEmail: true, emailType: currentEmailType, details: details, addSubscriptions, addCatchTheAce, addOther };

    // Show output area immediately for streaming
    showDraftMain('output');
    document.getElementById('draftOutputBadge').textContent = '📧 ' + EMAIL_TYPE_LABELS[currentEmailType];
    const outputEl = document.getElementById('draftOutputContent');
    outputEl.innerHTML = '';
    document.getElementById('draftCopyHtmlBtn').style.display = 'inline-flex';

    try {
        const enhancedSystemPrompt = await buildEnhancedSystemPrompt('email', currentEmailType, details);

        const { text: generatedContent } = await fetchStream({
            system: enhancedSystemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
            max_tokens: 2048
        }, {
            onText: (chunk) => {
                outputEl._rawText = (outputEl._rawText || '') + chunk;
                outputEl.innerHTML = escapeHtmlWithLinks(outputEl._rawText);
            }
        });

        saveDraftToHistory(userPrompt, generatedContent, 'email-' + currentEmailType);

        const disclaimer = document.getElementById('draftDisclaimer');
        disclaimer.innerHTML = '⚠️ Always review AI-generated content before publishing. Verify all facts, dates, and figures.';
        disclaimer.style.display = 'block';

    } catch (error) {
        console.error('Email draft generation error:', error);
        showDraftMain('empty');
        if (!['TRIAL_EXPIRED', 'AUTH_REQUIRED'].includes(error.message)) {
            showToast('Error generating email draft: ' + error.message, 'error');
        }
    }
}

function resetDraftAssistant() {
    currentDraftTone = 'balanced';
    lastDraftRequest = null;
    currentEmailType = null;

    // Reset standard form fields
    document.getElementById('draftTopicInput').value = '';
    document.getElementById('draftDetailsInput').value = '';

    // Reset all quote fields (1-3)
    for (let i = 1; i <= 3; i++) {
        const fields = document.getElementById('draftQuoteFields' + i);
        const toggle = document.querySelector('.draft-quote-toggle[data-quote="' + i + '"]');
        const nameInput = document.querySelector('.draft-quote-name[data-quote="' + i + '"]');
        const titleInput = document.querySelector('.draft-quote-title[data-quote="' + i + '"]');
        const textInput = document.querySelector('.draft-quote-text[data-quote="' + i + '"]');
        if (fields) fields.style.display = 'none';
        if (toggle) toggle.textContent = '+ Add';
        if (nameInput) nameInput.value = '';
        if (titleInput) titleInput.value = '';
        if (textInput) textInput.value = '';
    }

    // Reset email-specific fields
    document.getElementById('draftEmailTypeSelect').value = '';
    document.getElementById('draftImpactContext').value = '';
    document.getElementById('draftEmailDetails').value = '';
    document.getElementById('impactSundayContext').style.display = 'none';
    document.getElementById('emailKeyDetails').style.display = 'none';

    // Reset email add-ons
    document.getElementById('emailAddonsSection').style.display = 'none';
    document.getElementById('emailAddSubscriptions').checked = false;
    document.getElementById('emailAddCatchTheAce').checked = false;
    const emailAddOther = document.getElementById('emailAddOther');
    if (emailAddOther) emailAddOther.checked = false;

    // Reset Write Anything fields
    document.getElementById('writeAnythingTopic').value = '';
    document.getElementById('writeAnythingContext').value = '';
    document.querySelectorAll('.wa-toggle-pill').forEach(p => p.classList.remove('active'));
    const defaultTone = document.querySelector('.wa-toggle-pill[data-wa-tone="balanced"]');
    const defaultFormat = document.querySelector('.wa-toggle-pill[data-wa-format="paragraphs"]');
    const defaultLength = document.querySelector('.wa-toggle-pill[data-wa-length="standard"]');
    if (defaultTone) defaultTone.classList.add('active');
    if (defaultFormat) defaultFormat.classList.add('active');
    if (defaultLength) defaultLength.classList.add('active');

    // Reset tone buttons
    document.querySelectorAll('.draft-tone-btn').forEach(b => b.classList.remove('active'));
    const defaultDraftTone = document.querySelector('.draft-tone-btn[data-tone="balanced"]');
    if (defaultDraftTone) defaultDraftTone.classList.add('active');

    // Reset refine input
    const refineInput = document.getElementById('draftRefineInput');
    if (refineInput) refineInput.value = '';

    // Reset to current tab's empty state
    showDraftMain('empty');
    selectDraftTab(activeDraftTab || 'email');
}

// Store conversation history for refine feature
let draftConversationHistory = [];

async function refineDraft(instruction) {
    const currentContent = document.getElementById('draftOutputContent').textContent;
    if (!currentContent) return;

    // Clear output and stream directly
    const outputEl = document.getElementById('draftOutputContent');
    outputEl.innerHTML = '';
    outputEl._rawText = '';

    try {
        let enhancedSystemPrompt;
        const refineInquiry = lastDraftRequest?.details || lastDraftRequest?.topic || null;
        if (lastDraftRequest && lastDraftRequest.isWriteAnything) {
            enhancedSystemPrompt = replaceOrgPlaceholders(WRITE_ANYTHING_GUIDE) + getLanguageInstruction();
        } else if (lastDraftRequest && lastDraftRequest.isEmail) {
            enhancedSystemPrompt = await buildEnhancedSystemPrompt('email', lastDraftRequest.emailType, refineInquiry);
        } else {
            enhancedSystemPrompt = await buildEnhancedSystemPrompt(currentDraftType, null, refineInquiry);
        }

        const messages = [
            { role: 'user', content: 'Generate the content as requested.' },
            { role: 'assistant', content: currentContent },
            { role: 'user', content: instruction + '\n\nPlease provide the updated content only, without any explanations or preamble.' }
        ];

        await fetchStream({
            system: enhancedSystemPrompt,
            messages: messages,
            max_tokens: 2048
        }, {
            onText: (chunk) => {
                outputEl._rawText = (outputEl._rawText || '') + chunk;
                outputEl.innerHTML = escapeHtmlWithLinks(outputEl._rawText);
            }
        });

        showToast('Draft refined!', 'success');

    } catch (error) {
        console.error('Draft refinement error:', error);
        // Restore original content
        document.getElementById('draftOutputContent').innerHTML = escapeHtmlWithLinks(currentContent);
        if (!['TRIAL_EXPIRED', 'AUTH_REQUIRED'].includes(error.message)) {
            showToast('Error refining draft: ' + error.message, 'error');
        }
    }
}

// ==================== QUICK REPLY TEMPLATES ====================
const QUICK_REPLY_TEMPLATES = [
    {
        id: "tpl-1",
        category: "tickets",
        title: "Ticket Confirmation Email",
        content: `Hi there,

Thanks for reaching out! Your tickets were sent to your email immediately after purchase. Please check your spam/junk folder if you don't see them in your inbox.

The confirmation email comes from our lottery provider and contains all your ticket numbers. If you still can't find it, let me know and I can have it resent.

Best,
[NAME]`
    },
    {
        id: "tpl-2",
        category: "tickets",
        title: "Resend Ticket Request",
        content: `Hi there,

I'd be happy to have your tickets resent! I've forwarded your request to our team and they will resend your confirmation email within the next few hours.

Please check your spam/junk folder as well, as sometimes the emails get filtered there.

Best,
[NAME]`
    },
    {
        id: "tpl-3",
        category: "subscription",
        title: "Cancel Subscription",
        content: `Hi there,

I understand you'd like to cancel your subscription. You can manage your subscription directly through your account portal - simply log in with your email and click "Manage Subscription" to cancel.

If you need any assistance with the process, please don't hesitate to reach out!

Best,
[NAME]`
    },
    {
        id: "tpl-4",
        category: "subscription",
        title: "Modify Subscription",
        content: `Hi there,

You can modify your subscription (change the amount or update payment info) by visiting your account portal and logging in with your email.

From there, you can update your subscription amount, payment method, or pause/cancel as needed.

Let me know if you have any questions!

Best,
[NAME]`
    },
    {
        id: "tpl-5",
        category: "general",
        title: "Location Block (Ontario)",
        content: `Hi there,

I'm sorry you're experiencing location issues! Our lottery requires you to be physically located in Ontario to purchase tickets.

If you're using a VPN, please disable it. If you're on EastLink internet, there's a known issue where their network shows incorrect locations - you can call EastLink at 1-888-345-1111 to have them update your location.

Let me know if you continue to have trouble after trying these steps.

Best,
[NAME]`
    },
    {
        id: "tpl-6",
        category: "general",
        title: "Winner Notification Process",
        content: `Hi there,

Congratulations on your interest in our draws! Winners are always contacted directly by phone using the number provided during purchase. We also post winners on our website.

You don't need to check your numbers manually - if you win, we'll reach out to you!

Best,
[NAME]`
    },
    {
        id: "tpl-7",
        category: "tickets",
        title: "Can't Log In to View Tickets",
        content: `Hi there,

I understand the confusion! The account portal is only for managing your subscription - you cannot view your ticket numbers there.

Your ticket numbers are only available in the confirmation email you received when you made your purchase. If you need that email resent, please let me know!

Best,
[NAME]`
    },
    {
        id: "tpl-8",
        category: "general",
        title: "Tax Receipt Request",
        content: `Hi there,

Unfortunately, we're unable to provide tax receipts for lottery ticket purchases. Under CRA rules, lottery tickets are not considered charitable donations, even when the lottery supports a charity.

Thank you for your understanding and for supporting [Organization Name]!

Best,
[NAME]`
    }
];

let currentTemplateFilter = "all";

function renderTemplates() {
    const container = document.getElementById("templatesGrid");
    if (!container) return;

    const staffName = defaultName || "Name";

    // Filter templates
    const filtered = currentTemplateFilter === "all"
        ? QUICK_REPLY_TEMPLATES
        : QUICK_REPLY_TEMPLATES.filter(t => t.category === currentTemplateFilter);

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
                No templates in this category.
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(template => {
        const content = replaceOrgPlaceholders(template.content.replace(/\[NAME\]/g, staffName));
        return `
            <div class="template-card">
                <div class="template-category">${template.category}</div>
                <div class="template-title">${template.title}</div>
                <div class="template-preview">${escapeHtml(content.substring(0, 120))}...</div>
                <button class="template-copy-btn" onclick="copyTemplate('${template.id}', this)">📋 Copy to Clipboard</button>
            </div>
        `;
    }).join('');
}

function copyTemplate(templateId, btn) {
    const template = QUICK_REPLY_TEMPLATES.find(t => t.id === templateId);
    if (!template) return;

    const staffName = defaultName || "Name";
    const content = replaceOrgPlaceholders(template.content.replace(/\[NAME\]/g, staffName));

    navigator.clipboard.writeText(content).then(() => {
        btn.classList.add("copied");
        btn.textContent = "✓ Copied!";
        setTimeout(() => {
            btn.classList.remove("copied");
            btn.textContent = "📋 Copy to Clipboard";
        }, 2000);
    });
}

function setTemplateFilter(filter, btn) {
    currentTemplateFilter = filter;

    // Update active button
    document.querySelectorAll(".template-filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    renderTemplates();
}

// ==================== SENTIMENT DETECTION ====================
function detectSentiment(text) {
    const lowerText = text.toLowerCase();

    // Angry indicators
    const angryWords = ["furious", "outraged", "ridiculous", "unacceptable", "disgusted", "infuriated", "livid", "scam", "fraud", "steal", "stolen", "theft", "criminal", "sue", "lawyer", "legal action", "report you", "bbb", "better business"];
    const angryPunctuation = (text.match(/!{2,}/g) || []).length + (text.match(/\?{2,}/g) || []).length;
    const allCaps = (text.match(/[A-Z]{4,}/g) || []).length;

    // Frustrated indicators
    const frustratedWords = ["frustrated", "annoyed", "disappointed", "upset", "confused", "irritated", "fed up", "again", "still", "multiple times", "keep", "several", "third time", "fourth time", "already", "never", "won't", "can't", "doesn't work"];

    // Positive indicators
    const positiveWords = ["thank", "thanks", "appreciate", "grateful", "great", "wonderful", "excellent", "amazing", "love", "helpful", "awesome", "fantastic", "pleased"];

    // Count matches
    let angryScore = 0;
    let frustratedScore = 0;
    let positiveScore = 0;

    angryWords.forEach(word => {
        if (lowerText.includes(word)) angryScore += 2;
    });
    angryScore += angryPunctuation * 1.5;
    angryScore += allCaps * 1.5;

    frustratedWords.forEach(word => {
        if (lowerText.includes(word)) frustratedScore += 1;
    });

    positiveWords.forEach(word => {
        if (lowerText.includes(word)) positiveScore += 1;
    });

    // Determine sentiment
    if (angryScore >= 3) {
        return { sentiment: "angry", label: "😠 Angry Customer", class: "sentiment-angry", tip: "Use extra empathy and apologize for their frustration. Keep response calm and solution-focused." };
    } else if (frustratedScore >= 2 || angryScore >= 1) {
        return { sentiment: "frustrated", label: "😤 Frustrated", class: "sentiment-frustrated", tip: "Acknowledge their difficulty and provide clear, direct solutions." };
    } else if (positiveScore >= 2) {
        return { sentiment: "positive", label: "😊 Positive", class: "sentiment-positive", tip: "Customer seems happy! Match their positive energy." };
    } else {
        return { sentiment: "neutral", label: "😐 Neutral", class: "sentiment-neutral", tip: "Standard inquiry - respond with helpful, friendly tone." };
    }
}

function displaySentimentBadge(text) {
    const sentiment = detectSentiment(text);
    return `
        <div class="sentiment-badge ${sentiment.class}" title="${sentiment.tip}">
            ${sentiment.label}
        </div>
    `;
}

// ==================== INLINE EDIT MODE ====================
let isEditMode = false;
let originalResponse = "";

function toggleEditMode() {
    const responseBox = document.getElementById("responseText");
    const editBtn = document.getElementById("editModeBtn");
    const editIndicator = document.getElementById("editModeIndicator");
    const editActions = document.getElementById("editActions");

    if (!responseBox) return;

    if (!isEditMode) {
        // Enter edit mode
        isEditMode = true;
        originalResponse = responseBox.innerText;
        responseBox.contentEditable = true;
        responseBox.classList.add("editable");
        responseBox.focus();

        if (editBtn) {
            editBtn.innerHTML = "✏️ Editing...";
            editBtn.classList.add("active");
        }
        if (editIndicator) editIndicator.style.display = "flex";
        if (editActions) editActions.style.display = "flex";
    } else {
        // Exit edit mode
        exitEditMode(false);
    }
}

function saveEdit() {
    const responseBox = document.getElementById("responseText");
    if (responseBox) {
        currentResponse = responseBox.innerText;
    }
    exitEditMode(true);
    showToast("Changes saved!", "success");
}

function cancelEdit() {
    const responseBox = document.getElementById("responseText");
    if (responseBox && originalResponse) {
        responseBox.innerText = originalResponse;
    }
    exitEditMode(false);
}

function exitEditMode(saved) {
    isEditMode = false;
    const responseBox = document.getElementById("responseText");
    const editBtn = document.getElementById("editModeBtn");
    const editIndicator = document.getElementById("editModeIndicator");
    const editActions = document.getElementById("editActions");

    if (responseBox) {
        responseBox.contentEditable = false;
        responseBox.classList.remove("editable");
    }
    if (editBtn) {
        editBtn.innerHTML = "✏️ Edit";
        editBtn.classList.remove("active");
    }
    if (editIndicator) editIndicator.style.display = "none";
    if (editActions) editActions.style.display = "none";
}

// ==================== LEADERBOARD ====================
function getLeaderboard() {
    const userCounts = {};

    // Get all users from localStorage
    const storedUsers = localStorage.getItem("lightspeed_users");
    if (storedUsers) {
        try {
            const allUsers = JSON.parse(storedUsers);
            allUsers.forEach(user => {
                const count = user.data && user.data.responseHistory ? user.data.responseHistory.length : 0;
                if (count > 0) {
                    userCounts[user.name] = count;
                }
            });
        } catch (e) {
            console.error("Error loading leaderboard data:", e);
        }
    }

    // Sort by count descending
    return Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count], index) => ({
            rank: index + 1,
            name: name,
            count: count
        }));
}

function renderLeaderboardFromData(leaderboard) {
    const container = document.getElementById("leaderboardContainer");
    if (!container) return;

    if (leaderboard.length === 0) {
        container.innerHTML = emptyStateHtml('🏆', 'No leaderboard data yet', 'Generate responses to see your team rankings.', 'Generate Response', "switchPage('response')");
        return;
    }

    renderLeaderboardHtml(container, leaderboard);
}

function renderLeaderboard() {
    const container = document.getElementById("leaderboardContainer");
    if (!container) return;

    const leaderboard = getLeaderboard();

    if (leaderboard.length === 0) {
        container.innerHTML = emptyStateHtml('🏆', 'No leaderboard data yet', 'Generate responses to see your team rankings.', 'Generate Response', "switchPage('response')");
        return;
    }

    renderLeaderboardHtml(container, leaderboard);
}

function renderLeaderboardHtml(container, leaderboard) {
    const podiumHtml = leaderboard.length >= 1 ? `
        <div class="leaderboard-podium">
            ${leaderboard[1] ? `
                <div class="podium-item second">
                    <div class="podium-rank">&#129352;</div>
                    <div class="podium-name">${escapeHtml(leaderboard[1].name)}</div>
                    <div class="podium-count">${leaderboard[1].count} responses</div>
                </div>
            ` : ''}
            <div class="podium-item first">
                <div class="podium-rank">&#129351;</div>
                <div class="podium-name">${escapeHtml(leaderboard[0].name)}</div>
                <div class="podium-count">${leaderboard[0].count} responses</div>
            </div>
            ${leaderboard[2] ? `
                <div class="podium-item third">
                    <div class="podium-rank">&#129353;</div>
                    <div class="podium-name">${escapeHtml(leaderboard[2].name)}</div>
                    <div class="podium-count">${leaderboard[2].count} responses</div>
                </div>
            ` : ''}
        </div>
    ` : '';

    const listHtml = leaderboard.length > 3 ? `
        <div class="leaderboard-list">
            ${leaderboard.slice(3).map(entry => `
                <div class="leaderboard-row">
                    <div class="leaderboard-rank">#${entry.rank}</div>
                    <div class="leaderboard-name">${escapeHtml(entry.name)}</div>
                    <div class="leaderboard-count">${entry.count}</div>
                </div>
            `).join('')}
        </div>
    ` : '';

    container.innerHTML = podiumHtml + listHtml;
}

// ==================== LIST NORMALIZER ====================
let listNormalizerListenersSetup = false;
let normalizerProcessedData = null;
let normalizerFileName = null;
let rawNormalizerListenersSetup = false;
let rawNormalizerRawData = null;
let rawNormalizerProcessedData = null;
let rawNormalizerFileName = null;
const NORMALIZER_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// --- Hub Navigation ---
function showNormalizerHub() {
    document.getElementById('normalizerHub').style.display = 'block';
    document.getElementById('normalizerMarketingView').style.display = 'none';
    document.getElementById('normalizerRawView').style.display = 'none';
    document.getElementById('normalizerDuplicatesView').style.display = 'none';
    document.getElementById('normalizerCompareView').style.display = 'none';
    document.getElementById('normalizerEmailCleanerView').style.display = 'none';
    pushRoute('/list-normalizer');
}

function openNormalizerSubTool(subTool) {
    document.getElementById('normalizerHub').style.display = 'none';
    document.getElementById('normalizerMarketingView').style.display = 'none';
    document.getElementById('normalizerRawView').style.display = 'none';
    document.getElementById('normalizerDuplicatesView').style.display = 'none';
    document.getElementById('normalizerCompareView').style.display = 'none';
    document.getElementById('normalizerEmailCleanerView').style.display = 'none';

    if (subTool === 'marketing') {
        document.getElementById('normalizerMarketingView').style.display = 'block';
        setupListNormalizerListeners();
        pushRoute('/list-normalizer/marketing');
    } else if (subTool === 'raw') {
        document.getElementById('normalizerRawView').style.display = 'block';
        setupRawNormalizerListeners();
        pushRoute('/list-normalizer/raw');
    } else if (subTool === 'duplicates') {
        document.getElementById('normalizerDuplicatesView').style.display = 'block';
        setupDupFinderListeners();
        pushRoute('/list-normalizer/duplicates');
    } else if (subTool === 'compare') {
        document.getElementById('normalizerCompareView').style.display = 'block';
        setupCompareListeners();
        pushRoute('/list-normalizer/compare');
    } else if (subTool === 'email-cleaner') {
        document.getElementById('normalizerEmailCleanerView').style.display = 'block';
        setupEmailCleanerListeners();
        pushRoute('/list-normalizer/email-cleaner');
    } else if (subTool === 'shopify-import') {
        handleShopifyCustomerImport();
        // Stay on hub — the import downloads a file directly
    }
}

function setupListNormalizerListeners() {
    if (listNormalizerListenersSetup) return;

    const dropzone = document.getElementById("normalizerDropzone");
    const fileInput = document.getElementById("normalizerFileInput");

    if (!dropzone || !fileInput) {
        console.error("List Normalizer elements not found");
        return;
    }

    listNormalizerListenersSetup = true;

    // Drag and drop handlers
    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        const file = e.dataTransfer.files[0];
        if (file) processNormalizerFile(file);
    });

    // File input change
    fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) processNormalizerFile(file);
    });

    // Download button
    document.getElementById("normalizerDownloadBtn").addEventListener("click", downloadNormalizedList);

    // Reset button
    document.getElementById("normalizerResetBtn").addEventListener("click", resetListNormalizer);

    // Show export history
    renderNormalizerHistory();

}

function processNormalizerFile(file) {
    if (!file.name.match(/\.xlsx?$/i) && !file.name.match(/\.csv$/i)) {
        showToast("Please upload a spreadsheet file (.xlsx, .xls, or .csv)", "error");
        return;
    }

    if (file.size > NORMALIZER_MAX_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        showToast(`File is too large (${sizeMB} MB). Maximum size is 10 MB.`, "error");
        return;
    }

    normalizerFileName = file.name;

    // Show processing state
    document.getElementById("normalizerUploadSection").style.display = "none";
    document.getElementById("normalizerProcessing").style.display = "block";

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rawData = XLSX.utils.sheet_to_json(sheet);

            // Process the data for Mailchimp
            processForMailchimp(rawData);

        } catch (error) {
            showToast("Error reading file: " + error.message, "error");
            resetListNormalizer();
        }
    };
    reader.readAsArrayBuffer(file);
}

function processForMailchimp(rawData) {
    // Auto-detect column names - scan ALL rows since some columns may be missing in first row
    const allColumns = new Set();
    rawData.forEach(row => {
        Object.keys(row).forEach(key => allColumns.add(key));
    });
    const columns = Array.from(allColumns);

    // More specific column matching - check exact matches first, then partial
    const findCol = (exactMatches, partialMatches) => {
        // First try exact matches (case-insensitive)
        for (const exact of exactMatches) {
            const found = columns.find(c => c.toLowerCase().trim() === exact.toLowerCase());
            if (found) return found;
        }
        // Then try partial matches
        for (const partial of partialMatches) {
            const found = columns.find(c => c.toLowerCase().includes(partial.toLowerCase()));
            if (found) return found;
        }
        return null;
    };

    const firstNameCol = findCol(
        ['first name', 'firstname', 'first_name', 'fname'],
        ['first']
    );
    const lastNameCol = findCol(
        ['last name', 'lastname', 'last_name', 'lname', 'surname'],
        ['last', 'surname']
    );
    const emailCol = findCol(
        ['email', 'e-mail', 'email address', 'emailaddress'],
        ['email', 'e-mail']
    );


    if (!emailCol) {
        showToast("Could not find an email column in the file", "error");
        resetListNormalizer();
        return;
    }

    const originalCount = rawData.length;

    // Process and filter the data
    const processedData = rawData
        .filter(row => {
            // Must have email
            const email = row[emailCol];
            return email && String(email).trim().length > 0;
        })
        .map(row => {
            // Combine first and last name
            const firstName = firstNameCol && row[firstNameCol] ? String(row[firstNameCol]).trim() : '';
            const lastName = lastNameCol && row[lastNameCol] ? String(row[lastNameCol]).trim() : '';


            // Build full name by concatenating first and last
            let fullName = '';
            if (firstName) {
                fullName = firstName;
            }

            // Only add last name if it looks like a real name (not garbage data)
            const isValidLastName = lastName &&
                lastName !== '.' &&
                lastName !== '-' &&
                lastName.toLowerCase() !== 'n/a' &&
                !lastName.startsWith('.') &&  // Filter ".medaglia" type entries
                !/^\d/.test(lastName) &&      // Filter entries starting with numbers (addresses)
                !/\d{2,}/.test(lastName);     // Filter entries with 2+ consecutive digits (addresses)

            if (isValidLastName) {
                fullName = fullName ? (fullName + ' ' + lastName) : lastName;
            }

            // Clean up the name
            fullName = fullName.trim();

            return {
                NAME: fullName,
                EMAIL: String(row[emailCol]).trim().toLowerCase()
            };
        })
        .filter(row => row.NAME.length > 0) // Must have a name
        .sort((a, b) => a.EMAIL.localeCompare(b.EMAIL)); // Sort by email

    // Remove duplicates by email (keep first occurrence)
    const uniqueEmails = new Set();
    const uniqueData = processedData.filter(row => {
        if (uniqueEmails.has(row.EMAIL)) {
            return false;
        }
        uniqueEmails.add(row.EMAIL);
        return true;
    });

    normalizerProcessedData = uniqueData;
    const cleanCount = uniqueData.length;
    const removedCount = originalCount - cleanCount;

    // Log usage to backend
    logNormalizerUsage(originalCount, cleanCount, removedCount);

    // Update stats with animation
    setTimeout(() => {
        document.getElementById("normalizerProcessing").style.display = "none";
        document.getElementById("normalizerResults").style.display = "block";

        // Animate the numbers
        animateValue(document.getElementById("normalizerOriginalCount"), 0, originalCount, 1000);
        animateValue(document.getElementById("normalizerCleanCount"), 0, cleanCount, 1000);
        animateValue(document.getElementById("normalizerRemovedCount"), 0, removedCount, 1000);

        // Show preview table
        showNormalizerPreview(uniqueData);
    }, 800);
}

async function logNormalizerUsage(originalCount, cleanCount, removedCount) {
    try {
        await fetch(`${API_BASE_URL}/api/normalize/log`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                originalCount,
                cleanCount,
                removedCount,
                fileName: normalizerFileName
            })
        });
    } catch (err) {
        // Non-critical — don't interrupt user flow
        console.warn('[List Normalizer] Failed to log usage:', err.message);
    }
}

function showNormalizerPreview(data) {
    const container = document.getElementById("normalizerPreviewTable");
    const previewData = data.slice(0, 10); // Show first 10 rows

    let html = `
        <table>
            <thead>
                <tr>
                    <th>NAME</th>
                    <th>EMAIL</th>
                </tr>
            </thead>
            <tbody>
                ${previewData.map(row => `
                    <tr>
                        <td>${escapeHtml(row.NAME)}</td>
                        <td>${escapeHtml(row.EMAIL)}</td>
                    </tr>
                `).join('')}
                ${data.length > 10 ? `
                    <tr>
                        <td colspan="2" style="text-align: center; color: var(--text-muted); font-style: italic;">
                            ... and ${(data.length - 10).toLocaleString()} more records
                        </td>
                    </tr>
                ` : ''}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function downloadNormalizedList() {
    if (!normalizerProcessedData || normalizerProcessedData.length === 0) {
        showToast("No data to download", "error");
        return;
    }

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(normalizerProcessedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mailchimp List");

    // Generate filename with date
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const filename = `Mailchimp_List_${dateStr}.xlsx`;

    // Download
    XLSX.writeFile(wb, filename);
    showToast(`Downloaded ${filename}`, "success");

    // Save to export history
    saveNormalizerExport(filename, normalizerProcessedData.length);
    renderNormalizerHistory();
}

function saveNormalizerExport(filename, recordCount) {
    try {
        const history = JSON.parse(localStorage.getItem('normalizerHistory') || '[]');
        history.unshift({
            id: Date.now(),
            filename,
            sourceFile: normalizerFileName || 'Unknown',
            recordCount,
            date: new Date().toISOString()
        });
        // Keep last 20 exports
        if (history.length > 20) history.length = 20;
        localStorage.setItem('normalizerHistory', JSON.stringify(history));
    } catch (err) {
        console.warn('[List Normalizer] Failed to save history:', err.message);
    }
}

function getNormalizerHistory() {
    try {
        return JSON.parse(localStorage.getItem('normalizerHistory') || '[]');
    } catch {
        return [];
    }
}

function clearNormalizerHistory() {
    localStorage.removeItem('normalizerHistory');
    renderNormalizerHistory();
    showToast('Export history cleared', 'success');
}

function renderNormalizerHistory() {
    const container = document.getElementById('normalizerHistoryList');
    if (!container) return;

    const history = getNormalizerHistory();
    const section = document.getElementById('normalizerHistorySection');

    if (history.length === 0) {
        if (section) section.style.display = 'none';
        return;
    }

    if (section) section.style.display = 'block';

    container.innerHTML = history.map(entry => {
        const date = new Date(entry.date);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `
            <div class="normalizer-history-item">
                <div class="normalizer-history-icon">📄</div>
                <div class="normalizer-history-details">
                    <span class="normalizer-history-filename">${escapeHtml(entry.filename)}</span>
                    <span class="normalizer-history-meta">from ${escapeHtml(entry.sourceFile)} · ${entry.recordCount} records · ${dateStr} at ${timeStr}</span>
                </div>
            </div>
        `;
    }).join('');
}

function resetListNormalizer() {
    normalizerProcessedData = null;
    normalizerFileName = null;
    document.getElementById("normalizerUploadSection").style.display = "block";
    document.getElementById("normalizerProcessing").style.display = "none";
    document.getElementById("normalizerResults").style.display = "none";
    document.getElementById("normalizerFileInput").value = '';
}

// --- Raw Data Normalizer ---
function setupRawNormalizerListeners() {
    if (rawNormalizerListenersSetup) return;

    const dropzone = document.getElementById("rawNormalizerDropzone");
    const fileInput = document.getElementById("rawNormalizerFileInput");

    if (!dropzone || !fileInput) return;

    rawNormalizerListenersSetup = true;

    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        const file = e.dataTransfer.files[0];
        if (file) loadRawNormalizerFile(file);
    });

    fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) loadRawNormalizerFile(file);
    });

    document.getElementById("rawNormalizerDownloadBtn").addEventListener("click", downloadRawNormalized);
    document.getElementById("rawNormalizerResetBtn").addEventListener("click", resetRawNormalizer);
}

function loadRawNormalizerFile(file) {
    if (!file.name.match(/\.xlsx?$/i) && !file.name.match(/\.csv$/i)) {
        showToast("Please upload a spreadsheet file (.xlsx, .xls, or .csv)", "error");
        return;
    }

    if (file.size > NORMALIZER_MAX_FILE_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        showToast(`File is too large (${sizeMB} MB). Maximum size is 10 MB.`, "error");
        return;
    }

    rawNormalizerFileName = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            rawNormalizerRawData = XLSX.utils.sheet_to_json(sheet);

            if (rawNormalizerRawData.length === 0) {
                showToast("The file appears to be empty", "error");
                return;
            }

            // Show column preview
            showRawNormalizerColumnPreview(rawNormalizerRawData);
        } catch (error) {
            showToast("Error reading file: " + error.message, "error");
        }
    };
    reader.readAsArrayBuffer(file);
}

function showRawNormalizerColumnPreview(data) {
    const allColumns = new Set();
    data.forEach(row => Object.keys(row).forEach(key => allColumns.add(key)));
    const columns = Array.from(allColumns);

    const container = document.getElementById("rawNormalizerColumns");
    container.innerHTML = columns.map(col => {
        const sampleValues = data.slice(0, 3)
            .map(row => row[col])
            .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
            .map(v => escapeHtml(String(v).substring(0, 40)));
        return `
            <div class="raw-normalizer-col-tag">
                <span class="raw-normalizer-col-name">${escapeHtml(col)}</span>
                <span class="raw-normalizer-col-sample">${sampleValues.join(', ') || 'empty'}</span>
            </div>
        `;
    }).join('');

    document.getElementById("rawNormalizerColumnPreview").style.display = "block";

    // Hide dropzone, keep info cards visible
    document.getElementById("rawNormalizerDropzone").style.display = "none";
}

function addRawInstruction(text) {
    const textarea = document.getElementById("rawNormalizerInstructions");
    if (textarea.value && !textarea.value.endsWith('\n')) {
        textarea.value += '\n';
    }
    textarea.value += '• ' + text;
    textarea.focus();
}

async function processRawNormalizer() {
    const instructions = document.getElementById("rawNormalizerInstructions").value.trim();
    if (!instructions) {
        showToast("Please describe how you'd like the data transformed", "error");
        return;
    }

    if (!rawNormalizerRawData || rawNormalizerRawData.length === 0) {
        showToast("No data loaded", "error");
        return;
    }

    // Show processing
    document.getElementById("rawNormalizerUploadSection").style.display = "none";
    document.getElementById("rawNormalizerProcessing").style.display = "block";

    try {
        // Send a small sample (10 rows) so the AI can generate a transform function
        const sampleSize = Math.min(rawNormalizerRawData.length, 10);
        const dataSample = rawNormalizerRawData.slice(0, sampleSize);
        const totalRows = rawNormalizerRawData.length;
        const columns = Object.keys(rawNormalizerRawData[0]);

        const response = await fetch(`${API_BASE_URL}/api/normalize`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                data: JSON.stringify(dataSample, null, 2),
                instructions: `Columns: ${columns.join(', ')}
Total rows in file: ${totalRows} (sample of ${sampleSize} shown).

User instructions: ${instructions}`,
                outputFormat: 'transform'
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            console.error('[Raw Normalizer] API error:', response.status, err);
            throw new Error(err.error || `Server error (${response.status})`);
        }

        const result = await response.json();
        let aiText = (result.content && result.content[0] && result.content[0].text) || '';

        if (!aiText) {
            throw new Error('AI returned an empty response. Please try again.');
        }

        // Strip markdown code fences if AI included them
        aiText = aiText.replace(/^```(?:javascript|js)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        // Also strip any leading explanation text before actual code
        const firstStatement = aiText.search(/^(const |let |var |if |return |\/\/)/m);
        if (firstStatement > 0) {
            aiText = aiText.substring(firstStatement);
        }


        // Build the transform function from AI-generated code
        let transformFn;
        try {
            transformFn = new Function('row', aiText);
        } catch (syntaxErr) {
            console.error('[Raw Normalizer] Function syntax error:', syntaxErr.message, '\nCode:', aiText);
            throw new Error('AI generated code with a syntax error: ' + syntaxErr.message);
        }

        // Test on first row to validate
        const testRow = rawNormalizerRawData[0];
        try {
            const testResult = transformFn(testRow);
            if (testResult !== null && typeof testResult !== 'object') {
                throw new Error('Function returned ' + typeof testResult + ' instead of an object');
            }
        } catch (testErr) {
            console.error('[Raw Normalizer] Transform test failed:', testErr.message);
            console.error('[Raw Normalizer] Test row keys:', Object.keys(testRow).join(', '));
            throw new Error('Transform failed: ' + testErr.message + '. Check browser console for details.');
        }

        // Apply transform to ALL rows
        const processedRows = [];
        let errors = 0;
        for (let i = 0; i < rawNormalizerRawData.length; i++) {
            try {
                const result = transformFn(rawNormalizerRawData[i]);
                if (result !== null && result !== undefined) {
                    processedRows.push(result);
                }
            } catch {
                errors++;
            }
        }

        if (processedRows.length === 0) {
            throw new Error('Transform produced no results. All rows were filtered out or errored.');
        }

        if (errors > 0) {
            console.warn(`[Raw Normalizer] ${errors} rows had errors during transform`);
        }

        // Check for dedup instruction
        const wantDedup = /dedup|duplicate|unique/i.test(instructions);
        let finalRows = processedRows;
        if (wantDedup && processedRows.length > 0) {
            const outputCols = Object.keys(processedRows[0]);
            // Deduplicate by full row content
            const seen = new Set();
            finalRows = processedRows.filter(row => {
                const key = outputCols.map(c => String(row[c] || '').toLowerCase().trim()).join('|');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        rawNormalizerProcessedData = finalRows;
        const originalCount = rawNormalizerRawData.length;
        const cleanCount = finalRows.length;

        // Show results
        document.getElementById("rawNormalizerProcessing").style.display = "none";
        document.getElementById("rawNormalizerResults").style.display = "block";

        animateValue(document.getElementById("rawNormalizerOriginalCount"), 0, originalCount, 1000);
        animateValue(document.getElementById("rawNormalizerCleanCount"), 0, cleanCount, 1000);

        showRawNormalizerPreview(finalRows);

    } catch (error) {
        console.error('[Raw Normalizer] Error:', error);
        showToast("Something went wrong. Please try again.", "error");
        // Go back to the form (not full reset) so user can retry
        document.getElementById("rawNormalizerProcessing").style.display = "none";
        document.getElementById("rawNormalizerUploadSection").style.display = "block";
    }
}

function showRawNormalizerPreview(data) {
    const container = document.getElementById("rawNormalizerPreviewTable");
    if (!data || data.length === 0) { container.innerHTML = ''; return; }

    const columns = Object.keys(data[0]);
    const previewData = data.slice(0, 10);

    let html = `
        <table>
            <thead>
                <tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>
            </thead>
            <tbody>
                ${previewData.map(row => `
                    <tr>${columns.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('')}</tr>
                `).join('')}
                ${data.length > 10 ? `
                    <tr>
                        <td colspan="${columns.length}" style="text-align: center; color: var(--text-muted); font-style: italic;">
                            ... and ${(data.length - 10).toLocaleString()} more rows
                        </td>
                    </tr>
                ` : ''}
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function downloadRawNormalized() {
    if (!rawNormalizerProcessedData || rawNormalizerProcessedData.length === 0) {
        showToast("No data to download", "error");
        return;
    }

    const ws = XLSX.utils.json_to_sheet(rawNormalizerProcessedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Processed Data");

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `Processed_Data_${dateStr}.xlsx`;

    XLSX.writeFile(wb, filename);
    showToast(`Downloaded ${filename}`, "success");

    saveNormalizerExport(filename, rawNormalizerProcessedData.length);
    renderNormalizerHistory();
}

function resetRawNormalizer() {
    rawNormalizerRawData = null;
    rawNormalizerProcessedData = null;
    rawNormalizerFileName = null;
    document.getElementById("rawNormalizerUploadSection").style.display = "block";
    document.getElementById("rawNormalizerProcessing").style.display = "none";
    document.getElementById("rawNormalizerResults").style.display = "none";
    document.getElementById("rawNormalizerFileInput").value = '';
    document.getElementById("rawNormalizerColumnPreview").style.display = "none";
    document.getElementById("rawNormalizerDropzone").style.display = "flex";
    document.getElementById("rawNormalizerInstructions").value = '';
}

// ==================== DUPLICATE FINDER ====================
let dupFinderData = null;
let dupFinderDuplicateGroups = {};
let dupFinderSelectedCol = null;
let dupFinderKeepMode = 'first';
let dupFinderListenersSetup = false;

function setupDupFinderListeners() {
    if (dupFinderListenersSetup) return;
    dupFinderListenersSetup = true;

    const dropzone = document.getElementById("dupFinderDropzone");
    const fileInput = document.getElementById("dupFinderFileInput");
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
    dropzone.addEventListener("dragleave", () => { dropzone.classList.remove("dragover"); });
    dropzone.addEventListener("drop", (e) => {
        e.preventDefault(); dropzone.classList.remove("dragover");
        if (e.dataTransfer.files[0]) loadDupFinderFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", (e) => { if (e.target.files[0]) loadDupFinderFile(e.target.files[0]); });
}

function loadDupFinderFile(file) {
    if (!file.name.match(/\.xlsx?$/i) && !file.name.match(/\.csv$/i)) {
        showToast("Please upload a spreadsheet file (.xlsx, .xls, or .csv)", "error"); return;
    }
    if (file.size > NORMALIZER_MAX_FILE_SIZE) {
        showToast("File is too large. Maximum size is 10 MB.", "error"); return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            dupFinderData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            if (!dupFinderData.length) { showToast("File is empty", "error"); return; }
            showDupFinderColumnPicker();
        } catch (err) { showToast("Error reading file: " + err.message, "error"); }
    };
    reader.readAsArrayBuffer(file);
}

function showDupFinderColumnPicker() {
    const columns = Object.keys(dupFinderData[0]);
    const container = document.getElementById("dupFinderColumnPills");

    const emailCol = columns.find(c => /email/i.test(c));
    dupFinderSelectedCol = emailCol || null;

    container.innerHTML = columns.map(col => {
        const escaped = col.replace(/'/g, "\\'");
        return `<button class="dup-finder-col-pill ${col === dupFinderSelectedCol ? 'selected' : ''}"
                onclick="selectDupFinderCol(this, '${escaped}')">${escapeHtml(col)}</button>`;
    }).join('');

    document.getElementById("dupFinderUploadSection").style.display = "none";
    document.getElementById("dupFinderConfig").style.display = "block";
}

function selectDupFinderCol(btn, col) {
    document.querySelectorAll('#dupFinderColumnPills .dup-finder-col-pill').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    dupFinderSelectedCol = col;
}

function setDupKeepMode(mode) {
    dupFinderKeepMode = mode;
    document.querySelectorAll('.dup-finder-keep-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.keep === mode);
    });
}

function runDuplicateFinder() {
    if (!dupFinderSelectedCol) { showToast("Select a column to check for duplicates", "error"); return; }

    document.getElementById("dupFinderConfig").style.display = "none";
    document.getElementById("dupFinderProcessing").style.display = "block";

    setTimeout(() => {
        dupFinderDuplicateGroups = {};
        const col = dupFinderSelectedCol;

        dupFinderData.forEach((row, idx) => {
            const val = String(row[col] || '').trim().toLowerCase();
            if (!val) return;
            if (!dupFinderDuplicateGroups[val]) dupFinderDuplicateGroups[val] = [];
            dupFinderDuplicateGroups[val].push({ index: idx, row });
        });

        const dupeGroups = Object.entries(dupFinderDuplicateGroups).filter(([, arr]) => arr.length > 1);
        const totalDupes = dupeGroups.reduce((sum, [, arr]) => sum + (arr.length - 1), 0);
        const uniqueCount = dupFinderData.length - totalDupes;

        document.getElementById("dupFinderProcessing").style.display = "none";
        document.getElementById("dupFinderResults").style.display = "block";

        animateValue(document.getElementById("dupFinderTotalCount"), 0, dupFinderData.length, 1000);
        animateValue(document.getElementById("dupFinderUniqueCount"), 0, uniqueCount, 1000);
        animateValue(document.getElementById("dupFinderDupeCount"), 0, totalDupes, 1000);

        showDupFinderPreview(dupeGroups);
    }, 300);
}

function showDupFinderPreview(dupeGroups) {
    const container = document.getElementById("dupFinderPreviewTable");
    if (dupeGroups.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">No duplicates found! Your list is clean.</p>';
        return;
    }
    const columns = Object.keys(dupFinderData[0]);
    const previewGroups = dupeGroups.slice(0, 10);

    let html = '<table><thead><tr>' + columns.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr></thead><tbody>';
    previewGroups.forEach(([key, entries]) => {
        html += `<tr><td colspan="${columns.length}" style="background:var(--bg-input);font-weight:600;font-size:12px;color:var(--primary);">Duplicate group: "${escapeHtml(key)}" (${entries.length} entries)</td></tr>`;
        entries.forEach(({ row }) => {
            html += '<tr>' + columns.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('') + '</tr>';
        });
    });
    if (dupeGroups.length > 10) {
        html += `<tr><td colspan="${columns.length}" style="text-align:center;color:var(--text-muted);font-style:italic;">... and ${dupeGroups.length - 10} more duplicate groups</td></tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

function downloadDeduplicated() {
    if (!dupFinderData) return;
    const col = dupFinderSelectedCol;
    const seen = new Set();
    let result;

    if (dupFinderKeepMode === 'first') {
        result = dupFinderData.filter(row => {
            const val = String(row[col] || '').trim().toLowerCase();
            if (!val || seen.has(val)) return false;
            seen.add(val); return true;
        });
    } else {
        const reversed = [...dupFinderData].reverse();
        result = reversed.filter(row => {
            const val = String(row[col] || '').trim().toLowerCase();
            if (!val || seen.has(val)) return false;
            seen.add(val); return true;
        }).reverse();
    }

    const ws = XLSX.utils.json_to_sheet(result);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Deduplicated");
    const filename = `Deduplicated_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast(`Downloaded ${filename} (${result.length} records)`, "success");
}

function resetDuplicateFinder() {
    dupFinderData = null;
    dupFinderDuplicateGroups = {};
    dupFinderSelectedCol = null;
    document.getElementById("dupFinderUploadSection").style.display = "block";
    document.getElementById("dupFinderConfig").style.display = "none";
    document.getElementById("dupFinderProcessing").style.display = "none";
    document.getElementById("dupFinderResults").style.display = "none";
    document.getElementById("dupFinderFileInput").value = '';
}

// ==================== LIST COMPARATOR ====================
let compareDataA = null, compareDataB = null;
let compareSelectedCol = null;
let compareResultData = { onlyA: [], both: [], onlyB: [] };
let compareActiveTab = 'onlyA';
let compareListenersSetup = false;

function setupCompareListeners() {
    if (compareListenersSetup) return;
    compareListenersSetup = true;

    ['A', 'B'].forEach(side => {
        const dropzone = document.getElementById(`compareDropzone${side}`);
        const fileInput = document.getElementById(`compareFileInput${side}`);
        if (!dropzone || !fileInput) return;

        dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
        dropzone.addEventListener("dragleave", () => { dropzone.classList.remove("dragover"); });
        dropzone.addEventListener("drop", (e) => {
            e.preventDefault(); dropzone.classList.remove("dragover");
            if (e.dataTransfer.files[0]) loadCompareFile(side, e.dataTransfer.files[0]);
        });
        fileInput.addEventListener("change", (e) => { if (e.target.files[0]) loadCompareFile(side, e.target.files[0]); });
    });
}

function loadCompareFile(side, file) {
    if (!file.name.match(/\.xlsx?$/i) && !file.name.match(/\.csv$/i)) {
        showToast("Please upload a spreadsheet file (.xlsx, .xls, or .csv)", "error"); return;
    }
    if (file.size > NORMALIZER_MAX_FILE_SIZE) {
        showToast("File is too large. Maximum size is 10 MB.", "error"); return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const parsed = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            if (!parsed.length) { showToast("File is empty", "error"); return; }

            if (side === 'A') { compareDataA = parsed; }
            else { compareDataB = parsed; }

            document.getElementById(`compareDropzone${side}`).style.display = 'none';
            const loaded = document.getElementById(`compareFileLoaded${side}`);
            loaded.style.display = 'flex';
            document.getElementById(`compareFileName${side}`).textContent = file.name;
            document.getElementById(`compareFileRows${side}`).textContent = `${parsed.length} rows`;

            if (compareDataA && compareDataB) showCompareColumnPicker();
        } catch (err) { showToast("Error reading file: " + err.message, "error"); }
    };
    reader.readAsArrayBuffer(file);
}

function showCompareColumnPicker() {
    const colsA = new Set(Object.keys(compareDataA[0]));
    const colsB = new Set(Object.keys(compareDataB[0]));
    const common = [...colsA].filter(c => colsB.has(c));

    if (common.length === 0) {
        showToast("No matching column names found between the two files", "error");
        return;
    }

    const emailCol = common.find(c => /email/i.test(c));
    compareSelectedCol = emailCol || null;

    const container = document.getElementById("compareColumnPills");
    container.innerHTML = common.map(col => {
        const escaped = col.replace(/'/g, "\\'");
        return `<button class="dup-finder-col-pill ${col === compareSelectedCol ? 'selected' : ''}"
                onclick="selectCompareCol(this, '${escaped}')">${escapeHtml(col)}</button>`;
    }).join('');

    document.getElementById("compareColumnConfig").style.display = "block";
}

function selectCompareCol(btn, col) {
    document.querySelectorAll('#compareColumnPills .dup-finder-col-pill').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    compareSelectedCol = col;
}

function runListComparator() {
    if (!compareSelectedCol) { showToast("Select a column to compare by", "error"); return; }

    document.getElementById("compareUploadSection").style.display = "none";
    document.getElementById("compareProcessing").style.display = "block";

    setTimeout(() => {
        const col = compareSelectedCol;
        const setA = new Map();
        const setB = new Map();

        compareDataA.forEach(row => {
            const val = String(row[col] || '').trim().toLowerCase();
            if (val && !setA.has(val)) setA.set(val, row);
        });
        compareDataB.forEach(row => {
            const val = String(row[col] || '').trim().toLowerCase();
            if (val && !setB.has(val)) setB.set(val, row);
        });

        compareResultData = { onlyA: [], both: [], onlyB: [] };
        setA.forEach((row, val) => {
            if (setB.has(val)) compareResultData.both.push(row);
            else compareResultData.onlyA.push(row);
        });
        setB.forEach((row, val) => {
            if (!setA.has(val)) compareResultData.onlyB.push(row);
        });

        document.getElementById("compareProcessing").style.display = "none";
        document.getElementById("compareResults").style.display = "block";

        animateValue(document.getElementById("compareOnlyACount"), 0, compareResultData.onlyA.length, 1000);
        animateValue(document.getElementById("compareBothCount"), 0, compareResultData.both.length, 1000);
        animateValue(document.getElementById("compareOnlyBCount"), 0, compareResultData.onlyB.length, 1000);

        compareActiveTab = 'onlyA';
        showComparePreview();
    }, 300);
}

function switchCompareTab(tab) {
    compareActiveTab = tab;
    document.querySelectorAll('.compare-results-tabs .compare-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    showComparePreview();
}

function showComparePreview() {
    const data = compareResultData[compareActiveTab];
    const container = document.getElementById("comparePreviewTable");
    if (!data || data.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">No records in this category.</p>';
        return;
    }
    const columns = Object.keys(data[0]);
    const preview = data.slice(0, 20);
    let html = '<table><thead><tr>' + columns.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr></thead><tbody>';
    preview.forEach(row => {
        html += '<tr>' + columns.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('') + '</tr>';
    });
    if (data.length > 20) {
        html += `<tr><td colspan="${columns.length}" style="text-align:center;color:var(--text-muted);font-style:italic;">... and ${(data.length - 20).toLocaleString()} more rows</td></tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

function downloadCompareResult(tab) {
    const data = compareResultData[tab];
    if (!data || data.length === 0) { showToast("No records to download", "error"); return; }
    const labels = { onlyA: 'Only_in_A', both: 'In_Both', onlyB: 'Only_in_B' };
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, labels[tab]);
    const filename = `${labels[tab]}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast(`Downloaded ${filename} (${data.length} records)`, "success");
}

function resetListComparator() {
    compareDataA = null; compareDataB = null;
    compareSelectedCol = null;
    compareResultData = { onlyA: [], both: [], onlyB: [] };
    document.getElementById("compareUploadSection").style.display = "block";
    document.getElementById("compareColumnConfig").style.display = "none";
    document.getElementById("compareProcessing").style.display = "none";
    document.getElementById("compareResults").style.display = "none";
    ['A', 'B'].forEach(side => {
        document.getElementById(`compareDropzone${side}`).style.display = 'flex';
        document.getElementById(`compareFileLoaded${side}`).style.display = 'none';
        document.getElementById(`compareFileInput${side}`).value = '';
    });
}

// ==================== EMAIL CLEANER ====================
let emailCleanerData = null;
let emailCleanerSelectedCol = null;
let emailCleanerResults = { valid: [], fixed: [], invalid: [], role: [] };
let emailCleanerActiveTab = 'valid';
let emailCleanerListenersSetup = false;

const EMAIL_DOMAIN_TYPOS = {
    'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmai.com': 'gmail.com',
    'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmil.com': 'gmail.com',
    'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.con': 'gmail.com',
    'gmail.om': 'gmail.com', 'gmail.cmo': 'gmail.com', 'gmaill.com': 'gmail.com',
    'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com',
    'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotamil.com': 'hotmail.com',
    'outloo.com': 'outlook.com', 'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com',
    'outlook.con': 'outlook.com', 'outllok.com': 'outlook.com',
    'yahooo.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
    'yahoo.con': 'yahoo.com', 'yaoo.com': 'yahoo.com', 'yhoo.com': 'yahoo.com',
    'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com', 'icoud.com': 'icloud.com',
    'live.co': 'live.com', 'live.con': 'live.com'
};

const ROLE_BASED_PREFIXES = [
    'info', 'admin', 'support', 'sales', 'contact', 'help', 'office',
    'noreply', 'no-reply', 'postmaster', 'webmaster', 'abuse', 'marketing',
    'billing', 'enquiries', 'hello', 'team', 'general', 'reception'
];

function setupEmailCleanerListeners() {
    if (emailCleanerListenersSetup) return;
    emailCleanerListenersSetup = true;

    const dropzone = document.getElementById("emailCleanerDropzone");
    const fileInput = document.getElementById("emailCleanerFileInput");
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
    dropzone.addEventListener("dragleave", () => { dropzone.classList.remove("dragover"); });
    dropzone.addEventListener("drop", (e) => {
        e.preventDefault(); dropzone.classList.remove("dragover");
        if (e.dataTransfer.files[0]) loadEmailCleanerFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", (e) => { if (e.target.files[0]) loadEmailCleanerFile(e.target.files[0]); });
}

function loadEmailCleanerFile(file) {
    if (!file.name.match(/\.xlsx?$/i) && !file.name.match(/\.csv$/i)) {
        showToast("Please upload a spreadsheet file (.xlsx, .xls, or .csv)", "error"); return;
    }
    if (file.size > NORMALIZER_MAX_FILE_SIZE) {
        showToast("File is too large. Maximum size is 10 MB.", "error"); return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            emailCleanerData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            if (!emailCleanerData.length) { showToast("File is empty", "error"); return; }
            showEmailCleanerColumnPicker();
        } catch (err) { showToast("Error reading file: " + err.message, "error"); }
    };
    reader.readAsArrayBuffer(file);
}

function showEmailCleanerColumnPicker() {
    const columns = Object.keys(emailCleanerData[0]);
    const emailCol = columns.find(c => /email/i.test(c));
    emailCleanerSelectedCol = emailCol || null;

    const container = document.getElementById("emailCleanerColumnPills");
    container.innerHTML = columns.map(col => {
        const escaped = col.replace(/'/g, "\\'");
        return `<button class="dup-finder-col-pill ${col === emailCleanerSelectedCol ? 'selected' : ''}"
                onclick="selectEmailCleanerCol(this, '${escaped}')">${escapeHtml(col)}</button>`;
    }).join('');

    document.getElementById("emailCleanerUploadSection").style.display = "none";
    document.getElementById("emailCleanerConfig").style.display = "block";
}

function selectEmailCleanerCol(btn, col) {
    document.querySelectorAll('#emailCleanerColumnPills .dup-finder-col-pill').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    emailCleanerSelectedCol = col;
}

function isValidEmailFormat(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function fixEmailTypo(email) {
    const lower = email.toLowerCase().trim();
    const atIdx = lower.indexOf('@');
    if (atIdx === -1) return { fixed: false, email: lower };

    const local = lower.substring(0, atIdx);
    let domain = lower.substring(atIdx + 1);

    if (EMAIL_DOMAIN_TYPOS[domain]) {
        return { fixed: true, email: local + '@' + EMAIL_DOMAIN_TYPOS[domain], original: lower };
    }

    // Check suffix typos (.con → .com)
    for (const [typo, correction] of Object.entries(EMAIL_DOMAIN_TYPOS)) {
        if (typo.startsWith('.') && domain.endsWith(typo)) {
            const corrected = domain.slice(0, -typo.length) + correction;
            return { fixed: true, email: local + '@' + corrected, original: lower };
        }
    }

    return { fixed: false, email: lower };
}

function isRoleBasedEmail(email) {
    const local = email.split('@')[0];
    return ROLE_BASED_PREFIXES.some(prefix => local === prefix);
}

function runEmailCleaner() {
    if (!emailCleanerSelectedCol) { showToast("Select the email column", "error"); return; }

    document.getElementById("emailCleanerConfig").style.display = "none";
    document.getElementById("emailCleanerProcessing").style.display = "block";

    setTimeout(() => {
        emailCleanerResults = { valid: [], fixed: [], invalid: [], role: [] };
        const col = emailCleanerSelectedCol;
        const seen = new Set();

        emailCleanerData.forEach(row => {
            const rawEmail = String(row[col] || '').trim();
            if (!rawEmail) {
                emailCleanerResults.invalid.push({ ...row, _reason: 'Empty email' });
                return;
            }

            const { fixed, email, original } = fixEmailTypo(rawEmail);

            if (seen.has(email)) return; // dedup
            seen.add(email);

            if (!isValidEmailFormat(email)) {
                emailCleanerResults.invalid.push({ ...row, [col]: rawEmail, _reason: 'Invalid format' });
            } else if (fixed) {
                emailCleanerResults.fixed.push({ ...row, [col]: email, _originalEmail: original });
                if (isRoleBasedEmail(email)) emailCleanerResults.role.push({ ...row, [col]: email });
            } else if (isRoleBasedEmail(email)) {
                emailCleanerResults.role.push({ ...row, [col]: email });
                emailCleanerResults.valid.push({ ...row, [col]: email });
            } else {
                emailCleanerResults.valid.push({ ...row, [col]: email });
            }
        });

        document.getElementById("emailCleanerProcessing").style.display = "none";
        document.getElementById("emailCleanerResults").style.display = "block";

        animateValue(document.getElementById("emailCleanerTotalCount"), 0, emailCleanerData.length, 1000);
        animateValue(document.getElementById("emailCleanerValidCount"), 0, emailCleanerResults.valid.length, 1000);
        animateValue(document.getElementById("emailCleanerFixedCount"), 0, emailCleanerResults.fixed.length, 1000);
        animateValue(document.getElementById("emailCleanerInvalidCount"), 0, emailCleanerResults.invalid.length, 1000);

        emailCleanerActiveTab = 'valid';
        showEmailCleanerPreview();
    }, 300);
}

function switchEmailCleanerTab(tab) {
    emailCleanerActiveTab = tab;
    document.querySelectorAll('.email-cleaner-tabs .compare-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    showEmailCleanerPreview();
}

function showEmailCleanerPreview() {
    const data = emailCleanerResults[emailCleanerActiveTab];
    const container = document.getElementById("emailCleanerPreviewTable");

    if (!data || data.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">No records in this category.</p>';
        return;
    }

    const allKeys = Object.keys(data[0]).filter(k => !k.startsWith('_'));
    const extraCols = [];
    if (emailCleanerActiveTab === 'fixed') extraCols.push('_originalEmail');
    if (emailCleanerActiveTab === 'invalid') extraCols.push('_reason');

    const displayCols = [...allKeys, ...extraCols];
    const headers = displayCols.map(c => c === '_originalEmail' ? 'Original Email' : c === '_reason' ? 'Reason' : c);

    const preview = data.slice(0, 20);
    let html = '<table><thead><tr>' + headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>';
    preview.forEach(row => {
        html += '<tr>' + displayCols.map(c => `<td>${escapeHtml(String(row[c] ?? ''))}</td>`).join('') + '</tr>';
    });
    if (data.length > 20) {
        html += `<tr><td colspan="${displayCols.length}" style="text-align:center;color:var(--text-muted);font-style:italic;">... and ${(data.length - 20).toLocaleString()} more rows</td></tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

function downloadCleanedEmails() {
    const cleanData = [...emailCleanerResults.valid, ...emailCleanerResults.fixed];
    const exportData = cleanData.map(row => {
        const clean = {};
        Object.keys(row).forEach(k => { if (!k.startsWith('_')) clean[k] = row[k]; });
        return clean;
    });
    if (exportData.length === 0) { showToast("No clean emails to download", "error"); return; }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clean Emails");
    const filename = `Clean_Emails_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast(`Downloaded ${filename} (${exportData.length} records)`, "success");
}

function downloadEmailCleanerReport() {
    const wb = XLSX.utils.book_new();
    const addSheet = (name, data) => {
        const clean = data.map(row => {
            const obj = {};
            Object.keys(row).forEach(k => {
                const label = k === '_originalEmail' ? 'Original Email' : k === '_reason' ? 'Reason' : k;
                obj[label] = row[k];
            });
            return obj;
        });
        if (clean.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clean), name);
    };
    addSheet('Valid', emailCleanerResults.valid);
    addSheet('Typos Fixed', emailCleanerResults.fixed);
    addSheet('Invalid', emailCleanerResults.invalid);
    addSheet('Role-Based', emailCleanerResults.role);

    const filename = `Email_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast(`Downloaded ${filename}`, "success");
}

function resetEmailCleaner() {
    emailCleanerData = null;
    emailCleanerSelectedCol = null;
    emailCleanerResults = { valid: [], fixed: [], invalid: [], role: [] };
    document.getElementById("emailCleanerUploadSection").style.display = "block";
    document.getElementById("emailCleanerConfig").style.display = "none";
    document.getElementById("emailCleanerProcessing").style.display = "none";
    document.getElementById("emailCleanerResults").style.display = "none";
    document.getElementById("emailCleanerFileInput").value = '';
}

// ==================== PARALLAX & SCROLL ANIMATIONS ====================

function initParallaxAndAnimations() {
    const landingPage = document.getElementById('landingPage');

    // Navbar scroll effect - add border on scroll
    const landingNav = document.getElementById('landingNav');
    if (landingPage && landingNav) {
        landingPage.addEventListener('scroll', () => {
            if (landingPage.scrollTop > 10) {
                landingNav.classList.add('scrolled');
            } else {
                landingNav.classList.remove('scrolled');
            }
        });
    }

    // Sign-in buttons - navigate to login
    const signInBtns = [
        document.getElementById('navSignInBtn'),
        document.getElementById('navSignInBtn2')
    ];
    signInBtns.forEach(btn => {
        if (btn) {
            btn.addEventListener('click', () => {
                document.getElementById('landingPage').classList.add('hidden');
                showLoginPage();
            });
        }
    });

    // Scroll-triggered fade-in animations
    const animatedElements = document.querySelectorAll('.animate-on-scroll');

    if (animatedElements.length > 0 && landingPage) {
        const observerOptions = {
            root: landingPage,
            rootMargin: '0px 0px -80px 0px',
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animated');
                }
            });
        }, observerOptions);

        animatedElements.forEach(el => observer.observe(el));
    }

    // Tool tabs switching
    const toolTabs = document.querySelectorAll('.tool-tab');
    const toolPanels = document.querySelectorAll('.tool-panel');

    if (toolTabs.length > 0) {
        toolTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tool;
                toolTabs.forEach(t => t.classList.remove('active'));
                toolPanels.forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const panel = document.querySelector(`.tool-panel[data-tool="${target}"]`);
                if (panel) panel.classList.add('active');
            });
        });
    }
}

function animateCounters() {
    document.querySelectorAll('.landing-stat-value[data-count]').forEach(el => {
        const target = parseFloat(el.dataset.count);
        const suffix = el.dataset.suffix || '';
        const decimals = parseInt(el.dataset.decimals) || 0;
        const useComma = el.dataset.format === 'comma';
        const duration = 2000;
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic for a satisfying deceleration
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = eased * target;

            let display;
            if (decimals > 0) {
                display = current.toFixed(decimals);
            } else {
                display = Math.floor(current).toString();
            }

            if (useComma) {
                display = parseInt(display).toLocaleString();
            }

            el.textContent = display + suffix;

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    });
}

function revealDemoPanel(panel) {
    if (!panel) return;

    // Find badges and output sections within this panel
    const badges = panel.querySelectorAll('.demo-response-badge');
    const outputEls = panel.querySelectorAll('.demo-draft-output, .demo-response-output, .demo-insights-container, .demo-normalizer-clean');

    // Hide badges initially, reveal after delay
    badges.forEach(badge => {
        badge.classList.remove('visible');
        setTimeout(() => {
            badge.classList.add('visible');
        }, 800);
    });

    // Progressive reveal of output content
    outputEls.forEach((el, i) => {
        el.classList.add('demo-typing-reveal');
        el.classList.remove('revealed');
        setTimeout(() => {
            el.classList.add('revealed');
        }, 400 + (i * 200));
    });
}

// ==================== RULES OF PLAY GENERATOR ====================
const ROP_TYPE_LABELS = {
    '5050': '50/50 Lottery',
    'catch_the_ace': 'Catch the Ace',
    'prize_raffle': 'Prize Raffle',
    'house_lottery': 'House Lottery'
};

const ROP_TYPE_COLORS = {
    '5050': '#10b981',
    'catch_the_ace': '#8b5cf6',
    'prize_raffle': '#f59e0b',
    'house_lottery': '#3b82f6'
};

let ropState = {
    drafts: [],
    jurisdictions: [],
    currentDraftId: null,
    currentDraft: null,
    selectedType: null,
    selectedJurisdictionId: null,
    initialized: false,
    saveTimeout: null
};

function initRulesOfPlay() {
    if (!ropState.initialized) {
        setupRopEventListeners();
        ropState.initialized = true;
    }
    ropShowList();
}

function setupRopEventListeners() {
    document.getElementById('ropNewBtn').addEventListener('click', ropShowSelector);
    document.getElementById('ropBackToList').addEventListener('click', ropShowList);
    document.getElementById('ropBackToSelector').addEventListener('click', () => {
        if (ropState.currentDraftId) {
            ropShowSelector();
        } else {
            ropShowSelector();
        }
    });
    document.getElementById('ropBackToForm').addEventListener('click', () => ropShowForm(ropState.currentDraftId));
    document.getElementById('ropProceedBtn').addEventListener('click', ropProceedToForm);
    document.getElementById('ropSaveDraftBtn').addEventListener('click', ropSaveDraft);
    document.getElementById('ropGenerateBtn').addEventListener('click', ropGenerate);
    document.getElementById('ropRegenerateBtn').addEventListener('click', ropGenerate);
    document.getElementById('ropCopyBtn').addEventListener('click', ropCopyOutput);
    document.getElementById('ropExportBtn').addEventListener('click', ropExport);
    document.getElementById('ropSaveOutputBtn').addEventListener('click', ropSaveOutput);
    document.getElementById('ropNotifyBtn').addEventListener('click', ropNotifyMe);

    // Type card selection
    document.getElementById('ropTypeCards').addEventListener('click', (e) => {
        const card = e.target.closest('.rop-type-card');
        if (!card) return;
        document.querySelectorAll('.rop-type-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        ropState.selectedType = card.dataset.type;
        ropUpdateProceedBtn();
    });

    // Country change -> load provinces/states
    document.getElementById('ropCountry').addEventListener('change', ropLoadProvinces);
    document.getElementById('ropProvState').addEventListener('change', ropOnJurisdictionChange);
}

// --- Views ---

function ropSwitchView(viewId) {
    document.querySelectorAll('#rulesOfPlayApp .rop-view').forEach(v => v.style.display = 'none');
    document.getElementById(viewId).style.display = '';
}

async function ropShowList() {
    ropSwitchView('ropListView');
    try {
        const resp = await fetch(`${API_BASE_URL}/api/rules-of-play`, { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed to load drafts');
        const data = await resp.json();
        ropState.drafts = data.drafts || [];
        ropRenderDraftsList();
    } catch (err) {
        console.error('ROP list error:', err);
    }
}

function ropRenderDraftsList() {
    const container = document.getElementById('ropDraftsList');
    if (ropState.drafts.length === 0) {
        container.innerHTML = `
            <div class="rop-empty-state">
                <span style="font-size: 48px;">&#9878;</span>
                <h3>No drafts yet</h3>
                <p>Create your first Rules of Play document to get started.</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        <table class="rop-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Jurisdiction</th>
                    <th>Status</th>
                    <th>Last Updated</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${ropState.drafts.map(d => `
                    <tr class="rop-draft-row" data-id="${d.id}">
                        <td class="rop-draft-name">${escapeHtml(d.name)}</td>
                        <td><span class="rop-type-badge" style="--type-color: ${ROP_TYPE_COLORS[d.raffle_type] || '#888'}">${ROP_TYPE_LABELS[d.raffle_type] || d.raffle_type}</span></td>
                        <td>${d.province_state_name || '—'}</td>
                        <td><span class="rop-status-badge rop-status-${d.status}">${d.status}</span></td>
                        <td>${new Date(d.updated_at).toLocaleDateString()}</td>
                        <td><button class="rop-delete-btn" data-id="${d.id}" title="Delete">&#128465;</button></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;

    // Row click -> open form
    container.querySelectorAll('.rop-draft-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.rop-delete-btn')) return;
            ropShowForm(row.dataset.id);
        });
    });

    // Delete buttons
    container.querySelectorAll('.rop-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Delete this draft?')) return;
            try {
                await fetch(`${API_BASE_URL}/api/rules-of-play/${btn.dataset.id}`, {
                    method: 'DELETE', headers: getAuthHeaders()
                });
                ropShowList();
            } catch (err) {
                showToast('Failed to delete draft', 'error');
            }
        });
    });
}

function ropShowSelector() {
    ropState.currentDraftId = null;
    ropState.selectedType = null;
    ropState.selectedJurisdictionId = null;
    document.getElementById('ropDraftName').value = '';
    document.querySelectorAll('.rop-type-card').forEach(c => c.classList.remove('selected'));
    document.getElementById('ropCountry').value = '';
    document.getElementById('ropProvState').innerHTML = '<option value="">Select Province/State</option>';
    document.getElementById('ropProvState').disabled = true;
    document.getElementById('ropComingSoon').style.display = 'none';
    document.getElementById('ropProceedBtn').disabled = true;
    ropSwitchView('ropSelectorView');
}

async function ropLoadProvinces() {
    const country = document.getElementById('ropCountry').value;
    const select = document.getElementById('ropProvState');
    select.innerHTML = '<option value="">Select Province/State</option>';
    document.getElementById('ropComingSoon').style.display = 'none';

    if (!country) {
        select.disabled = true;
        ropUpdateProceedBtn();
        return;
    }

    try {
        if (ropState.jurisdictions.length === 0) {
            const resp = await fetch(`${API_BASE_URL}/api/jurisdictions`, { headers: getAuthHeaders() });
            const data = await resp.json();
            ropState.jurisdictions = data.jurisdictions || [];
        }

        const filtered = ropState.jurisdictions.filter(j => j.country === country);
        filtered.forEach(j => {
            const opt = document.createElement('option');
            opt.value = j.id;
            opt.textContent = j.province_state_name + (j.is_active ? '' : ' (Coming Soon)');
            opt.dataset.active = j.is_active;
            select.appendChild(opt);
        });
        select.disabled = false;
    } catch (err) {
        console.error('Load jurisdictions error:', err);
        select.disabled = true;
    }
    ropUpdateProceedBtn();
}

function ropOnJurisdictionChange() {
    const select = document.getElementById('ropProvState');
    const selectedOpt = select.options[select.selectedIndex];
    const comingSoon = document.getElementById('ropComingSoon');

    if (!selectedOpt || !selectedOpt.value) {
        comingSoon.style.display = 'none';
        ropState.selectedJurisdictionId = null;
        ropUpdateProceedBtn();
        return;
    }

    const isActive = selectedOpt.dataset.active === 'true';
    if (isActive) {
        comingSoon.style.display = 'none';
        ropState.selectedJurisdictionId = selectedOpt.value;
    } else {
        const jur = ropState.jurisdictions.find(j => j.id === selectedOpt.value);
        document.getElementById('ropComingSoonName').textContent = jur ? jur.province_state_name : selectedOpt.textContent;
        comingSoon.style.display = 'block';
        document.getElementById('ropNotifyConfirm').style.display = 'none';
        ropState.selectedJurisdictionId = null;
    }
    ropUpdateProceedBtn();
}

function ropUpdateProceedBtn() {
    const nameVal = document.getElementById('ropDraftName').value.trim();
    document.getElementById('ropProceedBtn').disabled = !(ropState.selectedType && ropState.selectedJurisdictionId && nameVal);
}

// Listen for name changes too
document.addEventListener('DOMContentLoaded', () => {
    const nameInput = document.getElementById('ropDraftName');
    if (nameInput) nameInput.addEventListener('input', ropUpdateProceedBtn);
});

async function ropNotifyMe() {
    const select = document.getElementById('ropProvState');
    const jId = select.value;
    if (!jId) return;
    try {
        await fetch(`${API_BASE_URL}/api/jurisdictions/waitlist`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ jurisdiction_id: jId })
        });
        document.getElementById('ropNotifyConfirm').style.display = 'inline';
        document.getElementById('ropNotifyBtn').disabled = true;
    } catch (err) {
        showToast('Failed to register interest', 'error');
    }
}

async function ropProceedToForm() {
    const name = document.getElementById('ropDraftName').value.trim();
    if (!name || !ropState.selectedType || !ropState.selectedJurisdictionId) return;

    try {
        const resp = await fetch(`${API_BASE_URL}/api/rules-of-play`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                name,
                raffle_type: ropState.selectedType,
                jurisdiction_id: ropState.selectedJurisdictionId,
                form_data: {}
            })
        });
        if (!resp.ok) throw new Error('Failed to create draft');
        const draft = await resp.json();
        ropShowForm(draft.id);
    } catch (err) {
        showToast('Failed to create draft', 'error');
    }
}

// --- Form ---

async function ropShowForm(draftId) {
    ropSwitchView('ropFormView');
    ropState.currentDraftId = draftId;

    try {
        const resp = await fetch(`${API_BASE_URL}/api/rules-of-play/${draftId}`, { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed to load draft');
        ropState.currentDraft = await resp.json();

        document.getElementById('ropFormTitle').textContent = ropState.currentDraft.name;
        const badge = document.getElementById('ropFormBadge');
        badge.textContent = ROP_TYPE_LABELS[ropState.currentDraft.raffle_type] || '';
        badge.style.setProperty('--type-color', ROP_TYPE_COLORS[ropState.currentDraft.raffle_type] || '#888');

        ropRenderForm();
    } catch (err) {
        showToast('Failed to load draft', 'error');
        ropShowList();
    }
}

function ropRenderForm() {
    const d = ropState.currentDraft;
    const fd = d.form_data || {};
    const type = d.raffle_type;
    const body = document.getElementById('ropFormBody');

    const sections = [];

    // Section 1: Organization & License
    sections.push(ropSection('Organization & License Info', `
        ${ropField('organization_legal_name', 'Organization Legal Name', fd.organization_legal_name, 'text', 'e.g., Thunder Bay Regional Health Sciences Foundation')}
        ${ropField('raffle_brand_name', 'Lottery/Raffle Brand Name', fd.raffle_brand_name, 'text', 'e.g., Cruising For a Cure')}
        ${ropField('license_number', 'License Number', fd.license_number, 'text', 'e.g., RAF-12345')}
        ${type === '5050' ? ropField('draw_range', 'Draw Numbers Covered', fd.draw_range, 'text', 'e.g., Draws #1-12') : ''}
        ${ropField('regulatory_body', 'Licensing/Regulatory Body', fd.regulatory_body || d.regulatory_body_name || '', 'text', '', true)}
    `));

    // Section 2: Eligibility
    sections.push(ropSection('Eligibility', `
        ${ropField('minimum_age', 'Minimum Age to Play', fd.minimum_age || d.minimum_age || 18, 'number')}
        ${ropField('geographic_restriction', 'Geographic Restriction', fd.geographic_restriction || d.geographic_restriction_text || '', 'textarea', '', true)}
        <div class="rop-subsection">
            <label class="rop-field-label">Ineligible Persons</label>
            <div id="ropIneligibleGroups">${ropRenderRepeatableGroups('ineligible_groups', fd.ineligible_groups || [{ group_name: '', description: '', consequence: 'disqualification, purchased tickets will be considered void' }], ['group_name:Group Name:e.g. Foundation Staff and Board of Directors', 'description:Description:e.g. as well as family members living in the same household', 'consequence:Consequence:e.g. disqualification'])}</div>
            <button class="rop-add-btn" data-group="ineligible_groups">+ Add Group</button>
        </div>
        <div class="rop-toggle-row">
            <label><input type="checkbox" class="rop-field" data-field="include_volunteer_exception" ${fd.include_volunteer_exception ? 'checked' : ''}> Include volunteer exception? (Volunteers ARE eligible to participate)</label>
        </div>
    `));

    // Section 3: Ticket Sales
    let ticketSalesExtra = '';
    if (type === 'prize_raffle' || type === 'house_lottery') {
        ticketSalesExtra += ropField('max_tickets', 'Maximum Tickets Available', fd.max_tickets, 'number', 'e.g., 20000');
    }
    if (type === 'house_lottery') {
        ticketSalesExtra += ropField('multipack_description', 'Multi-Pack Pricing', fd.multipack_description, 'text', 'e.g., 3-Pack for $250');
        ticketSalesExtra += `<div class="rop-toggle-row"><label><input type="checkbox" class="rop-field" data-field="group_purchase_rules" ${fd.group_purchase_rules ? 'checked' : ''}> Include group purchase rules</label></div>`;
        ticketSalesExtra += ropField('payment_methods', 'Accepted Payment Methods', fd.payment_methods, 'text', 'e.g., Visa, Mastercard, Amex, Debit');
    }
    if (type === 'catch_the_ace') {
        ticketSalesExtra += `<div class="rop-prefilled"><strong>Envelope Selection:</strong> Each ticket purchase entitles the purchaser to select ONE virtual envelope, regardless of how many tickets are purchased.</div>`;
    }

    sections.push(ropSection('Ticket Sales', `
        ${ropField('electronic_system_provider', 'Electronic Raffle System Provider', fd.electronic_system_provider, 'text', 'e.g., BUMP, a Division of Canada Banknote Company')}
        ${ropField('online_sales_url', 'Online Sales URL', fd.online_sales_url, 'text', 'e.g., https://example.bumpraffles.com')}
        <div class="rop-subsection">
            <label class="rop-field-label">Physical Sales Locations</label>
            <div id="ropSalesLocations">${ropRenderRepeatableGroups('sales_locations', fd.sales_locations || [], ['location_name:Location Name:e.g. Main Office', 'address:Address:e.g. 123 Main St, Thunder Bay, ON'])}</div>
            <button class="rop-add-btn" data-group="sales_locations">+ Add Location</button>
        </div>
        <div class="rop-subsection">
            <label class="rop-field-label">Ticket Pricing Tiers</label>
            <div id="ropPricingTiers">${ropRenderRepeatableGroups('pricing_tiers', fd.pricing_tiers || [{ quantity: '', price: '', label: type === '5050' ? 'numbers' : 'tickets' }], ['quantity:Quantity:e.g. 5', 'price:Price ($):e.g. 10', 'label:Label:e.g. tickets'])}</div>
            <button class="rop-add-btn" data-group="pricing_tiers">+ Add Tier</button>
        </div>
        ${ticketSalesExtra}
        ${ropField('ticket_delivery_method', 'Ticket Delivery Method', fd.ticket_delivery_method, 'text', 'e.g., Email receipt with registered numbers')}
    `));

    // Section 4: Draw Schedule (varies by type)
    let drawScheduleContent = '';
    if (type === '5050') {
        drawScheduleContent = `
            <div class="rop-subsection">
                <label class="rop-field-label">Draws</label>
                <div id="ropDraws5050">${ropRender5050Draws(fd.draws || [{ draw_number: 1 }])}</div>
                <button class="rop-add-btn" data-group="draws_5050">+ Add Draw</button>
            </div>`;
    } else if (type === 'catch_the_ace') {
        drawScheduleContent = `
            ${ropField('cta_start_date', 'Raffle Start Date', fd.cta_start_date, 'date')}
            ${ropField('cta_draw_day', 'Draw Day of Week', fd.cta_draw_day || 'Tuesday', 'text')}
            ${ropField('cta_draw_time', 'Draw Time', fd.cta_draw_time || '9:00 AM EST', 'text')}
            ${ropField('cta_sales_close', 'Sales Close Day/Time', fd.cta_sales_close || 'Monday 11:59 PM EST', 'text')}
            ${ropField('cta_sales_reopen', 'Sales Reopen Day/Time', fd.cta_sales_reopen || 'Tuesday 9:00 AM EST after draw', 'text')}
            ${ropField('cta_weekly_prize_pct', 'Weekly Prize % of Sales', fd.cta_weekly_prize_pct || 20, 'number')}
            ${ropField('cta_jackpot_pct', 'Progressive Jackpot % of Sales', fd.cta_jackpot_pct || 30, 'number')}
            ${ropField('cta_guaranteed_min_jackpot', 'Guaranteed Minimum Jackpot ($)', fd.cta_guaranteed_min_jackpot, 'number', 'e.g., 500')}
            ${ropField('cta_remaining_allocation', 'Remaining % Allocated To', fd.cta_remaining_allocation || 'Licensee/charity', 'text')}`;
    } else if (type === 'prize_raffle') {
        drawScheduleContent = `
            ${ropField('pr_draw_name', 'Draw Name', fd.pr_draw_name, 'text', 'e.g., 2025 Cruising For a Cure Jeep Raffle')}
            ${ropField('pr_sales_start', 'Sales Start Date', fd.pr_sales_start, 'date')}
            ${ropField('pr_sales_end', 'Sales End Date', fd.pr_sales_end, 'date')}
            ${ropField('pr_draw_date', 'Draw Date/Time', fd.pr_draw_date, 'text', 'e.g., June 15, 2025 at 2:00 PM EST')}
            ${ropField('pr_grand_prize_description', 'Grand Prize Description', fd.pr_grand_prize_description, 'textarea', 'e.g., 2025 Jeep Wrangler Willys 4-Door in Anvil Grey')}
            ${ropField('pr_grand_prize_value', 'Grand Prize Declared Value ($)', fd.pr_grand_prize_value, 'number')}
            <div class="rop-subsection">
                <label class="rop-field-label">Early Bird Draws</label>
                <div id="ropEarlyBirdsPR">${ropRenderRepeatableGroups('early_birds_pr', fd.early_birds_pr || [], ['date:Date:e.g. May 1 2025', 'prize:Prize:e.g. $2,500 cash'])}</div>
                <button class="rop-add-btn" data-group="early_birds_pr">+ Add Early Bird</button>
            </div>
            ${ropField('pr_early_bird_deadline', 'Early Bird Deadline Rule', fd.pr_early_bird_deadline, 'text', 'e.g., Tickets must be purchased before midnight the day before each Early Bird draw')}`;
    } else if (type === 'house_lottery') {
        drawScheduleContent = `
            <div class="rop-subsection">
                <label class="rop-field-label">Early Bird Draws</label>
                <div id="ropEarlyBirdsHL">${ropRenderRepeatableGroups('early_birds_hl', fd.early_birds_hl || [], ['date:Date:e.g. March 15 2025', 'amount:Prize Amount ($):e.g. 5000'])}</div>
                <button class="rop-add-btn" data-group="early_birds_hl">+ Add Early Bird</button>
            </div>
            ${ropField('hl_early_bird_deadline', 'Early Bird Deadline', fd.hl_early_bird_deadline, 'text', 'e.g., March 1, 2025 at 11:59 PM EST')}
            ${ropField('hl_early_bird_payment', 'Early Bird Payment Method', fd.hl_early_bird_payment || 'Paid by cheque', 'text')}
            ${ropField('hl_sales_deadline', 'Grand Prize Sales Deadline', fd.hl_sales_deadline, 'text', 'e.g., July 1, 2025 at 11:59 PM EST')}
            ${ropField('hl_draw_date', 'Grand Prize Draw Date/Time', fd.hl_draw_date, 'text', 'e.g., July 15, 2025 at 2:00 PM EST')}
            ${ropField('hl_draw_location', 'Grand Prize Draw Location', fd.hl_draw_location, 'text', 'e.g., 123 Property Dr, Thunder Bay, ON')}
            ${ropField('hl_property_address', 'Property Address', fd.hl_property_address, 'text')}
            ${ropField('hl_property_value', 'Grand Prize Total Value (inclusive of HST) ($)', fd.hl_property_value, 'number')}
            <div class="rop-toggle-row"><label><input type="checkbox" class="rop-field" data-field="hl_no_cash_substitute" ${fd.hl_no_cash_substitute !== false ? 'checked' : ''}> No cash substitute for Grand Prize</label></div>
            ${ropField('hl_draw_method', 'Draw Method', fd.hl_draw_method || 'Event Management Terminal maintained by BUMP', 'text')}
            ${ropField('hl_results_deadline', 'Results Publication Deadline', fd.hl_results_deadline, 'text', 'e.g., Complete results published on website by July 31, 2025')}`;
    }
    sections.push(ropSection('Draw Schedule', drawScheduleContent));

    // Section 5: Draw Mechanics
    sections.push(ropSection('Draw Mechanics', `
        ${ropField('rng_method', 'Random Number Selection Method', fd.rng_method || 'Random Number Generation (RNG) system', 'text', '', true)}
        <div class="rop-toggle-row"><label><input type="checkbox" class="rop-field" data-field="can_choose_numbers" ${fd.can_choose_numbers ? 'checked' : ''}> Buyers can choose specific numbers</label></div>
        ${type === 'catch_the_ace' ? `<div class="rop-prefilled"><strong>Envelope Mechanic:</strong> Each ticket purchase entitles the purchaser to select ONE virtual envelope containing a hidden playing card. If the Ace of Spades is revealed, the winner receives the Progressive Jackpot.</div>` : ''}
    `));

    // Section 6: Winner Notification & Prize Claiming
    let winnerExtra = '';
    if (type === '5050') {
        winnerExtra = ropField('prize_payment_method', 'Prize Payment Method', fd.prize_payment_method || 'Cheque representing 50% of total ticket sales', 'text');
    }
    if (type === 'house_lottery') {
        winnerExtra += `<div class="rop-toggle-row"><label><input type="checkbox" class="rop-field" data-field="prizes_as_awarded" ${fd.prizes_as_awarded !== false ? 'checked' : ''}> All prizes must be accepted as awarded</label></div>`;
        winnerExtra += `<div class="rop-toggle-row"><label><input type="checkbox" class="rop-field" data-field="winner_publicity_consent" ${fd.winner_publicity_consent !== false ? 'checked' : ''}> Include winner publicity consent clause</label></div>`;
    }

    sections.push(ropSection('Winner Notification & Prize Claiming', `
        ${ropField('winner_notification', 'How Winners Are Notified', fd.winner_notification || 'Telephone', 'text')}
        ${ropField('results_posted_url', 'Where Results Are Posted', fd.results_posted_url, 'text', 'e.g., https://example.com/results')}
        ${ropField('prize_claim_period', 'Prize Claim Period', fd.prize_claim_period || '6 months', 'text')}
        ${ropField('id_requirements', 'ID Requirements', fd.id_requirements || 'Name, address, phone number, valid government-issued photo identification', 'text')}
        ${ropField('claim_contact_email', 'Contact Email for Claiming', fd.claim_contact_email, 'text')}
        ${ropField('claim_contact_phone', 'Contact Phone for Claiming', fd.claim_contact_phone, 'text')}
        ${winnerExtra}
        ${ropField('unclaimed_prize_rule', 'Unclaimed Prize Procedure', fd.unclaimed_prize_rule || d.unclaimed_prize_rule || '', 'textarea', '', true)}
    `));

    // Section 7: Prize-Specific Terms (prize_raffle + house_lottery)
    if (type === 'prize_raffle' || type === 'house_lottery') {
        let prizeTerms = '';
        if (type === 'prize_raffle') {
            prizeTerms = `
                ${ropField('prize_condition', 'Prize Condition Statement', fd.prize_condition || 'Delivered free and clear of all liens, security interests, and encumbrances', 'textarea')}
                ${ropField('winner_responsibilities', 'Winner Responsibilities After Delivery', fd.winner_responsibilities || 'Insurance, licensing, registration, fuel, maintenance, applicable taxes', 'textarea')}
                ${ropField('delivery_terms', 'Delivery & Transport Terms', fd.delivery_terms, 'textarea', 'e.g., Dealer will arrange transport within Ontario. Winner not required to be present.')}
                ${ropField('prize_supplier', 'Prize Supplier/Dealer Name', fd.prize_supplier, 'text')}
                ${ropField('dealer_support_terms', 'Dealer/Manufacturer Post-Delivery Support', fd.dealer_support_terms, 'textarea', 'e.g., Post-delivery warranty and service matters are between the winner and the dealer.')}`;
        }
        if (type === 'house_lottery') {
            prizeTerms += ropField('liability_statement', 'Liability Limitation', fd.liability_statement || 'Liability limited to the price of the ticket purchased', 'text');
        }
        sections.push(ropSection('Prize-Specific Terms', prizeTerms));
    }

    // Section 8: Privacy (CTA primary, optional for others)
    if (type === 'catch_the_ace') {
        sections.push(ropSection('Privacy', `
            <div class="rop-toggle-row"><label><input type="checkbox" class="rop-field" data-field="privacy_winner_consent" ${fd.privacy_winner_consent !== false ? 'checked' : ''}> Winners consent to promotional use of name, likeness, photo, municipality, recordings</label></div>
            <div class="rop-toggle-row"><label><input type="checkbox" class="rop-field" data-field="privacy_no_sell_data" ${fd.privacy_no_sell_data !== false ? 'checked' : ''}> Include privacy policy (no selling/renting of personal data)</label></div>
        `));
    }

    // Section 9: Subscriptions
    if (type === '5050' || type === 'catch_the_ace') {
        const freq = type === 'catch_the_ace' ? 'weekly' : 'monthly';
        sections.push(ropSection('Subscriptions (Optional)', `
            <div class="rop-toggle-row"><label><input type="checkbox" class="rop-field" data-field="subscriptions_available" ${fd.subscriptions_available ? 'checked' : ''}> Subscription/auto-purchase available</label></div>
            <div class="rop-subscription-fields" ${fd.subscriptions_available ? '' : 'style="display:none"'}>
                ${ropField('subscription_frequency', 'Subscription Frequency', fd.subscription_frequency || freq, 'text', '', true)}
                ${ropField('subscription_cancel_method', 'How to Cancel', fd.subscription_cancel_method || 'Account portal or email', 'text')}
                ${ropField('subscription_declined_behavior', 'Declined Payment Behavior', fd.subscription_declined_behavior || 'Subscription automatically cancelled', 'text')}
                ${type === '5050' ? ropField('subscription_earlybird_bonus', 'Subscription Bonus for Early Bird Winners ($)', fd.subscription_earlybird_bonus, 'number', 'e.g., 1000') : ''}
                ${type === 'catch_the_ace' ? `<div class="rop-prefilled"><strong>Envelope Re-assignment:</strong> If a subscriber's selected envelope is revealed, they are automatically assigned the next available envelope.</div>` : ''}
            </div>
        `));
    }

    // Section 10: Responsible Gambling
    sections.push(ropSection('Responsible Gambling', `
        ${ropField('responsible_gambling_message', 'Responsible Gambling Message', fd.responsible_gambling_message || 'Play responsibly: Set a limit and stick to it.', 'text', '', true)}
        ${ropField('helpline_name', 'Helpline Name', fd.helpline_name || d.responsible_gambling_org || '', 'text', '', true)}
        ${ropField('helpline_phone', 'Helpline Phone', fd.helpline_phone || d.responsible_gambling_phone || '', 'text', '', true)}
        ${ropField('helpline_url', 'Helpline Website (optional)', fd.helpline_url || '', 'text')}
    `));

    // Section 11: Contact
    sections.push(ropSection('Contact Information', `
        ${ropField('contact_phone', 'General Inquiries Phone', fd.contact_phone, 'text')}
        ${ropField('contact_email', 'General Inquiries Email', fd.contact_email, 'text')}
        ${ropField('contact_website', 'Website URL', fd.contact_website, 'text')}
    `));

    // Section 12: Reference Document Upload
    sections.push(ropSection('Reference Document (Optional)', `
        <p class="rop-field-hint">Upload an existing Rules of Play document from your organization or jurisdiction. The AI will use it as a structural guide while generating your new document.</p>
        <div class="rop-upload-area">
            <input type="file" id="ropReferenceFile" accept=".docx,.pdf" style="display:none">
            <button class="btn-secondary" id="ropUploadBtn">Upload .docx or .pdf</button>
            <span id="ropUploadStatus">${d.reference_document_text ? 'Reference document loaded (' + d.reference_document_text.length + ' chars)' : 'No document uploaded'}</span>
        </div>
    `));

    body.innerHTML = sections.join('');

    // Wire up event listeners
    ropAttachFormListeners();
}

function ropSection(title, content) {
    return `
        <div class="rop-form-section">
            <div class="rop-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <h3>${title}</h3>
                <span class="rop-section-toggle">&#9660;</span>
            </div>
            <div class="rop-section-body">${content}</div>
        </div>`;
}

function ropField(name, label, value, type, placeholder, prefilled) {
    const val = value !== undefined && value !== null ? value : '';
    const prefilledClass = prefilled ? ' rop-prefilled-field' : '';
    if (type === 'textarea') {
        return `<div class="rop-form-group${prefilledClass}"><label class="rop-field-label">${label}</label><textarea class="rop-input rop-field" data-field="${name}" placeholder="${placeholder || ''}" rows="3">${escapeHtml(String(val))}</textarea></div>`;
    }
    return `<div class="rop-form-group${prefilledClass}"><label class="rop-field-label">${label}</label><input type="${type || 'text'}" class="rop-input rop-field" data-field="${name}" value="${escapeHtml(String(val))}" placeholder="${placeholder || ''}"></div>`;
}

function ropRenderRepeatableGroups(groupName, items, fieldDefs) {
    if (!items || items.length === 0) return '';
    return items.map((item, idx) => `
        <div class="rop-repeatable-row" data-group="${groupName}" data-index="${idx}">
            ${fieldDefs.map(def => {
                const [key, label, ph] = def.split(':');
                return `<div class="rop-repeat-field"><label>${label}</label><input type="text" class="rop-input rop-repeat-input" data-group="${groupName}" data-index="${idx}" data-key="${key}" value="${escapeHtml(String(item[key] || ''))}" placeholder="${ph || ''}"></div>`;
            }).join('')}
            <button class="rop-remove-btn" data-group="${groupName}" data-index="${idx}" title="Remove">&#10005;</button>
        </div>
    `).join('');
}

function ropRender5050Draws(draws) {
    if (!draws || draws.length === 0) return '';
    return draws.map((draw, idx) => `
        <div class="rop-draw-block" data-index="${idx}">
            <div class="rop-draw-header">
                <strong>Draw #${draw.draw_number || (idx + 1)}</strong>
                <button class="rop-remove-btn" data-group="draws_5050" data-index="${idx}" title="Remove">&#10005;</button>
            </div>
            <div class="rop-draw-fields">
                <div class="rop-repeat-field"><label>Draw Number</label><input type="number" class="rop-input rop-draw-field" data-index="${idx}" data-key="draw_number" value="${draw.draw_number || (idx + 1)}"></div>
                <div class="rop-repeat-field"><label>Sales Start</label><input type="date" class="rop-input rop-draw-field" data-index="${idx}" data-key="sales_start" value="${draw.sales_start || ''}"></div>
                <div class="rop-repeat-field"><label>Sales End</label><input type="date" class="rop-input rop-draw-field" data-index="${idx}" data-key="sales_end" value="${draw.sales_end || ''}"></div>
                <div class="rop-repeat-field"><label>Draw Date/Time</label><input type="text" class="rop-input rop-draw-field" data-index="${idx}" data-key="draw_date" value="${draw.draw_date || ''}" placeholder="e.g., Jan 15, 2025 2:00 PM EST"></div>
                <div class="rop-repeat-field"><label>Guaranteed Min Prize ($)</label><input type="number" class="rop-input rop-draw-field" data-index="${idx}" data-key="guaranteed_min" value="${draw.guaranteed_min || ''}"></div>
                <div class="rop-repeat-field"><label>Sales Threshold for 50/50 ($)</label><input type="number" class="rop-input rop-draw-field" data-index="${idx}" data-key="sales_threshold" value="${draw.sales_threshold || ''}"></div>
                <div class="rop-repeat-field"><label>Early Bird Dates/Prizes</label><textarea class="rop-input rop-draw-field" data-index="${idx}" data-key="early_birds" rows="2" placeholder="e.g., Jan 5: 5 x $5,000">${draw.early_birds || ''}</textarea></div>
            </div>
        </div>
    `).join('');
}

function ropAttachFormListeners() {
    const body = document.getElementById('ropFormBody');

    // Auto-save on field change (debounced)
    body.addEventListener('input', (e) => {
        if (e.target.classList.contains('rop-field') || e.target.classList.contains('rop-repeat-input') || e.target.classList.contains('rop-draw-field')) {
            document.getElementById('ropSaveStatus').textContent = 'Unsaved changes';
            clearTimeout(ropState.saveTimeout);
            ropState.saveTimeout = setTimeout(ropSaveDraft, 3000);
        }
    });

    // Checkbox change
    body.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox' && e.target.classList.contains('rop-field')) {
            // Toggle subscription fields visibility
            if (e.target.dataset.field === 'subscriptions_available') {
                const fields = e.target.closest('.rop-form-section').querySelector('.rop-subscription-fields');
                if (fields) fields.style.display = e.target.checked ? '' : 'none';
            }
            clearTimeout(ropState.saveTimeout);
            ropState.saveTimeout = setTimeout(ropSaveDraft, 3000);
        }
    });

    // Add repeatable group items
    body.addEventListener('click', (e) => {
        const addBtn = e.target.closest('.rop-add-btn');
        if (addBtn) {
            const groupName = addBtn.dataset.group;
            ropAddRepeatableItem(groupName);
            return;
        }

        const removeBtn = e.target.closest('.rop-remove-btn');
        if (removeBtn) {
            const row = removeBtn.closest('.rop-repeatable-row, .rop-draw-block');
            if (row) row.remove();
            clearTimeout(ropState.saveTimeout);
            ropState.saveTimeout = setTimeout(ropSaveDraft, 2000);
        }
    });

    // Upload button
    const uploadBtn = document.getElementById('ropUploadBtn');
    const fileInput = document.getElementById('ropReferenceFile');
    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', ropUploadReference);
    }
}

function ropAddRepeatableItem(groupName) {
    let container, fieldDefs;
    if (groupName === 'ineligible_groups') {
        container = document.getElementById('ropIneligibleGroups');
        fieldDefs = ['group_name:Group Name:e.g. Staff', 'description:Description:', 'consequence:Consequence:disqualification'];
    } else if (groupName === 'sales_locations') {
        container = document.getElementById('ropSalesLocations');
        fieldDefs = ['location_name:Location Name:', 'address:Address:'];
    } else if (groupName === 'pricing_tiers') {
        container = document.getElementById('ropPricingTiers');
        fieldDefs = ['quantity:Quantity:', 'price:Price ($):', 'label:Label:tickets'];
    } else if (groupName === 'early_birds_pr') {
        container = document.getElementById('ropEarlyBirdsPR');
        fieldDefs = ['date:Date:', 'prize:Prize:'];
    } else if (groupName === 'early_birds_hl') {
        container = document.getElementById('ropEarlyBirdsHL');
        fieldDefs = ['date:Date:', 'amount:Prize Amount ($):'];
    } else if (groupName === 'draws_5050') {
        const container5050 = document.getElementById('ropDraws5050');
        const existing = container5050.querySelectorAll('.rop-draw-block');
        const newIdx = existing.length;
        const newDraw = { draw_number: newIdx + 1 };
        container5050.insertAdjacentHTML('beforeend', ropRender5050Draws([newDraw]).replace(/data-index="\d+"/g, `data-index="${newIdx}"`));
        return;
    }

    if (!container) return;
    const existingRows = container.querySelectorAll('.rop-repeatable-row');
    const newIdx = existingRows.length;
    const emptyItem = {};
    fieldDefs.forEach(def => { emptyItem[def.split(':')[0]] = ''; });

    container.insertAdjacentHTML('beforeend', ropRenderRepeatableGroups(groupName, [emptyItem], fieldDefs).replace(/data-index="\d+"/g, `data-index="${newIdx}"`));
}

function ropCollectFormData() {
    const fd = {};
    const body = document.getElementById('ropFormBody');

    // Simple fields
    body.querySelectorAll('.rop-field').forEach(el => {
        const key = el.dataset.field;
        if (!key) return;
        if (el.type === 'checkbox') {
            fd[key] = el.checked;
        } else if (el.type === 'number') {
            fd[key] = el.value ? Number(el.value) : null;
        } else {
            fd[key] = el.value;
        }
    });

    // Repeatable groups
    ['ineligible_groups', 'sales_locations', 'pricing_tiers', 'early_birds_pr', 'early_birds_hl'].forEach(groupName => {
        const rows = body.querySelectorAll(`.rop-repeatable-row[data-group="${groupName}"]`);
        if (rows.length > 0) {
            fd[groupName] = [];
            rows.forEach(row => {
                const item = {};
                row.querySelectorAll('.rop-repeat-input').forEach(inp => {
                    item[inp.dataset.key] = inp.value;
                });
                fd[groupName].push(item);
            });
        }
    });

    // 50/50 draws
    const drawBlocks = body.querySelectorAll('.rop-draw-block');
    if (drawBlocks.length > 0) {
        fd.draws = [];
        drawBlocks.forEach(block => {
            const draw = {};
            block.querySelectorAll('.rop-draw-field').forEach(inp => {
                draw[inp.dataset.key] = inp.type === 'number' ? (inp.value ? Number(inp.value) : null) : inp.value;
            });
            fd.draws.push(draw);
        });
    }

    return fd;
}

async function ropSaveDraft() {
    if (!ropState.currentDraftId) return;
    clearTimeout(ropState.saveTimeout);
    const formData = ropCollectFormData();

    try {
        await fetch(`${API_BASE_URL}/api/rules-of-play/${ropState.currentDraftId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ form_data: formData })
        });
        document.getElementById('ropSaveStatus').textContent = 'Saved';
    } catch (err) {
        document.getElementById('ropSaveStatus').textContent = 'Save failed';
    }
}

async function ropUploadReference() {
    const fileInput = document.getElementById('ropReferenceFile');
    if (!fileInput.files.length || !ropState.currentDraftId) return;

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    const status = document.getElementById('ropUploadStatus');
    status.textContent = 'Uploading...';

    try {
        const token = localStorage.getItem('authToken');
        const resp = await fetch(`${API_BASE_URL}/api/rules-of-play/${ropState.currentDraftId}/upload-reference`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        if (!resp.ok) throw new Error('Upload failed');
        const data = await resp.json();
        status.textContent = `Reference loaded (${data.text_length} chars)`;
    } catch (err) {
        status.textContent = 'Upload failed — try .docx format';
    }
}

async function ropGenerate() {
    if (!ropState.currentDraftId) return;

    // Save current form data first
    await ropSaveDraft();

    ropSwitchView('ropGeneratingView');

    try {
        const resp = await fetch(`${API_BASE_URL}/api/rules-of-play/${ropState.currentDraftId}/generate`, {
            method: 'POST',
            headers: getAuthHeaders()
        });

        if (!resp.ok) await handleApiError(resp);

        const data = await resp.json();
        ropShowOutput(data.generated_document);
    } catch (err) {
        if (err.message === 'TRIAL_EXPIRED') {
            ropShowForm(ropState.currentDraftId);
            return;
        }
        showToast('Generation failed: ' + err.message, 'error');
        ropShowForm(ropState.currentDraftId);
    }
}

function ropShowOutput(text) {
    ropSwitchView('ropOutputView');
    const d = ropState.currentDraft;
    document.getElementById('ropOutputTitle').textContent = d ? d.name : 'Generated Document';
    const badge = document.getElementById('ropOutputBadge');
    if (d) {
        badge.textContent = ROP_TYPE_LABELS[d.raffle_type] || '';
        badge.style.setProperty('--type-color', ROP_TYPE_COLORS[d.raffle_type] || '#888');
    }
    document.getElementById('ropOutputText').value = text || '';
}

function ropCopyOutput() {
    const text = document.getElementById('ropOutputText').value;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}

async function ropExport() {
    if (!ropState.currentDraftId) return;
    // Save any edits first
    await ropSaveOutput();

    try {
        const token = localStorage.getItem('authToken');
        const resp = await fetch(`${API_BASE_URL}/api/rules-of-play/${ropState.currentDraftId}/export`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (!resp.ok) throw new Error('Export failed');

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Rules_of_Play.doc`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('Document exported');
    } catch (err) {
        showToast('Export failed', 'error');
    }
}

async function ropSaveOutput() {
    if (!ropState.currentDraftId) return;
    const text = document.getElementById('ropOutputText').value;
    try {
        await fetch(`${API_BASE_URL}/api/rules-of-play/${ropState.currentDraftId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ generated_document: text, status: 'generated' })
        });
        showToast('Document saved');
    } catch (err) {
        showToast('Save failed', 'error');
    }
}

// ==================== URL ROUTER ====================
const ROUTES = {
    '/':                    { view: 'landing' },
    '/home':                { view: 'landing' },
    '/login':               { view: 'login' },
    '/dashboard':           { view: 'dashboard' },
    '/response-assistant':  { view: 'tool', tool: 'customer-response' },
    '/response-assistant/generator':  { view: 'tool', tool: 'customer-response', page: 'response' },
    '/response-assistant/templates':  { view: 'tool', tool: 'customer-response', page: 'templates' },
    '/response-assistant/analytics':  { view: 'tool', tool: 'customer-response', page: 'analytics' },
    '/response-assistant/knowledge':  { view: 'tool', tool: 'customer-response', page: 'knowledge' },
    '/response-assistant/teams':      { view: 'tool', tool: 'customer-response', page: 'teams' },
    '/response-assistant/admin':      { view: 'tool', tool: 'customer-response', page: 'admin' },
    '/response-assistant/feedback':   { view: 'tool', tool: 'customer-response', page: 'feedback' },
    '/response-assistant/bulk':       { view: 'tool', tool: 'customer-response', page: 'bulk' },
    '/data-analysis':       { view: 'tool', tool: 'data-analysis' },
    '/draft-assistant':     { view: 'tool', tool: 'draft-assistant' },
    '/list-normalizer':              { view: 'tool', tool: 'list-normalizer' },
    '/list-normalizer/marketing':    { view: 'tool', tool: 'list-normalizer', subTool: 'marketing' },
    '/list-normalizer/raw':          { view: 'tool', tool: 'list-normalizer', subTool: 'raw' },
    '/list-normalizer/duplicates':   { view: 'tool', tool: 'list-normalizer', subTool: 'duplicates' },
    '/list-normalizer/compare':      { view: 'tool', tool: 'list-normalizer', subTool: 'compare' },
    '/list-normalizer/email-cleaner': { view: 'tool', tool: 'list-normalizer', subTool: 'email-cleaner' },
    '/ask-lightspeed':               { view: 'tool', tool: 'ask-lightspeed' },
    '/rules-of-play':                { view: 'tool', tool: 'rules-of-play' },
};

// Map tools/pages to URL paths (reverse lookup)
const TOOL_ROUTES = {
    'customer-response': '/response-assistant',
    'data-analysis':     '/data-analysis',
    'draft-assistant':   '/draft-assistant',
    'list-normalizer':   '/list-normalizer',
    'ask-lightspeed':    '/ask-lightspeed',
    'rules-of-play':     '/rules-of-play',
};

const PAGE_ROUTES = {
    'response':  '/response-assistant/generator',
    'templates': '/response-assistant/templates',
    'analytics': '/response-assistant/analytics',
    'knowledge': '/response-assistant/knowledge',
    'teams':     '/response-assistant/teams',
    'admin':     '/response-assistant/admin',
    'feedback':  '/response-assistant/feedback',
    'bulk':      '/response-assistant/bulk',
};

// Flag to suppress pushState during route navigation (popstate / initial load)
let _routerNavigating = false;

function pushRoute(path) {
    if (_routerNavigating) return;
    if (window.location.pathname !== path) {
        history.pushState({ path }, '', path);
    }
}

function navigateToRoute(path) {
    const route = ROUTES[path];
    if (!route) {
        // Unknown route — go to landing or dashboard depending on auth
        if (currentUser) {
            showToolMenu();
        } else {
            document.getElementById("landingPage").classList.remove("hidden");
        }
        return;
    }

    if (route.view === 'landing') {
        if (currentUser) {
            // Logged-in user hitting / — send to dashboard
            showToolMenu();
        } else {
            handleLogout(); // resets to landing
            document.getElementById("landingPage").classList.remove("hidden");
        }
    } else if (route.view === 'login') {
        if (currentUser) {
            showToolMenu();
        } else {
            document.getElementById("landingPage").classList.add("hidden");
            showLoginPage();
        }
    } else if (route.view === 'dashboard') {
        if (!currentUser) {
            // Save intended destination, show login
            sessionStorage.setItem('lightspeed_redirect', path);
            document.getElementById("landingPage").classList.add("hidden");
            showLoginPage();
            return;
        }
        showToolMenu();
    } else if (route.view === 'tool') {
        if (!currentUser) {
            sessionStorage.setItem('lightspeed_redirect', path);
            document.getElementById("landingPage").classList.add("hidden");
            showLoginPage();
            return;
        }
        openTool(route.tool);
        if (route.page) {
            switchPage(route.page);
        }
        if (route.subTool) {
            openNormalizerSubTool(route.subTool);
        }
    }
}

// Listen for back/forward button
window.addEventListener('popstate', (e) => {
    _routerNavigating = true;
    navigateToRoute(window.location.pathname);
    _routerNavigating = false;
});

// Called after login to redirect to intended page
function handlePostLoginRedirect() {
    const redirect = sessionStorage.getItem('lightspeed_redirect');
    if (redirect) {
        sessionStorage.removeItem('lightspeed_redirect');
        _routerNavigating = true;
        navigateToRoute(redirect);
        _routerNavigating = false;
        pushRoute(redirect);
        return true;
    }
    return false;
}

// ==================== INIT ====================
document.addEventListener("DOMContentLoaded", () => {
    try {

        // Check if we were redirected from 404.html (SPA catch-all)
        const spaRedirect = sessionStorage.getItem('spa_redirect');
        if (spaRedirect) {
            sessionStorage.removeItem('spa_redirect');
            history.replaceState(null, '', spaRedirect);
        }

        // Capture the URL BEFORE init() runs (init may change it via showToolMenu → pushRoute)
        // Store globally so loginUser() can use it for direct navigation
        window._initialPath = spaRedirect || window.location.pathname;

        init();

        initParallaxAndAnimations();

        // Clear the initial path flag after init completes
        // (loginUser already handled routing if user was logged in)
        delete window._initialPath;

        // Safety net: detect blank page and recover
        const landingVisible = !document.getElementById('landingPage')?.classList.contains('hidden');
        const toolMenuVisible = document.getElementById('toolMenuPage')?.classList.contains('visible');
        const appWrapperVisible = document.getElementById('appWrapper')?.classList.contains('visible');
        const loginVisible = document.getElementById('loginPage')?.classList.contains('visible');


        // If NOTHING is visible, the user would see a blank page — recover now
        if (!landingVisible && !toolMenuVisible && !appWrapperVisible && !loginVisible) {
            console.warn('[BOOT] Blank page detected! No container is visible. Recovering...');
            if (currentUser) {
                // User is logged in but nothing rendered — show the dashboard
                showToolMenu();
            } else {
                // Not logged in — show landing page
                document.getElementById('landingPage').classList.remove('hidden');
            }
        }
    } catch (err) {
        console.error('[BOOT] Fatal error during initialization:', err);
        // Show error visually so the user sees something
        document.body.innerHTML = '<div style="color:white;padding:40px;font-family:sans-serif;">' +
            '<h2>Something went wrong during startup</h2>' +
            '<p>' + err.message + '</p>' +
            '<p style="opacity:0.6">Check browser console (F12) for details.</p>' +
            '<button onclick="localStorage.clear();sessionStorage.clear();location.href=\'/\'" style="margin-top:20px;padding:10px 20px;cursor:pointer;">Reset &amp; Reload</button>' +
            '</div>';
    }
});

// ==================== SHOPIFY INTEGRATION ====================

let shopifyConnected = false;

/**
 * Check Shopify connection status and update UI accordingly.
 * Called when the settings modal is opened.
 */
async function checkShopifyStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/shopify/status`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) return;

        const data = await response.json();
        shopifyConnected = data.connected;

        const notConnectedEl = document.getElementById('shopifyNotConnected');
        const connectedEl = document.getElementById('shopifyConnected');

        if (data.connected) {
            notConnectedEl.style.display = 'none';
            connectedEl.style.display = 'block';

            document.getElementById('shopifyConnectedDomain').textContent = data.shopDomain;
            document.getElementById('shopifyProductCount').textContent = data.counts.products || 0;
            document.getElementById('shopifyOrderCount').textContent = data.counts.orders || 0;
            document.getElementById('shopifyCustomerCount').textContent = data.counts.customers || 0;

            const lastSync = data.lastSync.orders || data.lastSync.products;
            document.getElementById('shopifyLastSync').textContent = lastSync
                ? new Date(lastSync).toLocaleString()
                : 'Never';

            // Show the Shopify import card in List Normalizer
            const shopifyCard = document.getElementById('nhubShopifyCard');
            if (shopifyCard) shopifyCard.style.display = '';
        } else {
            notConnectedEl.style.display = 'block';
            connectedEl.style.display = 'none';

            const shopifyCard = document.getElementById('nhubShopifyCard');
            if (shopifyCard) shopifyCard.style.display = 'none';
        }
    } catch (err) {
        console.warn('Shopify status check failed:', err.message);
    }
}

/**
 * Connect a Shopify store using manual API token.
 */
async function connectShopify() {
    const shopDomain = document.getElementById('shopifyStoreDomain').value.trim();
    const accessToken = document.getElementById('shopifyAccessToken').value.trim();
    const errorEl = document.getElementById('shopifyConnectError');
    const btn = document.getElementById('shopifyConnectBtn');

    errorEl.style.display = 'none';

    if (!shopDomain || !accessToken) {
        errorEl.textContent = 'Please enter both your store domain and access token.';
        errorEl.style.display = 'block';
        return;
    }

    btn.textContent = 'Connecting...';
    btn.disabled = true;

    try {
        const response = await fetch(`${API_BASE_URL}/api/shopify/connect`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ shopDomain, accessToken })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Connection failed');
        }

        showToast('Shopify store connected! Starting initial sync...', 'success');

        // Clear form inputs
        document.getElementById('shopifyStoreDomain').value = '';
        document.getElementById('shopifyAccessToken').value = '';

        // Refresh status
        await checkShopifyStatus();

        // Trigger initial sync
        syncShopifyData();

    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    } finally {
        btn.textContent = 'Connect Shopify Store';
        btn.disabled = false;
    }
}

/**
 * Trigger a full Shopify data sync.
 */
async function syncShopifyData() {
    const statusEl = document.getElementById('shopifySyncStatus');
    statusEl.style.display = 'block';
    statusEl.style.color = 'var(--text-secondary, #888)';
    statusEl.textContent = 'Syncing products, orders, and customers...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/shopify/sync`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ types: ['products', 'orders', 'customers'] })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Sync failed');
        }

        const products = data.results.products?.synced || 0;
        const orders = data.results.orders?.synced || 0;
        const customers = data.results.customers?.synced || 0;

        statusEl.style.color = '#10b981';
        statusEl.textContent = `Sync complete: ${products} products, ${orders} orders, ${customers} customers`;
        showToast('Shopify sync complete!', 'success');

        // Refresh counts
        await checkShopifyStatus();

    } catch (err) {
        statusEl.style.color = '#ef4444';
        statusEl.textContent = `Sync failed: ${err.message}`;
    }
}

/**
 * Disconnect the Shopify store.
 */
async function disconnectShopify() {
    if (!confirm('Are you sure you want to disconnect your Shopify store? Cached data will no longer be used for AI tools.')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/shopify/disconnect`, {
            method: 'POST',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Disconnect failed');
        }

        showToast('Shopify store disconnected', 'success');
        shopifyConnected = false;
        await checkShopifyStatus();

    } catch (err) {
        showToast(`Failed to disconnect: ${err.message}`, 'error');
    }
}

/**
 * Handle Shopify Analytics in the Insights Engine.
 * Pulls data from the Shopify API instead of requiring a file upload.
 */
async function handleShopifyAnalytics() {
    const combinedSection = document.getElementById('dataCombinedUploadSection');
    const loadingEl = document.getElementById('dataLoading');
    const dashboardEl = document.getElementById('dataDashboard');

    // Show loading
    combinedSection.style.display = 'none';
    loadingEl.style.display = 'flex';

    try {
        const response = await fetch(`${API_BASE_URL}/api/shopify/analytics?days=30`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            const data = await response.json();
            if (data.error && data.error.includes('No Shopify store connected')) {
                throw new Error('No Shopify store connected. Go to Settings to connect your store first.');
            }
            throw new Error(data.error || 'Failed to fetch Shopify analytics');
        }

        const analyticsData = await response.json();
        renderShopifyDashboard(analyticsData);

    } catch (err) {
        loadingEl.style.display = 'none';
        combinedSection.style.display = 'block';
        showToast(err.message, 'error');
    }
}

/**
 * Render the Shopify analytics dashboard with charts and metrics.
 */
function renderShopifyDashboard(data) {
    const loadingEl = document.getElementById('dataLoading');
    const dashboardEl = document.getElementById('dataDashboard');
    const navTabs = document.getElementById('dataNavTabs');
    const headerActions = document.getElementById('dataHeaderActions');

    loadingEl.style.display = 'none';
    dashboardEl.style.display = 'block';
    navTabs.style.display = 'flex';
    headerActions.style.display = 'flex';

    const s = data.analytics.summary;
    const totalRevenue = parseFloat(s.total_revenue) || 0;
    const avgOrderValue = parseFloat(s.avg_order_value) || 0;
    const totalOrders = parseInt(s.total_orders) || 0;
    const uniqueCustomers = parseInt(s.unique_customers) || 0;
    const fulfilledOrders = parseInt(s.fulfilled_orders) || 0;
    const unfulfilledOrders = parseInt(s.unfulfilled_orders) || 0;
    const refundedOrders = parseInt(s.refunded_orders) || 0;
    const refundTotal = parseFloat(s.refund_total) || 0;

    // Set report name
    const reportNameEl = document.getElementById('dataReportName');
    if (reportNameEl) reportNameEl.textContent = `Shopify - ${data.shopDomain || 'Store'} (Last 30 Days)`;

    // Fill key metrics
    const revenueEl = document.getElementById('dataTotalRevenue');
    const revenueSubEl = document.getElementById('dataRevenueSubtext');
    if (revenueEl) animateCurrency(revenueEl, totalRevenue, 800);
    if (revenueSubEl) revenueSubEl.textContent = `from ${totalOrders} orders`;

    // Fill other metric cards if they exist
    const avgEl = document.getElementById('dataAvgSale');
    if (avgEl) animateCurrency(avgEl, avgOrderValue, 800);

    const customersEl = document.getElementById('dataUniqueCustomers');
    if (customersEl) animateNumber(customersEl, uniqueCustomers, 800);

    // Destroy old charts
    if (typeof dataCharts !== 'undefined') {
        dataCharts.forEach(chart => chart.destroy());
        dataCharts.length = 0;
    }

    // Build the overview page content with Shopify-specific sections
    const overviewPage = document.getElementById('data-page-overview');
    if (!overviewPage) return;

    // Find or create the charts container area after the metrics
    let shopifyChartsArea = document.getElementById('shopifyChartsArea');
    if (!shopifyChartsArea) {
        shopifyChartsArea = document.createElement('div');
        shopifyChartsArea.id = 'shopifyChartsArea';
        // Insert after the metrics grid
        const metricsGrid = overviewPage.querySelector('.data-metrics-grid');
        if (metricsGrid) {
            metricsGrid.parentNode.insertBefore(shopifyChartsArea, metricsGrid.nextSibling);
        } else {
            overviewPage.appendChild(shopifyChartsArea);
        }
    }

    shopifyChartsArea.innerHTML = `
        <div class="data-metrics-grid" style="grid-template-columns: repeat(4, 1fr); margin-top: 16px;">
            <div class="data-metric-card">
                <div class="data-metric-label">Fulfilled</div>
                <div class="data-metric-value" style="color: #10b981;">${fulfilledOrders}</div>
            </div>
            <div class="data-metric-card">
                <div class="data-metric-label">Unfulfilled</div>
                <div class="data-metric-value" style="color: #f59e0b;">${unfulfilledOrders}</div>
            </div>
            <div class="data-metric-card">
                <div class="data-metric-label">Refunded</div>
                <div class="data-metric-value" style="color: #ef4444;">${refundedOrders}</div>
            </div>
            <div class="data-metric-card">
                <div class="data-metric-label">Refund Total</div>
                <div class="data-metric-value" style="color: #ef4444;">$${refundTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;">
            <div class="data-chart-card" style="background: var(--bg-secondary, #fff); border-radius: 12px; padding: 20px;">
                <h4 style="margin-bottom: 12px;">Daily Revenue (Last 30 Days)</h4>
                <div style="height: 250px;"><canvas id="shopifyDailyRevenueChart"></canvas></div>
            </div>
            <div class="data-chart-card" style="background: var(--bg-secondary, #fff); border-radius: 12px; padding: 20px;">
                <h4 style="margin-bottom: 12px;">Top Products by Revenue</h4>
                <div style="height: 250px;"><canvas id="shopifyTopProductsChart"></canvas></div>
            </div>
        </div>

        <div style="background: var(--bg-secondary, #fff); border-radius: 12px; padding: 20px; margin-top: 20px;">
            <h4 style="margin-bottom: 12px;">AI Insights</h4>
            <div id="shopifyAiInsights" style="font-size: 0.9rem; line-height: 1.6; color: var(--text-primary, #333);">
                <div style="text-align: center; padding: 20px; color: var(--text-secondary, #888);">Generating AI insights...</div>
            </div>
        </div>
    `;

    // Render Daily Revenue Chart
    if (data.analytics.daily && data.analytics.daily.length > 0) {
        const dailyCtx = document.getElementById('shopifyDailyRevenueChart');
        if (dailyCtx) {
            const dailyChart = new Chart(dailyCtx, {
                type: 'bar',
                data: {
                    labels: data.analytics.daily.map(d => {
                        const date = new Date(d.date);
                        return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
                    }),
                    datasets: [{
                        label: 'Revenue ($)',
                        data: data.analytics.daily.map(d => parseFloat(d.revenue)),
                        backgroundColor: 'rgba(59, 130, 246, 0.8)',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => '$' + ctx.raw.toLocaleString(undefined, { minimumFractionDigits: 2 }) } } },
                    scales: { y: { beginAtZero: true, ticks: { callback: (v) => '$' + v.toLocaleString() } } }
                }
            });
            dataCharts.push(dailyChart);
        }
    }

    // Render Top Products Chart
    if (data.analytics.topProducts && data.analytics.topProducts.length > 0) {
        const productsCtx = document.getElementById('shopifyTopProductsChart');
        if (productsCtx) {
            const topProducts = data.analytics.topProducts.slice(0, 8);
            const productChart = new Chart(productsCtx, {
                type: 'bar',
                data: {
                    labels: topProducts.map(p => p.product_title.length > 25 ? p.product_title.substring(0, 25) + '...' : p.product_title),
                    datasets: [{
                        label: 'Revenue ($)',
                        data: topProducts.map(p => parseFloat(p.total_revenue)),
                        backgroundColor: 'rgba(16, 185, 129, 0.8)',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => '$' + ctx.raw.toLocaleString(undefined, { minimumFractionDigits: 2 }) + ' (' + topProducts[ctx.dataIndex].total_quantity + ' sold)' } } },
                    scales: { x: { beginAtZero: true, ticks: { callback: (v) => '$' + v.toLocaleString() } } }
                }
            });
            dataCharts.push(productChart);
        }
    }

    // Generate AI insights
    generateShopifyInsights(data);
}

/**
 * Generate AI-powered insights for Shopify data using the analyze endpoint.
 */
async function generateShopifyInsights(data) {
    const insightsEl = document.getElementById('shopifyAiInsights');
    if (!insightsEl) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/analyze`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                data: data.analytics,
                reportType: 'shopify',
                additionalContext: `Store: ${data.shopDomain}. Products in catalog: ${data.counts.products}. Total customers: ${data.counts.customers}.`
            })
        });

        if (!response.ok) {
            insightsEl.innerHTML = '<p style="color: var(--text-secondary);">Unable to generate AI insights at this time.</p>';
            return;
        }

        const result = await response.json();
        const text = result.content?.[0]?.text || 'No insights generated.';
        insightsEl.innerHTML = renderSimpleMarkdown(text);

    } catch (err) {
        insightsEl.innerHTML = '<p style="color: var(--text-secondary);">Unable to generate AI insights at this time.</p>';
    }
}

/**
 * Handle Shopify customer import in the List Normalizer.
 */
async function handleShopifyCustomerImport() {
    try {
        showToast('Pulling customers from Shopify...', 'success');

        const response = await fetch(`${API_BASE_URL}/api/shopify/customers/export`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to export customers');
        }

        const data = await response.json();

        if (!data.customers || data.customers.length === 0) {
            showToast('No customers found in Shopify. Try syncing first.', 'error');
            return;
        }

        // Format as Mailchimp-ready data
        const formatted = data.customers
            .filter(c => c.email)
            .map(c => ({
                NAME: `${(c.first_name || '')} ${(c.last_name || '')}`.trim(),
                EMAIL: (c.email || '').toLowerCase().trim()
            }))
            .filter(c => c.NAME && c.EMAIL);

        // Deduplicate by email
        const seen = new Set();
        const deduped = formatted.filter(c => {
            if (seen.has(c.EMAIL)) return false;
            seen.add(c.EMAIL);
            return true;
        });

        // Generate downloadable Excel file
        const ws = XLSX.utils.json_to_sheet(deduped);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Customers');
        XLSX.writeFile(wb, 'shopify-customers-mailchimp.xlsx');

        showToast(`Exported ${deduped.length} customers (${data.total - deduped.length} duplicates removed)`, 'success');

    } catch (err) {
        showToast(`Shopify import failed: ${err.message}`, 'error');
    }
}

// Hook: check Shopify status when settings modal opens
(function hookShopifySettingsCheck() {
    const settingsToggle = document.getElementById('settingsToggle');
    const accountBtn = document.getElementById('accountBtn');

    const checkOnOpen = () => { checkShopifyStatus(); };

    if (settingsToggle) settingsToggle.addEventListener('click', checkOnOpen);
    if (accountBtn) accountBtn.addEventListener('click', checkOnOpen);

    // Also check on page load if logged in
    if (localStorage.getItem('authToken')) {
        setTimeout(checkShopifyStatus, 2000);
    }
})();
