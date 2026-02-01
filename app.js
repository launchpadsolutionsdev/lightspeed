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

// ==================== GOOGLE OAUTH CONFIGURATION ====================
const GOOGLE_CLIENT_ID = '538611064946-ij0geilde0q1tq0hlpjep886holcmro5.apps.googleusercontent.com';

// ==================== AUTH STATE ====================
let currentUser = null;
let users = [];

// Load users from localStorage with error handling
try {
    const storedUsers = localStorage.getItem("lightspeed_users");
    if (storedUsers) {
        users = JSON.parse(storedUsers);
        console.log("Loaded " + users.length + " users from localStorage");
    }
} catch (e) {
    console.error("Failed to load users from localStorage:", e);
    users = [];
}

// ==================== APP STATE ====================
let currentTool = null; // 'customer-response' or 'data-analysis'
let defaultName = "Bella";
let orgName = "";
let customKnowledge = [];
let feedbackList = [];
let responseHistory = [];
let favorites = [];
let currentResponse = null;
let currentInquiry = null;
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
function renderDrawSchedule() {
    const container = document.getElementById("drawScheduleContainer");
    if (!container) return;

    if (typeof DRAW_SCHEDULE !== 'undefined') {
        container.innerHTML = DRAW_SCHEDULE.getFormattedSchedule();
    } else {
        container.innerHTML = `<div class="response-placeholder">
            <div class="placeholder-icon">📅</div>
            <div class="placeholder-text">Draw schedule not loaded</div>
        </div>`;
    }
}

// ==================== INITIALIZATION ====================
function init() {
    // Setup auth event listeners first
    setupAuthEventListeners();

    // Check if user is logged in
    const savedUserId = localStorage.getItem("lightspeed_current_user");
    console.log("Init - savedUserId:", savedUserId);
    console.log("Init - users count:", users.length);

    if (savedUserId) {
        const user = users.find(u => u.id === savedUserId);
        console.log("Init - found user:", user ? user.email : "not found");
        if (user) {
            loginUser(user, false); // false = don't show message
            return;
        } else {
            // User ID exists but user not found - clear stale session
            console.log("Clearing stale session - user not found in users array");
            localStorage.removeItem("lightspeed_current_user");
        }
    }

    // Always show landing page first for non-logged-in users
    // The landing page is now a marketing page, not just a splash screen
    document.getElementById("landingPage").classList.remove("hidden");

    // Setup all event listeners
    setupEventListeners();
    setupDataAnalysisListeners();
}

function setupAuthEventListeners() {
    // Landing page CTAs - show login/register
    const launchAppBtns = [
        document.getElementById("navLaunchAppBtn"),
        document.getElementById("heroGetStartedBtn"),
        document.getElementById("ctaGetStartedBtn")
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

            if (demoId === 'draft') {
                document.getElementById('demoDraft').classList.add('active');
            } else if (demoId === 'response') {
                document.getElementById('demoResponse').classList.add('active');
            } else if (demoId === 'insights') {
                document.getElementById('demoInsights').classList.add('active');
            } else if (demoId === 'normalizer') {
                document.getElementById('demoNormalizer').classList.add('active');
            }
        });
    });

    // Switch between login and register
    document.getElementById("showRegister").addEventListener("click", showRegisterPage);
    document.getElementById("showLogin").addEventListener("click", showLoginPage);

    // Login form
    document.getElementById("loginForm").addEventListener("submit", handleLogin);

    // Register form
    document.getElementById("registerForm").addEventListener("submit", handleRegister);

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

    // Back to menu buttons
    document.getElementById("backToMenuBtn").addEventListener("click", goBackToMenu);
    document.getElementById("dataBackToMenuBtn").addEventListener("click", goBackToMenu);
    document.getElementById("draftBackToMenuBtn").addEventListener("click", goBackToMenu);
    document.getElementById("listNormalizerBackBtn").addEventListener("click", goBackToMenu);

    // Google Sign-In button
    document.getElementById("googleSignInBtn").addEventListener("click", handleGoogleSignIn);
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

function handleGoogleCredentialResponse(response) {
    // Decode the JWT credential to get user info
    const credential = response.credential;
    const payload = parseJwt(credential);

    if (payload && payload.email) {
        processGoogleUser(payload);
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
            processGoogleUser(userInfo);
        } else {
            showToast("Failed to get user information from Google", "error");
        }
    } catch (error) {
        console.error("Google OAuth error:", error);
        showToast("Failed to sign in with Google", "error");
    }
}

function processGoogleUser(googleUser) {
    const email = googleUser.email;
    const name = googleUser.name || googleUser.given_name || email.split('@')[0];
    const picture = googleUser.picture || null;

    // Check if user already exists
    let user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (!user) {
        // Create new user from Google account
        user = {
            id: generateUserId(),
            email: email,
            name: name,
            password: null, // Google users don't have a password
            googleId: googleUser.sub || null,
            picture: picture,
            createdAt: new Date().toISOString(),
            settings: {
                defaultName: name.split(" ")[0],
                orgName: ""
            },
            data: {
                customKnowledge: [],
                feedbackList: [],
                responseHistory: [],
                favorites: []
            }
        };

        // Save new user
        users.push(user);
        localStorage.setItem("lightspeed_users", JSON.stringify(users));
        console.log("Created new Google user:", email);
    } else {
        // Update existing user with Google info if needed
        if (!user.googleId && googleUser.sub) {
            user.googleId = googleUser.sub;
        }
        if (!user.picture && picture) {
            user.picture = picture;
        }
        localStorage.setItem("lightspeed_users", JSON.stringify(users));
    }

    // Log the user in
    loginUser(user, true);
    showToast(`Welcome, ${user.name.split(" ")[0]}!`, "success");
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
    document.getElementById("loginPage").classList.add("visible");
    document.getElementById("registerPage").classList.remove("visible");
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("dataAnalysisApp").classList.remove("visible");
    document.getElementById("draftAssistantApp").classList.remove("visible");
    document.getElementById("toolMenuPage").classList.remove("visible");
    clearAuthForms();
}

function showRegisterPage() {
    document.getElementById("registerPage").classList.add("visible");
    document.getElementById("loginPage").classList.remove("visible");
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("dataAnalysisApp").classList.remove("visible");
    document.getElementById("toolMenuPage").classList.remove("visible");
    clearAuthForms();
}

function showToolMenu() {
    document.getElementById("landingPage").classList.add("hidden");
    document.getElementById("loginPage").classList.remove("visible");
    document.getElementById("registerPage").classList.remove("visible");
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("dataAnalysisApp").classList.remove("visible");
    document.getElementById("toolMenuPage").classList.add("visible");

    // Update user info in menu
    if (currentUser) {
        document.getElementById("menuUserName").textContent = currentUser.name;
        document.getElementById("menuUserEmail").textContent = currentUser.email;
    }
}

function openTool(toolId) {
    currentTool = toolId;
    document.getElementById("toolMenuPage").classList.remove("visible");

    // Hide all tool apps first
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("dataAnalysisApp").classList.remove("visible");
    document.getElementById("draftAssistantApp").classList.remove("visible");
    document.getElementById("listNormalizerApp").classList.remove("visible");

    if (toolId === 'customer-response') {
        document.getElementById("mainApp").classList.add("visible");
    } else if (toolId === 'data-analysis') {
        document.getElementById("dataAnalysisApp").classList.add("visible");
        // Re-attach listeners when opening Data Analysis tool
        setupDataAnalysisListeners();
    } else if (toolId === 'draft-assistant') {
        document.getElementById("draftAssistantApp").classList.add("visible");
        // Initialize Draft Assistant
        setupDraftAssistant();
    } else if (toolId === 'list-normalizer') {
        document.getElementById("listNormalizerApp").classList.add("visible");
        // Initialize List Normalizer
        setupListNormalizerListeners();
    }
}

function goBackToMenu() {
    currentTool = null;
    document.getElementById("mainApp").classList.remove("visible");
    document.getElementById("dataAnalysisApp").classList.remove("visible");
    document.getElementById("draftAssistantApp").classList.remove("visible");
    document.getElementById("listNormalizerApp").classList.remove("visible");
    showToolMenu();
}

function clearAuthForms() {
    document.getElementById("loginForm").reset();
    document.getElementById("registerForm").reset();
    document.querySelectorAll(".auth-message").forEach(el => {
        el.className = "auth-message";
        el.textContent = "";
    });
    document.querySelectorAll(".auth-error").forEach(el => el.classList.remove("show"));
    document.querySelectorAll(".auth-input-group input").forEach(el => el.classList.remove("error"));
}

function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const password = document.getElementById("loginPassword").value;
    const messageEl = document.getElementById("loginMessage");

    // Find user
    const user = users.find(u => u.email === email);

    if (!user) {
        messageEl.className = "auth-message error";
        messageEl.textContent = "No account found with this email address.";
        return;
    }

    // Check password (simple hash comparison for prototype)
    if (user.passwordHash !== simpleHash(password)) {
        messageEl.className = "auth-message error";
        messageEl.textContent = "Incorrect password. Please try again.";
        return;
    }

    // Success!
    loginUser(user, true);
}

function handleRegister(e) {
    e.preventDefault();

    const name = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim().toLowerCase();
    const password = document.getElementById("registerPassword").value;
    const confirm = document.getElementById("registerConfirm").value;
    const messageEl = document.getElementById("registerMessage");

    // Validation
    if (password !== confirm) {
        document.getElementById("registerConfirmError").classList.add("show");
        document.getElementById("registerConfirm").classList.add("error");
        return;
    }

    if (password.length < 6) {
        document.getElementById("registerPasswordError").classList.add("show");
        document.getElementById("registerPassword").classList.add("error");
        return;
    }

    // Check if email already exists
    if (users.find(u => u.email === email)) {
        messageEl.className = "auth-message error";
        messageEl.textContent = "An account with this email already exists.";
        return;
    }

    // Create new user
    const newUser = {
        id: generateUserId(),
        name: name,
        email: email,
        passwordHash: simpleHash(password),
        createdAt: new Date().toISOString(),
        settings: {
            defaultName: name.split(" ")[0], // First name
            orgName: ""
        },
        data: {
            customKnowledge: [],
            feedbackList: [],
            responseHistory: [],
            favorites: []
        }
    };

    // Save user
    users.push(newUser);
    localStorage.setItem("lightspeed_users", JSON.stringify(users));

    // Log them in
    loginUser(newUser, true);
}

function loginUser(user, showMessage = true) {
    currentUser = user;
    localStorage.setItem("lightspeed_current_user", user.id);

    // Load user's data
    loadUserData(user);

    // Update UI
    document.getElementById("userAvatar").textContent = user.name.charAt(0).toUpperCase();
    document.getElementById("userName").textContent = user.name.split(" ")[0];

    // Hide auth pages, show tool menu
    document.getElementById("landingPage").classList.add("hidden");
    document.getElementById("loginPage").classList.remove("visible");
    document.getElementById("registerPage").classList.remove("visible");

    // Show tool menu instead of directly going to main app
    showToolMenu();

    // Setup main app event listeners if not already done
    setupEventListeners();

    // Load settings into forms
    loadSettings();

    // Initialize pages
    updateKnowledgeStats();
    renderKnowledgeList();
    updateAnalytics();
    renderFavorites();

    if (showMessage) {
        showToast(`Welcome back, ${user.name.split(" ")[0]}!`, "success");
    }
}

function loadUserData(user) {
    defaultName = user.settings.defaultName || user.name.split(" ")[0];
    orgName = user.settings.orgName || "";
    customKnowledge = user.data.customKnowledge || [];
    feedbackList = user.data.feedbackList || [];
    responseHistory = user.data.responseHistory || [];
    favorites = user.data.favorites || [];
}

function saveUserData() {
    if (!currentUser) return;

    // Update user object
    currentUser.settings.defaultName = defaultName;
    currentUser.settings.orgName = orgName;
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
    document.getElementById("toolMenuPage").classList.remove("visible");

    // Show landing page (marketing page)
    document.getElementById("landingPage").classList.remove("hidden");

    showToast("You've been signed out", "success");
}

function toggleUserDropdown() {
    document.getElementById("userDropdown").classList.toggle("show");
}

function closeUserDropdown() {
    document.getElementById("userDropdown").classList.remove("show");
}

// Simple hash function for password (NOT secure for production!)
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
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
}

let eventListenersSetup = false;

function setupEventListeners() {
    // Prevent double-binding
    if (eventListenersSetup) return;
    eventListenersSetup = true;

    // Navigation
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.addEventListener("click", () => switchPage(btn.dataset.page));
    });

    // Logo click - go to generator page
    document.getElementById("logoHome").addEventListener("click", () => {
        switchPage("response");
    });

    // Response Generator
    document.getElementById("generateBtn").addEventListener("click", handleGenerate);
    document.getElementById("customerEmail").addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleGenerate();
    });

    // Smart suggestions
    document.querySelectorAll(".suggestion-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            document.getElementById("customerEmail").value = SUGGESTION_TEMPLATES[chip.dataset.template];
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
            navigator.clipboard.writeText(currentHistoryItem.response);
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
    console.log("Setting up data analysis listeners...");

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

    console.log("Data analysis listeners attached successfully");
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
    } else if (currentReportType === 'payment-tickets') {
        document.getElementById("dataPaymentTicketsReportName").textContent = reportName;
        document.getElementById("dataNavTabs").style.display = "none"; // Payment Tickets report has single page
        analyzePaymentTicketsReport(dataPendingFileData);
        document.getElementById("dataPaymentTicketsDashboard").style.display = "block";
    } else if (currentReportType === 'sellers') {
        document.getElementById("dataSellersReportName").textContent = reportName;
        document.getElementById("dataNavTabs").style.display = "none"; // Sellers report has single page
        analyzeSellersReport(dataPendingFileData);
        document.getElementById("dataSellersDashboard").style.display = "block";
    } else {
        // Default to customer-purchases
        document.getElementById("dataReportName").textContent = reportName;
        document.getElementById("dataNavTabs").style.display = "flex";
        analyzeDataFull(dataPendingFileData);
        document.getElementById("dataDashboard").classList.add("visible");
    }
}

function analyzeDataFull(data) {
    // Auto-detect column names
    const columns = Object.keys(data[0] || {});
    const findCol = (names) => columns.find(c => names.some(n => c.toLowerCase().includes(n.toLowerCase())));

    const emailCol = findCol(['e-mail', 'email']);
    const spentCol = findCol(['total spent', 'totalspent', 'spent', 'amount', 'total']);
    const cityCol = findCol(['city']);
    const nameCol = findCol(['customer name', 'name']);
    const ticketCol = findCol(['number count', 'tickets', 'quantity']);
    const phoneCol = findCol(['phone']);
    const zipCol = findCol(['zip', 'postal', 'zip code']);

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

    data.forEach(row => {
        let rawCity = (row[cityCol] || '').toString().trim();
        const amount = Number(row[spentCol]) || 0;
        const email = (row[emailCol] || '').toString().toLowerCase().trim();
        const name = row[nameCol] || 'Unknown';
        const phone = row[phoneCol] || '';
        const postal = (row[zipCol] || '').toString().toUpperCase().trim().substring(0, 3);

        // RSU detection
        const isRSU = !rawCity || rawCity.toLowerCase() === 'unknown' || rawCity === '';
        if (isRSU) {
            rsuRevenue += amount;
            rsuCount++;
            rawCity = 'Thunder Bay';
        }

        const normalizedCity = normalizeCity(rawCity);
        const displayCity = rawCity.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

        // City aggregation
        if (!cityData[normalizedCity]) {
            cityData[normalizedCity] = { revenue: 0, count: 0, displayName: displayCity };
        }
        cityData[normalizedCity].revenue += amount;
        cityData[normalizedCity].count++;

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

        // Northern vs Southern Ontario
        if (isNorthernOntario(rawCity) || isRSU) {
            northernRevenue += amount;
            northernCount++;
        } else {
            southernRevenue += amount;
            southernCount++;
        }
    });

    // Store for other pages
    dataAnalysisResults = { cityData, customerSpending, totalRevenue };

    // Update UI - use exact amounts for main revenue figures
    // Animated metric updates
    animateCurrency(document.getElementById('dataTotalRevenue'), totalRevenue, 1500, true);
    document.getElementById('dataRevenueSubtext').textContent = `from ${totalTransactions.toLocaleString()} transactions`;
    animateCurrency(document.getElementById('dataAvgSale'), avgSale, 1200);
    document.getElementById('dataAvgSaleSubtext').textContent = `from ${totalPackageCount.toLocaleString()} packages`;
    animateNumber(document.getElementById('dataUniqueCustomers'), uniqueCustomers, 1200);
    animateCurrency(document.getElementById('dataAvgPerCustomer'), avgPerCustomer, 1000);
    animateNumber(document.getElementById('dataRepeatBuyers'), repeatBuyersCount, 1000);
    document.getElementById('dataRepeatSubtext').textContent = `bought multiple packages`;
    animateNumber(document.getElementById('dataTotalTickets'), totalTickets, 1200);
    animateNumber(document.getElementById('dataTotalPurchases'), totalTransactions, 1000);
    animateNumber(document.getElementById('dataTotalUniqueCustomers'), uniqueCustomers, 1000);
    animateCurrency(document.getElementById('dataAvgPurchase'), totalRevenue / totalTransactions, 1000);
    animateCurrency(document.getElementById('dataNorthernSales'), northernRevenue, 1200, true);
    document.getElementById('dataNorthernSubtext').textContent = `${northernCount.toLocaleString()} customers (${((northernRevenue/totalRevenue)*100).toFixed(1)}%)`;
    animateCurrency(document.getElementById('dataRsuSales'), rsuRevenue, 1200, true);
    document.getElementById('dataRsuSubtext').textContent = `${rsuCount.toLocaleString()} in-venue transactions`;

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

    const chartColors = ['#8b5cf6', '#7c3aed', '#a78bfa', '#c4b5fd', '#ddd6fe'];

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
                backgroundColor: ['#059669', '#8b5cf6']
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
        const textColor = intensity > 0.5 ? 'white' : '#1e1b4b';
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
    // Auto-detect column names
    const columns = Object.keys(data[0] || {});
    const findCol = (names) => columns.find(c => names.some(n => c.toLowerCase().includes(n.toLowerCase())));

    const cityCol = findCol(['city']);
    const phoneCol = findCol(['phone', 'phone number']);
    const zipCol = findCol(['zip', 'postal', 'zip code', 'postal code']);
    const emailCol = findCol(['e-mail', 'email']);

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

    const chartColors = ['#8b5cf6', '#7c3aed', '#a78bfa', '#c4b5fd', '#ddd6fe', '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e0e7ff'];

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
                backgroundColor: ['#059669', '#8b5cf6']
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
    // Auto-detect column names
    const columns = Object.keys(data[0] || {});
    const findCol = (names) => columns.find(c => names.some(n => c.toLowerCase().includes(n.toLowerCase())));

    const sellerCol = findCol(['seller']);
    const amountCol = findCol(['amount']);

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
    // Auto-detect column names
    const columns = Object.keys(data[0] || {});
    const findCol = (names) => columns.find(c => names.some(n => c.toLowerCase().includes(n.toLowerCase())));

    const sellerCol = findCol(['seller']);
    const netSalesCol = findCol(['net sales']);
    const cashCol = findCol(['cash sales']);
    const ccCol = findCol(['cc sales', 'credit card']);
    const debitCol = findCol(['debit sales']);
    const txCol = findCol(['total transactions', 'transactions']);
    const voidedSalesCol = findCol(['voided sales']);
    const avgOrderCol = findCol(['average order', 'avg order']);
    const netNumbersCol = findCol(['net numbers', 'net tickets']);

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
                    s.seller.toLowerCase().includes('shopify') ? 'rgba(139, 92, 246, 0.8)' : 'rgba(5, 150, 105, 0.8)'
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
                    backgroundColor: 'rgba(139, 92, 246, 0.8)',
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
                    'rgba(139, 92, 246, 0.8)'
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
function switchPage(pageId) {
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === pageId);
    });
    document.querySelectorAll(".page").forEach(page => {
        page.classList.toggle("active", page.id === `page-${pageId}`);
    });

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
    }
}

// ==================== SETTINGS ====================
function saveSettings() {
    defaultName = document.getElementById("defaultName").value.trim() || "Bella";
    orgName = document.getElementById("orgName").value.trim();

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

    // Show loading state
    const generateBtn = document.getElementById("generateBtn");
    generateBtn.disabled = true;
    generateBtn.innerHTML = `<span class="btn-icon">⏳</span> Generating...`;

    const responseArea = document.getElementById("responseArea");
    responseArea.innerHTML = `
        <div class="loading">
            <div class="spinner"></div>
            <div class="loading-text">Analyzing inquiry and generating response...</div>
        </div>
    `;

    const startTime = Date.now();

    try {
        const allKnowledge = getAllKnowledge();
        const response = await generateCustomResponse(
            customerEmail, allKnowledge, staffName,
            { toneValue, lengthValue, includeLinks, includeSteps }
        );

        const responseTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const category = detectCategory(customerEmail);

        // Save to history
        const historyEntry = {
            id: `history-${Date.now()}`,
            inquiry: customerEmail,
            response: response,
            staffName: staffName,
            category: category,
            timestamp: new Date().toISOString(),
            responseTime: parseFloat(responseTime),
            rating: null
        };
        responseHistory.unshift(historyEntry);
        if (responseHistory.length > 100) responseHistory.pop();

        currentResponse = response;
        currentInquiry = customerEmail;
        currentHistoryId = historyEntry.id;

        // Save user data with updated history
        saveUserData();

        displayResults(response, historyEntry.id);

    } catch (error) {
        console.error("Error:", error);
        showError(error.message || "Something went wrong. Please check your API key and try again.");
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
    let all = [];
    if (typeof KNOWLEDGE_BASE !== 'undefined') {
        all = [...KNOWLEDGE_BASE["5050"], ...KNOWLEDGE_BASE["cta"]];
    }
    return [...all, ...customKnowledge];
}

async function generateCustomResponse(customerEmail, knowledge, staffName, options) {
    const { toneValue, lengthValue, includeLinks, includeSteps } = options;
    const isFacebook = inquiryType === "facebook";

    const toneDesc = toneValue < 33 ? "formal and professional" :
                     toneValue > 66 ? "warm and friendly" : "balanced";
    const lengthDesc = isFacebook ? "very brief (MUST be under 400 characters total)" :
                       lengthValue < 33 ? "brief and concise" :
                       lengthValue > 66 ? "detailed and thorough" : "moderate length";

    const knowledgeContext = knowledge.slice(0, 30).map(k =>
        `Topic: ${k.question}\nKeywords: ${k.keywords.join(", ")}\nResponse:\n${k.response}`
    ).join("\n\n---\n\n");

    // Get draw schedule context
    let drawScheduleContext = "";
    if (typeof DRAW_SCHEDULE !== 'undefined') {
        drawScheduleContext = DRAW_SCHEDULE.getAIContext();
    }

    // Format instructions based on inquiry type
    let formatInstructions = "";
    if (isFacebook) {
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
- Instead, ALWAYS direct the customer to email us: "Please email us at info@thunderbay5050.ca and our team will assist you as soon as possible."
- You can acknowledge their concern briefly, but the solution must be to email us
- Example: "Sorry to hear you're having trouble! Please email us at info@thunderbay5050.ca and our team will assist you as soon as possible. -${staffName}"`;
    } else {
        formatInstructions = `${includeLinks ? "LINKS: Include relevant website links when helpful (www.thunderbay5050.ca for main site, https://account.tbay5050draw.ca for subscription management)." : "LINKS: Minimize links unless essential."}
${includeSteps ? "FORMAT: Include step-by-step instructions when applicable." : "FORMAT: Use flowing paragraphs, avoid numbered lists unless necessary."}`;
    }

    const systemPrompt = `You are a helpful customer support assistant for Thunder Bay 50/50, an AGCO-licensed lottery supporting the Thunder Bay Regional Health Sciences Foundation.

TONE: Write in a ${toneDesc} tone.
LENGTH: Keep the response ${lengthDesc}.
${formatInstructions}

ORGANIZATION INFO:
- Organization: the Thunder Bay Regional Health Sciences Foundation (ALWAYS include "the" before the name)
- Lottery Website: www.thunderbay5050.ca (ONLY use this URL - do NOT make up other URLs)
- Subscription Management: https://account.tbay5050draw.ca
- All draws happen at 11:00 AM
- Ticket purchase deadline: 11:59 PM the night before each draw

IMPORTANT: Only use the URLs listed above. Do NOT invent or guess other URLs like "tbrhsf.on.ca" or similar - they don't exist. If you need to reference a website, use www.thunderbay5050.ca.
IMPORTANT: Always say "the Thunder Bay Regional Health Sciences Foundation" - the word "the" before the name is required.

${drawScheduleContext}

Key facts about AGCO-licensed lotteries:
- 50/50 lotteries: Typically monthly, tickets valid for one draw period only
- Catch the Ace: Weekly progressive jackpot lottery, tickets must be purchased each week
- All AGCO-licensed lotteries require being physically in Ontario to purchase
- Winners are contacted directly by phone
- Tax receipts cannot be issued (lottery tickets aren't charitable donations under CRA rules)
- EastLink internet users experiencing location issues should contact EastLink at 1-888-345-1111
- Customers CANNOT log in to view their tickets - they can only log in to manage their subscription. Tickets are only available via the confirmation email.

DRAW DATE AWARENESS: If the customer asks about draw dates, Early Birds, or when the next draw is, use the draw schedule information above to give them accurate, specific dates. If there's an Early Bird draw happening today or tomorrow and it's relevant to mention, include that information naturally (e.g., "Don't forget there's a $10,000 Early Bird draw tomorrow!").

ESCALATION: If the inquiry is unclear, bizarre, nonsensical, confrontational, threatening, or simply cannot be answered with the knowledge available, write a polite response explaining that you will pass the email along to your manager who can look into it further. Do not attempt to answer questions you don't have information for.

Knowledge base:

${knowledgeContext}`;

    let userPrompt;
    if (isFacebook) {
        userPrompt = `Write a FACEBOOK COMMENT reply to this inquiry. Remember: under 400 characters, single paragraph, end with -${staffName}

IMPORTANT: Do NOT offer to take any direct action. Instead, direct them to email info@thunderbay5050.ca for assistance.

INQUIRY:
${customerEmail}`;
    } else {
        userPrompt = `Write a response to this inquiry. Detect which lottery it's about from context.

INQUIRY:
${customerEmail}

Sign as: ${staffName}`;
    }

    const response = await fetch(`${API_BASE_URL}/api/generate`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            max_tokens: isFacebook ? 200 : 1024
        })
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "API request failed. Please try again.");
    }

    const data = await response.json();
    return data.content[0].text;
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
            <div class="response-box" id="responseText">${escapeHtml(response)}</div>
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

        const systemPrompt = `You are a helpful assistant that refines customer support responses.
You will be given an original customer inquiry, the current response, and an instruction for how to modify it.

IMPORTANT RULES:
- Keep the same general meaning and information, just adjust based on the instruction
- Maintain a professional, helpful tone
- Keep the response appropriate for customer support
- If this is a Facebook response, keep it under 400 characters and end with -${defaultName}
${isFacebook ? '- Facebook responses should be a single paragraph with no line breaks' : ''}
- Do NOT add information that wasn't in the original response unless specifically asked
- Only output the refined response, nothing else`;

        const userPrompt = `ORIGINAL CUSTOMER INQUIRY:
${currentInquiry}

CURRENT RESPONSE:
${currentResponse}

INSTRUCTION: ${instruction.trim()}

Please provide the refined response:`;

        const response = await fetch(`${API_BASE_URL}/api/claude`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system: systemPrompt,
                messages: [{ role: "user", content: userPrompt }],
                max_tokens: isFacebook ? 200 : 1024
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || "Refinement failed. Please try again.");
        }

        const data = await response.json();
        const refinedResponse = data.content[0].text;

        // Update current response
        currentResponse = refinedResponse;

        // Update the response in history
        const historyEntry = responseHistory.find(h => h.id === currentHistoryId);
        if (historyEntry) {
            historyEntry.response = refinedResponse;
            saveUserData();
        }

        // Update the display
        responseBox.innerText = refinedResponse;

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

    // Length check
    const wordCount = response.split(/\s+/).length;
    if (wordCount < 20) {
        checks.push({ status: 'quality-warn', message: 'Response may be too brief' });
    } else if (wordCount > 300) {
        checks.push({ status: 'quality-warn', message: 'Response may be too long' });
    } else {
        checks.push({ status: 'quality-pass', message: 'Response length is appropriate' });
    }

    // Greeting check
    if (response.toLowerCase().includes('hi there') || response.toLowerCase().includes('hello') || response.toLowerCase().includes('hi,')) {
        checks.push({ status: 'quality-pass', message: 'Includes greeting' });
    } else {
        checks.push({ status: 'quality-warn', message: 'Consider adding a greeting' });
    }

    // Sign-off check
    if (response.includes('thank') || response.includes('Thank')) {
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

    return checks;
}

function rateResponse(historyId, rating, button) {
    const entry = responseHistory.find(h => h.id === historyId);
    if (entry) {
        entry.rating = rating;
        saveUserData();
    }

    // Update UI
    const parent = button.parentElement;
    parent.querySelectorAll('.rating-btn').forEach(btn => btn.classList.remove('selected'));
    button.classList.add('selected');
}

function saveToFavorites() {
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
        alert("No valid inquiries found in the file.");
        return;
    }

    if (inquiries.length > 50) {
        alert("Maximum 50 inquiries per batch. Only the first 50 will be processed.");
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
            const response = await generateCustomResponse(
                inquiries[i], allKnowledge, staffName,
                { toneValue: 50, lengthValue: 50, includeLinks: true, includeSteps: false }
            );
            bulkResults.push({ inquiry: inquiries[i], response: response, error: null });
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

function deleteFavorite(id) {
    if (confirm("Delete this favorite?")) {
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

function updateAnalytics() {
    // Get ALL users' response history for team-wide analytics
    const allHistory = getAllUsersResponseHistory();

    // Total responses (team-wide)
    document.getElementById("analyticsTotal").textContent = allHistory.length;

    // Today's responses (team-wide)
    const today = new Date().toDateString();
    const todayCount = allHistory.filter(h =>
        new Date(h.timestamp).toDateString() === today
    ).length;
    document.getElementById("analyticsToday").textContent = todayCount;

    // Positive rating percentage (team-wide)
    const rated = allHistory.filter(h => h.rating);
    const positive = rated.filter(h => h.rating === 'positive').length;
    const percentage = rated.length > 0 ? Math.round(positive / rated.length * 100) : 0;
    document.getElementById("analyticsPositive").textContent = `${percentage}%`;

    // Average response time (team-wide)
    const times = allHistory.filter(h => h.responseTime).map(h => h.responseTime);
    const avgTime = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 0;
    document.getElementById("analyticsAvgTime").textContent = `${avgTime}s`;

    // Category chart (team-wide)
    const categories = {};
    allHistory.forEach(h => {
        categories[h.category || 'general'] = (categories[h.category || 'general'] || 0) + 1;
    });

    const maxCount = Math.max(...Object.values(categories), 1);
    const chartHtml = Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cat, count]) => `
            <div class="bar-item">
                <div class="bar-label">${cat.charAt(0).toUpperCase() + cat.slice(1)}</div>
                <div class="bar-track">
                    <div class="bar-fill" style="width: ${count / maxCount * 100}%"></div>
                </div>
                <div class="bar-value">${count}</div>
            </div>
        `).join('');

    document.getElementById("categoryChart").innerHTML = chartHtml ||
        '<div style="text-align: center; padding: 20px; color: var(--text-muted);">No data yet</div>';

    // Monthly breakdown (team-wide)
    const monthlyData = getMonthlyBreakdown(allHistory);
    const monthlyHtml = monthlyData.length > 0 ? monthlyData.map(month => `
        <div class="monthly-stat-row">
            <div class="monthly-stat-name">${month.name}</div>
            <div class="monthly-stat-count">${month.count} responses</div>
            <div class="monthly-stat-rating">${month.rated > 0 ? Math.round(month.positive / month.rated * 100) + '% positive' : 'No ratings'}</div>
        </div>
    `).join('') : '<div style="text-align: center; padding: 20px; color: var(--text-muted);">No data yet</div>';

    document.getElementById("monthlyBreakdown").innerHTML = monthlyHtml;

    // Team history list (show who generated each response)
    const historyHtml = allHistory.slice(0, 15).map(h => `
        <div class="history-item" onclick="showHistoryDetail('${h.id}')">
            <div class="history-header">
                <span class="history-type">${h.category || 'general'}</span>
                <span class="history-date">${new Date(h.timestamp).toLocaleDateString()}</span>
            </div>
            <div class="history-preview">${escapeHtml((h.inquiry || '').substring(0, 100))}...</div>
            <div class="history-meta">
                <span>👤 ${h.userName || h.staffName || 'Unknown'}</span>
                <span>⏱️ ${h.responseTime || 0}s</span>
                ${h.rating ? `<span>${h.rating === 'positive' ? '👍' : '👎'}</span>` : ''}
            </div>
        </div>
    `).join('');

    document.getElementById("historyList").innerHTML = historyHtml ||
        '<div style="text-align: center; padding: 40px; color: var(--text-muted);">No response history yet.</div>';

    // Render leaderboard
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
                ${escapeHtml(item.response)}
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
    let total5050 = 0, totalCta = 0;

    if (typeof KNOWLEDGE_BASE !== 'undefined') {
        total5050 = KNOWLEDGE_BASE["5050"].length;
        totalCta = KNOWLEDGE_BASE["cta"].length;
    }

    customKnowledge.forEach(k => {
        if (k.lottery === "5050") total5050++;
        else if (k.lottery === "cta") totalCta++;
        else { total5050++; totalCta++; }
    });

    document.getElementById("statTotal").textContent = total5050 + totalCta;
    document.getElementById("stat5050").textContent = total5050;
    document.getElementById("statCta").textContent = totalCta;
}

function renderKnowledgeList(searchQuery = "") {
    const container = document.getElementById("knowledgeList");
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
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                ${searchQuery ? "No matching entries found." : "No knowledge entries yet."}
            </div>
        `;
        return;
    }

    container.innerHTML = items.slice(0, 50).map((k, i) => `
        <div class="knowledge-item">
            <div class="knowledge-item-content">
                <div class="knowledge-item-question">${escapeHtml(k.question)}</div>
                <div class="knowledge-item-preview">${escapeHtml(k.response.substring(0, 120))}...</div>
                <div class="knowledge-item-meta">
                    <span class="knowledge-tag">${k.lottery === "5050" ? "50/50" : k.lottery === "cta" ? "CTA" : "Both"}</span>
                    ${k.isCustom ? '<span class="knowledge-tag" style="background: #dcfce7;">Custom</span>' : ''}
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

function addKnowledge() {
    const lottery = document.getElementById("knowledgeLottery").value;
    const category = document.getElementById("knowledgeCategory").value;
    const question = document.getElementById("knowledgeQuestion").value.trim();
    const keywords = document.getElementById("knowledgeKeywords").value.split(",").map(k => k.trim().toLowerCase()).filter(k => k);
    const response = document.getElementById("knowledgeResponse").value.trim();

    if (!question || !response) {
        alert("Please fill in the question and response fields.");
        return;
    }

    const newEntry = {
        id: `custom-${Date.now()}`,
        lottery: lottery,
        category: category,
        question: question,
        keywords: keywords.length > 0 ? keywords : question.toLowerCase().split(" ").filter(w => w.length > 3),
        response: response,
        dateAdded: new Date().toISOString()
    };

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

function deleteKnowledge(id) {
    if (confirm("Delete this knowledge entry?")) {
        customKnowledge = customKnowledge.filter(k => k.id !== id);
        saveUserData();
        updateKnowledgeStats();
        renderKnowledgeList();
        showToast("Knowledge entry deleted", "success");
    }
}

function parseAndImportKnowledge() {
    const content = document.getElementById("importContent").value.trim();
    if (!content) {
        alert("Please paste some content to import.");
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
        alert("Could not parse any Q&A pairs from the content. Try formatting with clear question/answer sections.");
        return;
    }

    // Add to knowledge base
    pairs.forEach(pair => {
        const newEntry = {
            id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            lottery: "both",
            category: "general",
            question: pair.question,
            keywords: pair.question.toLowerCase().split(" ").filter(w => w.length > 3),
            response: pair.response,
            dateAdded: new Date().toISOString()
        };
        customKnowledge.push(newEntry);
    });

    saveUserData();

    document.getElementById("importModal").classList.remove("show");
    document.getElementById("importContent").value = "";

    updateKnowledgeStats();
    renderKnowledgeList();

    showToast(`Imported ${pairs.length} knowledge entries!`, "success");
}

// ==================== FEEDBACK ====================
function submitFeedback() {
    const name = document.getElementById("feedbackName").value.trim();
    const email = document.getElementById("feedbackEmail").value.trim();
    const type = document.getElementById("feedbackType").value;
    const message = document.getElementById("feedbackMessage").value.trim();

    if (!name || !message) {
        alert("Please fill in your name and feedback message.");
        return;
    }

    const feedback = {
        id: `feedback-${Date.now()}`,
        name, email, type, message,
        dateSubmitted: new Date().toISOString()
    };

    feedbackList.push(feedback);
    saveUserData();

    // Clear form
    document.getElementById("feedbackName").value = "";
    document.getElementById("feedbackEmail").value = "";
    document.getElementById("feedbackMessage").value = "";

    document.getElementById("feedbackSuccess").style.display = "flex";
    setTimeout(() => document.getElementById("feedbackSuccess").style.display = "none", 5000);

    console.log("Feedback submitted:", feedback);
}

// ==================== UTILITIES ====================
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, "<br>");
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

// Draft Assistant uses server-side API (no client-side key needed)

const DRAFT_TYPE_LABELS = {
    'social': 'Social Media Copy',
    'email': 'Email Copy',
    'media-release': 'Media Release',
    'ad': 'Facebook/Instagram Ad'
};

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

const DRAFT_SYSTEM_PROMPT = `You are a professional copywriter for the Thunder Bay Regional Health Sciences Foundation and their Thunder Bay 50/50 lottery program. You write content that is warm, professional, optimistic, exciting, community-focused, trustworthy, fun/playful, and can be urgent when appropriate.

CRITICAL RULES YOU MUST ALWAYS FOLLOW:
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize" instead
- NEVER say how much has been "raised" - instead say "nearly $100 million in prizes have been awarded since January 2021"
- When mentioning impact, ALWAYS use: "Thanks to our donors, event participants, and Thunder Bay 50/50 supporters..." before describing the impact
- Website is always: www.thunderbay5050.ca
- In-store location: Thunder Bay 50/50 store inside the Intercity Shopping Centre
- Must be 18 years or older to purchase
- Must be physically present in Ontario at time of purchase
- The Thunder Bay 50/50 launched in January 2021
- Monthly draws with Early Bird Prizes throughout the month, Grand Prize draw on the last Friday of the month
- Largest Grand Prize ever was $7,720,930 in December 2025
- The Foundation supports capital equipment purchases at the Thunder Bay Regional Health Sciences Centre
- Over $81 million in lifetime contributions to the Hospital
- 11 multi-millionaire winners created to date

KEY PHRASES TO USE:
- "You LOVE the Thunder Bay 50/50, and you might LOVE our other raffles just as much!"
- "Purchase tickets at www.thunderbay5050.ca or inside the Thunder Bay 50/50 store inside the Intercity Shopping Centre!"

PEOPLE WHO GET QUOTED:
- Glenn Craig, President & CEO, Thunder Bay Regional Health Sciences Foundation
- Torin Gunnell, Director, Lotteries

EMOJI USAGE: Minimal - usually just one emoji after the first sentence/paragraph. Never overuse.

CONTENT TYPE SPECIFIC RULES:

FOR SOCIAL MEDIA:
- Lead with excitement or key announcement
- Keep it punchy but informative
- Include the disclaimer: "Must be 18 years or older to purchase: Lottery Licence RAF1500864" (or current licence number)
- One emoji max, placed after first paragraph

FOR EMAIL:
- Less "corporate" - more fun and conversational
- Personal tone, like writing to a friend who supports healthcare
- Can be longer and more detailed

FOR MEDIA RELEASES:
- Professional journalistic style
- Include quotes from Glenn Craig or Torin Gunnell
- Structure: Lead paragraph with key news, supporting details, quotes, background info
- End with "About" boilerplate if appropriate

FOR FACEBOOK/INSTAGRAM ADS:
- MAXIMUM 120 characters
- MUST include www.thunderbay5050.ca
- Focus on urgency and excitement
- Goal is always ticket sales
- One emoji allowed`;

// Email-specific system prompts based on category
const EMAIL_SYSTEM_PROMPTS = {
    'new-draw': `You are a professional email copywriter for the Thunder Bay 50/50 lottery. You write NEW DRAW ANNOUNCEMENT emails that announce the launch of a new monthly draw.

CRITICAL RULES:
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize" instead
- Website: www.thunderbay5050.ca
- In-store: Thunder Bay 50/50 store inside the Intercity Shopping Centre
- Must be 18+ and physically in Ontario to purchase
- The Thunder Bay 50/50 launched in January 2021
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
- "Check out our two other raffles! You LOVE the Thunder Bay 50/50, and you might LOVE our other raffles just as much!"

SUBJECT LINE STYLE:
- Use dollar amounts and emojis
- Examples: "$125K IN EARLY BIRDS!❄️" or "$70K IN EARLY BIRDS THIS WEEK!💰"

EMAIL STRUCTURE:
1. Exciting opener with key announcement
2. Numbered list of key details about the draw
3. Buy tickets CTA button/link
4. Mention other raffles (Catch The Ace, Pink Jeep if applicable)
5. Standard footer with lottery licence`,

    'draw-reminder': `You are a professional email copywriter for the Thunder Bay 50/50 lottery. You write DRAW REMINDER emails that remind subscribers about upcoming draws.

CRITICAL RULES:
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize" instead
- Website: www.thunderbay5050.ca
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

    'winners': `You are a professional email copywriter for the Thunder Bay 50/50 lottery. You write WINNER ANNOUNCEMENT emails that celebrate and announce draw winners.

CRITICAL RULES:
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize" instead
- Website: www.thunderbay5050.ca
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

    'impact-sunday': `You are a professional email copywriter for the Thunder Bay Regional Health Sciences Foundation. You write IMPACT SUNDAY emails that show donors how their 50/50 ticket purchases make a real difference in healthcare.

CRITICAL RULES:
- This is about DONOR IMPACT, not about winning money
- Focus on the equipment purchased or program funded
- Include quotes from hospital staff whenever possible
- Link to the Impact page: https://www.healthsciencesfoundation.ca/our-impact
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize"
- Always thank donors for making this possible

TONE & STYLE for Impact Sunday:
- Warm, grateful, and inspiring
- Tell the STORY of the equipment/funding and its impact
- Make it personal - mention specific departments, staff names, patient benefits
- Use phrases like "Thanks to our donors, event participants, and Thunder Bay 50/50 supporters..."
- Show the connection between ticket purchases and healthcare improvements

COMMON PHRASES TO USE:
- "IMPACT SUNDAY: You helped make this possible!💙"
- "Thanks to our donors, event participants, and Thunder Bay 50/50 supporters..."
- "Your support of the Thunder Bay 50/50 directly funds..."
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

    'last-chance': `You are a professional email copywriter for the Thunder Bay 50/50 lottery. You write LAST CHANCE emails that create urgency for final ticket purchases before major deadlines.

CRITICAL RULES:
- NEVER use the word "jackpot" - ALWAYS say "Grand Prize" instead
- Website: www.thunderbay5050.ca
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

// Helper function to build enhanced system prompt with examples from knowledge base
function buildEnhancedSystemPrompt(contentType, emailType = null) {
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

    // Add examples from knowledge base if available
    if (typeof DRAFT_KNOWLEDGE_BASE !== 'undefined' && knowledgeBaseType) {
        const examples = DRAFT_KNOWLEDGE_BASE.formatExamplesForPrompt(knowledgeBaseType, 2);
        const brandGuidelines = DRAFT_KNOWLEDGE_BASE.getBrandGuidelinesPrompt();

        if (examples) {
            basePrompt += '\n\n' + brandGuidelines;
            basePrompt += '\n\nHere are examples of this type of content. Match this style and format:';
            basePrompt += examples;
        }
    }

    return basePrompt;
}

function setupDraftAssistant() {
    if (draftAssistantInitialized) return;
    draftAssistantInitialized = true;

    // Content type buttons
    document.querySelectorAll('.draft-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectDraftType(btn.dataset.type);
        });
    });

    // Tone buttons
    document.querySelectorAll('.draft-tone-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.draft-tone-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentDraftTone = btn.dataset.tone;
        });
    });

    // Change type button (for non-email types)
    document.getElementById('draftChangeType').addEventListener('click', () => {
        document.getElementById('draftInputSection').style.display = 'none';
        document.getElementById('draftTypeSection').style.display = 'block';
        document.getElementById('draftHeaderActions').style.display = 'none';
    });

    // Change type button for email section
    document.getElementById('draftEmailChangeType').addEventListener('click', () => {
        document.getElementById('draftEmailTypeSection').style.display = 'none';
        document.getElementById('draftTypeSection').style.display = 'block';
        document.getElementById('draftHeaderActions').style.display = 'none';
        currentEmailType = null;
    });

    // Email type dropdown change handler
    document.getElementById('draftEmailTypeSelect').addEventListener('change', (e) => {
        const emailType = e.target.value;
        currentEmailType = emailType;

        const impactContext = document.getElementById('impactSundayContext');
        const keyDetails = document.getElementById('emailKeyDetails');
        const emailAddons = document.getElementById('emailAddonsSection');
        const generateBtn = document.getElementById('draftEmailGenerateBtn');

        if (emailType === '') {
            // No selection
            impactContext.style.display = 'none';
            keyDetails.style.display = 'none';
            emailAddons.style.display = 'none';
            generateBtn.disabled = true;
        } else if (emailType === 'impact-sunday') {
            // Show Impact Sunday context, hide key details
            impactContext.style.display = 'block';
            keyDetails.style.display = 'none';
            emailAddons.style.display = 'block';
            generateBtn.disabled = false;
        } else {
            // Show key details with appropriate placeholder
            impactContext.style.display = 'none';
            keyDetails.style.display = 'block';
            emailAddons.style.display = 'block';
            document.getElementById('emailDetailsLabel').textContent = EMAIL_DETAILS_LABELS[emailType];
            document.getElementById('draftEmailDetails').placeholder = EMAIL_DETAILS_PLACEHOLDERS[emailType];
            generateBtn.disabled = false;
        }
    });

    // Email generate button
    document.getElementById('draftEmailGenerateBtn').addEventListener('click', generateEmailDraft);

    // Quote toggles (for multiple quotes)
    document.querySelectorAll('.draft-quote-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const quoteNum = btn.dataset.quote;
            const fields = document.getElementById('draftQuoteFields' + quoteNum);
            if (fields.style.display === 'none') {
                fields.style.display = 'flex';
                btn.textContent = '− Remove';
            } else {
                fields.style.display = 'none';
                btn.textContent = '+ Add Quote';
                // Clear the fields when closing
                const nameInput = document.querySelector('.draft-quote-name[data-quote="' + quoteNum + '"]');
                const titleInput = document.querySelector('.draft-quote-title[data-quote="' + quoteNum + '"]');
                const textInput = document.querySelector('.draft-quote-text[data-quote="' + quoteNum + '"]');
                if (nameInput) nameInput.value = '';
                if (titleInput) titleInput.value = '';
                if (textInput) textInput.value = '';
            }
        });
    });

    // Generate button (for non-email types)
    document.getElementById('draftGenerateBtn').addEventListener('click', generateDraft);

    // Copy button
    document.getElementById('draftCopyBtn').addEventListener('click', () => {
        const content = document.getElementById('draftOutputContent').textContent;
        navigator.clipboard.writeText(content).then(() => {
            showToast('Copied to clipboard!', 'success');
        });
    });

    // Regenerate button
    document.getElementById('draftRegenerateBtn').addEventListener('click', () => {
        if (lastDraftRequest) {
            if (lastDraftRequest.isEmail) {
                generateEmailDraft();
            } else {
                generateDraft();
            }
        }
    });

    // Refine chips
    document.querySelectorAll('.draft-refine-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const instruction = chip.dataset.instruction;
            refineDraft(instruction);
        });
    });

    // Refine button (custom input)
    document.getElementById('draftRefineBtn').addEventListener('click', () => {
        const input = document.getElementById('draftRefineInput');
        const instruction = input.value.trim();
        if (instruction) {
            refineDraft(instruction);
            input.value = '';
        }
    });

    // Refine input - allow Enter key
    document.getElementById('draftRefineInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const instruction = e.target.value.trim();
            if (instruction) {
                refineDraft(instruction);
                e.target.value = '';
            }
        }
    });

    // New draft button
    document.getElementById('draftNewBtn').addEventListener('click', resetDraftAssistant);

}

function selectDraftType(type) {
    currentDraftType = type;
    document.getElementById('draftTypeSection').style.display = 'none';

    // For email type, show the email-specific workflow
    if (type === 'email') {
        document.getElementById('draftEmailTypeSection').style.display = 'block';
        document.getElementById('draftInputSection').style.display = 'none';
        // Reset email form
        document.getElementById('draftEmailTypeSelect').value = '';
        document.getElementById('impactSundayContext').style.display = 'none';
        document.getElementById('emailKeyDetails').style.display = 'none';
        document.getElementById('draftEmailGenerateBtn').disabled = true;
        document.getElementById('draftImpactContext').value = '';
        document.getElementById('draftEmailDetails').value = '';
        currentEmailType = null;
        return;
    }

    // For other types, show the regular input section
    document.getElementById('draftEmailTypeSection').style.display = 'none';
    document.getElementById('draftInputSection').style.display = 'block';
    document.getElementById('draftTypeBadge').textContent = DRAFT_TYPE_LABELS[type];

    // Show/hide quote section for media releases
    const quoteSection = document.getElementById('draftQuoteSection');
    if (type === 'media-release') {
        quoteSection.style.display = 'block';
    } else {
        quoteSection.style.display = 'none';
    }

    // Reset all quote fields (1-5)
    for (let i = 1; i <= 5; i++) {
        const fields = document.getElementById('draftQuoteFields' + i);
        const toggle = document.querySelector('.draft-quote-toggle[data-quote="' + i + '"]');
        if (fields) fields.style.display = 'none';
        if (toggle) toggle.textContent = '+ Add Quote';
    }
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
        const requiredLine = typeof DRAFT_KNOWLEDGE_BASE !== 'undefined'
            ? DRAFT_KNOWLEDGE_BASE.getSocialMediaRequiredLine()
            : 'Purchase tickets online at www.thunderbay5050.ca or at the Thunder Bay 50/50 store inside the Intercity Shopping Centre!';
        userPrompt += '\n\nIMPORTANT: You MUST include this exact line in the post: "' + requiredLine + '"';
    }
    userPrompt += quoteInfo;
    userPrompt += "\n\nTone: " + currentDraftTone;

    if (currentDraftType === 'ad') {
        userPrompt += "\n\nREMEMBER: Maximum 120 characters and MUST include www.thunderbay5050.ca";
    }

    lastDraftRequest = { topic, details, quoteInfo };

    // Show loading
    document.getElementById('draftInputSection').style.display = 'none';
    document.getElementById('draftLoading').style.display = 'block';
    document.getElementById('draftHeaderActions').style.display = 'none';

    try {
        // Build enhanced system prompt with examples from knowledge base
        const enhancedSystemPrompt = buildEnhancedSystemPrompt(currentDraftType);

        const response = await fetch(API_BASE_URL + '/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                system: enhancedSystemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
                max_tokens: 1024
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'API request failed');
        }

        const data = await response.json();
        const generatedContent = data.content[0].text;

        // Show output
        document.getElementById('draftLoading').style.display = 'none';
        document.getElementById('draftOutputSection').style.display = 'block';
        document.getElementById('draftOutputBadge').textContent = DRAFT_TYPE_LABELS[currentDraftType];
        document.getElementById('draftOutputContent').textContent = generatedContent;
        document.getElementById('draftHeaderActions').style.display = 'flex';

        // Show disclaimer for ads
        const disclaimer = document.getElementById('draftDisclaimer');
        if (currentDraftType === 'ad') {
            const charCount = generatedContent.length;
            disclaimer.innerHTML = 'Character count: ' + charCount + '/120 ' + (charCount > 120 ? '⚠️ Over limit!' : '✅');
            disclaimer.style.display = 'block';
        } else {
            disclaimer.innerHTML = '⚠️ Always review AI-generated content before publishing. Verify all facts, dates, and figures.';
            disclaimer.style.display = 'block';
        }

    } catch (error) {
        console.error('Draft generation error:', error);
        document.getElementById('draftLoading').style.display = 'none';
        document.getElementById('draftInputSection').style.display = 'block';
        showToast('Error generating draft: ' + error.message, 'error');
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
    const addRewardsPlus = document.getElementById('emailAddRewardsPlus').checked;
    const addCatchTheAce = document.getElementById('emailAddCatchTheAce').checked;

    if (addSubscriptions || addRewardsPlus || addCatchTheAce) {
        userPrompt += "\n\nAt the end of the email, include the following additional sections:";

        if (addSubscriptions && typeof DRAFT_KNOWLEDGE_BASE !== 'undefined') {
            userPrompt += "\n\n--- SUBSCRIPTIONS SECTION ---\n" + DRAFT_KNOWLEDGE_BASE.getEmailAddOn('subscriptions');
        }

        if (addRewardsPlus && typeof DRAFT_KNOWLEDGE_BASE !== 'undefined') {
            userPrompt += "\n\n--- REWARDS+ SECTION ---\n" + DRAFT_KNOWLEDGE_BASE.getEmailAddOn('rewards-plus');
        }

        if (addCatchTheAce && typeof DRAFT_KNOWLEDGE_BASE !== 'undefined') {
            userPrompt += "\n\n--- CATCH THE ACE SECTION ---\n" + DRAFT_KNOWLEDGE_BASE.getEmailAddOn('catch-the-ace');
        }
    }

    lastDraftRequest = { isEmail: true, emailType: currentEmailType, details: details, addSubscriptions, addRewardsPlus, addCatchTheAce };

    // Show loading
    document.getElementById('draftEmailTypeSection').style.display = 'none';
    document.getElementById('draftLoading').style.display = 'block';
    document.getElementById('draftHeaderActions').style.display = 'none';

    try {
        // Build enhanced system prompt with examples from knowledge base
        const enhancedSystemPrompt = buildEnhancedSystemPrompt('email', currentEmailType);
        console.log('Calling API at:', API_BASE_URL + '/api/generate');

        const response = await fetch(API_BASE_URL + '/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                system: enhancedSystemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
                max_tokens: 2048
            })
        });

        console.log('API response status:', response.status);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || 'API request failed with status ' + response.status);
        }

        const data = await response.json();
        const generatedContent = data.content[0].text;

        // Show output
        document.getElementById('draftLoading').style.display = 'none';
        document.getElementById('draftOutputSection').style.display = 'block';
        document.getElementById('draftOutputBadge').textContent = '📧 ' + EMAIL_TYPE_LABELS[currentEmailType];
        document.getElementById('draftOutputContent').textContent = generatedContent;
        document.getElementById('draftHeaderActions').style.display = 'flex';

        // Show disclaimer
        const disclaimer = document.getElementById('draftDisclaimer');
        disclaimer.innerHTML = '⚠️ Always review AI-generated content before publishing. Verify all facts, dates, and figures.';
        disclaimer.style.display = 'block';

    } catch (error) {
        console.error('Email draft generation error:', error);
        document.getElementById('draftLoading').style.display = 'none';
        document.getElementById('draftEmailTypeSection').style.display = 'block';
        showToast('Error generating email draft: ' + error.message, 'error');
    }
}

function resetDraftAssistant() {
    currentDraftType = null;
    currentDraftTone = 'balanced';
    lastDraftRequest = null;
    currentEmailType = null;

    // Reset form fields
    document.getElementById('draftTopicInput').value = '';
    document.getElementById('draftDetailsInput').value = '';

    // Reset all quote fields (1-5)
    for (let i = 1; i <= 5; i++) {
        const fields = document.getElementById('draftQuoteFields' + i);
        const toggle = document.querySelector('.draft-quote-toggle[data-quote="' + i + '"]');
        const nameInput = document.querySelector('.draft-quote-name[data-quote="' + i + '"]');
        const titleInput = document.querySelector('.draft-quote-title[data-quote="' + i + '"]');
        const textInput = document.querySelector('.draft-quote-text[data-quote="' + i + '"]');
        if (fields) fields.style.display = 'none';
        if (toggle) toggle.textContent = '+ Add Quote';
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
    document.getElementById('draftEmailGenerateBtn').disabled = true;

    // Reset email add-ons
    document.getElementById('emailAddonsSection').style.display = 'none';
    document.getElementById('emailAddSubscriptions').checked = false;
    document.getElementById('emailAddRewardsPlus').checked = false;
    document.getElementById('emailAddCatchTheAce').checked = false;

    // Reset tone buttons
    document.querySelectorAll('.draft-tone-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.draft-tone-btn[data-tone="balanced"]').classList.add('active');

    // Reset refine input
    document.getElementById('draftRefineInput').value = '';

    // Show type selection
    document.getElementById('draftOutputSection').style.display = 'none';
    document.getElementById('draftInputSection').style.display = 'none';
    document.getElementById('draftEmailTypeSection').style.display = 'none';
    document.getElementById('draftLoading').style.display = 'none';
    document.getElementById('draftTypeSection').style.display = 'block';
    document.getElementById('draftHeaderActions').style.display = 'none';
}

// Store conversation history for refine feature
let draftConversationHistory = [];

async function refineDraft(instruction) {
    const currentContent = document.getElementById('draftOutputContent').textContent;
    if (!currentContent) return;

    // Show loading
    document.getElementById('draftOutputContent').innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);"><div class="draft-spinner"></div><p style="margin-top: 16px;">Refining your draft...</p></div>';

    try {
        // Build the enhanced system prompt
        const enhancedSystemPrompt = lastDraftRequest && lastDraftRequest.isEmail
            ? buildEnhancedSystemPrompt('email', lastDraftRequest.emailType)
            : buildEnhancedSystemPrompt(currentDraftType);

        // Build conversation messages for refinement
        const messages = [
            { role: 'user', content: 'Generate the content as requested.' },
            { role: 'assistant', content: currentContent },
            { role: 'user', content: instruction + '\n\nPlease provide the updated content only, without any explanations or preamble.' }
        ];

        const response = await fetch(API_BASE_URL + '/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                system: enhancedSystemPrompt,
                messages: messages,
                max_tokens: 2048
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || 'API request failed');
        }

        const data = await response.json();
        const refinedContent = data.content[0].text;

        // Update the output
        document.getElementById('draftOutputContent').textContent = refinedContent;

        showToast('Draft refined!', 'success');

    } catch (error) {
        console.error('Draft refinement error:', error);
        // Restore original content
        document.getElementById('draftOutputContent').textContent = currentContent;
        showToast('Error refining draft: ' + error.message, 'error');
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

I understand you'd like to cancel your subscription. You can manage your subscription directly at https://account.tbay5050draw.ca - simply log in with your email and click "Manage Subscription" to cancel.

If you need any assistance with the process, please don't hesitate to reach out!

Best,
[NAME]`
    },
    {
        id: "tpl-4",
        category: "subscription",
        title: "Modify Subscription",
        content: `Hi there,

You can modify your subscription (change the amount or update payment info) by visiting https://account.tbay5050draw.ca and logging in with your email.

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

I understand the confusion! The account login at https://account.tbay5050draw.ca is only for managing your subscription - you cannot view your ticket numbers there.

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

Thank you for your understanding and for supporting the Thunder Bay Regional Health Sciences Foundation!

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
        const content = template.content.replace(/\[NAME\]/g, staffName);
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
    const content = template.content.replace(/\[NAME\]/g, staffName);

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

function renderLeaderboard() {
    const container = document.getElementById("leaderboardContainer");
    if (!container) return;

    const leaderboard = getLeaderboard();

    if (leaderboard.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                No data yet. Generate some responses to see the leaderboard!
            </div>
        `;
        return;
    }

    // Top 3 for podium
    const podiumHtml = leaderboard.length >= 1 ? `
        <div class="leaderboard-podium">
            ${leaderboard[1] ? `
                <div class="podium-item second">
                    <div class="podium-rank">🥈</div>
                    <div class="podium-name">${escapeHtml(leaderboard[1].name)}</div>
                    <div class="podium-count">${leaderboard[1].count} responses</div>
                </div>
            ` : ''}
            <div class="podium-item first">
                <div class="podium-rank">🥇</div>
                <div class="podium-name">${escapeHtml(leaderboard[0].name)}</div>
                <div class="podium-count">${leaderboard[0].count} responses</div>
            </div>
            ${leaderboard[2] ? `
                <div class="podium-item third">
                    <div class="podium-rank">🥉</div>
                    <div class="podium-name">${escapeHtml(leaderboard[2].name)}</div>
                    <div class="podium-count">${leaderboard[2].count} responses</div>
                </div>
            ` : ''}
        </div>
    ` : '';

    // Rest of the list (4th place and below)
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

function setupListNormalizerListeners() {
    if (listNormalizerListenersSetup) return;

    const dropzone = document.getElementById("normalizerDropzone");
    const fileInput = document.getElementById("normalizerFileInput");

    if (!dropzone || !fileInput) {
        console.error("List Normalizer elements not found");
        return;
    }

    listNormalizerListenersSetup = true;
    console.log("Setting up List Normalizer listeners...");

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

    console.log("List Normalizer listeners attached successfully");
}

function processNormalizerFile(file) {
    if (!file.name.match(/\.xlsx?$/i) && !file.name.match(/\.csv$/i)) {
        showToast("Please upload an Excel file (.xlsx or .xls)", "error");
        return;
    }

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
    // Auto-detect column names
    const columns = Object.keys(rawData[0] || {});
    const findCol = (names) => columns.find(c => names.some(n => c.toLowerCase().includes(n.toLowerCase())));

    const firstNameCol = findCol(['first name', 'firstname', 'first']);
    const lastNameCol = findCol(['last name', 'lastname', 'last']);
    const emailCol = findCol(['e-mail', 'email']);

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
            const firstName = row[firstNameCol] ? String(row[firstNameCol]).trim() : '';
            const lastName = lastNameCol && row[lastNameCol] ? String(row[lastNameCol]).trim() : '';

            // Handle cases where full name might be in first name field
            let fullName = firstName;
            if (lastName && lastName !== '.' && lastName !== '-') {
                fullName = firstName + ' ' + lastName;
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
}

function resetListNormalizer() {
    normalizerProcessedData = null;
    document.getElementById("normalizerUploadSection").style.display = "block";
    document.getElementById("normalizerProcessing").style.display = "none";
    document.getElementById("normalizerResults").style.display = "none";
    document.getElementById("normalizerFileInput").value = '';
}

// ==================== PARALLAX & SCROLL ANIMATIONS ====================

function initParallaxAndAnimations() {
    const landingPage = document.getElementById('landingPage');
    const parallaxOrbs = document.querySelectorAll('.parallax-orb');

    // Parallax effect on scroll
    if (landingPage && parallaxOrbs.length > 0) {
        landingPage.addEventListener('scroll', () => {
            const scrollY = landingPage.scrollTop;

            parallaxOrbs.forEach(orb => {
                const speed = parseFloat(orb.dataset.speed) || 0.03;
                const yPos = scrollY * speed;
                orb.style.transform = `translateY(${yPos}px)`;
            });
        });
    }

    // Scroll-triggered fade-in animations
    const animatedElements = document.querySelectorAll('.animate-on-scroll');

    if (animatedElements.length > 0 && landingPage) {
        const observerOptions = {
            root: landingPage,
            rootMargin: '0px 0px -100px 0px',
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
}

// ==================== INIT ====================
document.addEventListener("DOMContentLoaded", () => {
    init();
    initParallaxAndAnimations();
});

