// Lightspeed by Launchpad Solutions v2.2
// AI-Powered Customer Support Tool with User Authentication

// ==================== API CONFIGURATION ====================
// Change this to your deployed backend URL (e.g., https://lightspeed-api.onrender.com)
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'  // Local development
    : 'https://lightspeed-api-af19.onrender.com';  // Production
// ==================== AUTH STATE ====================
let currentUser = null;
let users = JSON.parse(localStorage.getItem("lightspeed_users") || "[]");

// ==================== APP STATE ====================
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

// ==================== INITIALIZATION ====================
function init() {
    // Setup auth event listeners first
    setupAuthEventListeners();

    // Check if user is logged in
    const savedUserId = localStorage.getItem("lightspeed_current_user");
    if (savedUserId) {
        const user = users.find(u => u.id === savedUserId);
        if (user) {
            loginUser(user, false); // false = don't show message
            return;
        }
    }

    // Check if user has visited before (for hero page)
    const hasVisited = localStorage.getItem("has_visited");
    if (!hasVisited) {
        // Show hero page for first time visitors
        document.getElementById("heroPage").classList.remove("hidden");
    } else {
        // Show login page for returning visitors who aren't logged in
        document.getElementById("heroPage").classList.add("hidden");
        showLoginPage();
    }

    // Setup all event listeners
    setupEventListeners();
}

function setupAuthEventListeners() {
    // Hero CTA - show login/register
    document.getElementById("heroCtaBtn").addEventListener("click", () => {
        localStorage.setItem("has_visited", "true");
        document.getElementById("heroPage").classList.add("hidden");
        showLoginPage();
    });

    // Switch between login and register
    document.getElementById("showRegister").addEventListener("click", showRegisterPage);
    document.getElementById("showLogin").addEventListener("click", showLoginPage);

    // Login form
    document.getElementById("loginForm").addEventListener("submit", handleLogin);

    // Register form
    document.getElementById("registerForm").addEventListener("submit", handleRegister);

    // User menu
    document.getElementById("userMenuBtn").addEventListener("click", toggleUserDropdown);
    document.getElementById("logoutBtn").addEventListener("click", handleLogout);
    document.getElementById("accountBtn").addEventListener("click", () => {
        closeUserDropdown();
        document.getElementById("settingsModal").classList.add("show");
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
        const userMenu = document.getElementById("userMenuBtn");
        const dropdown = document.getElementById("userDropdown");
        if (!userMenu.contains(e.target) && !dropdown.contains(e.target)) {
            closeUserDropdown();
        }
    });
}

function showLoginPage() {
    document.getElementById("loginPage").classList.add("visible");
    document.getElementById("registerPage").classList.remove("visible");
    document.getElementById("mainApp").classList.remove("visible");
    clearAuthForms();
}

function showRegisterPage() {
    document.getElementById("registerPage").classList.add("visible");
    document.getElementById("loginPage").classList.remove("visible");
    document.getElementById("mainApp").classList.remove("visible");
    clearAuthForms();
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

    // Hide auth pages, show app
    document.getElementById("heroPage").classList.add("hidden");
    document.getElementById("loginPage").classList.remove("visible");
    document.getElementById("registerPage").classList.remove("visible");
    document.getElementById("mainApp").classList.add("visible");

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
    localStorage.removeItem("lightspeed_current_user");

    // Reset state
    defaultName = "Bella";
    orgName = "";
    customKnowledge = [];
    feedbackList = [];
    responseHistory = [];
    favorites = [];

    // Show login page
    document.getElementById("mainApp").classList.remove("visible");
    showLoginPage();

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

    // Logo click - just go to generator page (don't log out)
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

    // Dark mode toggle
    document.getElementById("themeToggle").addEventListener("click", toggleDarkMode);

    // Load saved theme
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        document.getElementById("themeToggle").textContent = "☀️";
    }

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
}

// ==================== HERO / NAVIGATION ====================
function enterApp() {
    localStorage.setItem("has_visited", "true");
    document.getElementById("heroPage").classList.add("hidden");
    document.getElementById("mainApp").classList.add("visible");
}

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

    const toneDesc = toneValue < 33 ? "formal and professional" :
                     toneValue > 66 ? "warm and friendly" : "balanced";
    const lengthDesc = lengthValue < 33 ? "brief and concise" :
                       lengthValue > 66 ? "detailed and thorough" : "moderate length";

    const knowledgeContext = knowledge.slice(0, 30).map(k =>
        `Topic: ${k.question}\nKeywords: ${k.keywords.join(", ")}\nResponse:\n${k.response}`
    ).join("\n\n---\n\n");

    const systemPrompt = `You are a helpful customer support assistant for hospital lotteries and charitable gaming raffles. These are AGCO-licensed lotteries supporting healthcare organizations.

TONE: Write in a ${toneDesc} tone.
LENGTH: Keep the response ${lengthDesc}.
${includeLinks ? "LINKS: Include relevant website links when helpful. Use placeholder [WEBSITE] or [ACCOUNT_URL] if specific URLs aren't known." : "LINKS: Minimize links unless essential."}
${includeSteps ? "FORMAT: Include step-by-step instructions when applicable." : "FORMAT: Use flowing paragraphs, avoid numbered lists unless necessary."}

IMPORTANT - PLACEHOLDERS: The knowledge base uses placeholders that should be kept in responses:
- [ORGANIZATION] = The charity/foundation name
- [WEBSITE] = Main lottery website
- [ACCOUNT_URL] = Account management portal
- [DRAW_DAY] = Day of weekly/monthly draws
- [DRAW_TIME] = Time of draws

Key facts about AGCO-licensed lotteries:
- 50/50 lotteries: Typically monthly, tickets valid for one draw period only
- Catch the Ace: Weekly progressive jackpot lottery, tickets must be purchased each week
- All AGCO-licensed lotteries require being physically in Ontario to purchase
- Winners are contacted directly by phone
- Tax receipts cannot be issued (lottery tickets aren't charitable donations under CRA rules)
- EastLink internet users experiencing location issues should contact EastLink at 1-888-345-1111
- Customers CANNOT log in to view their tickets - they can only log in to manage their subscription. Tickets are only available via the confirmation email.

ESCALATION: If the inquiry is unclear, bizarre, nonsensical, confrontational, threatening, or simply cannot be answered with the knowledge available, write a polite response explaining that you will pass the email along to your manager who can look into it further. Do not attempt to answer questions you don't have information for.

Knowledge base:

${knowledgeContext}`;

    const userPrompt = `Write a response to this inquiry. Detect which lottery it's about from context.

INQUIRY:
${customerEmail}

Sign as: ${staffName}`;

    const response = await fetch(`${API_BASE_URL}/api/generate`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            max_tokens: 1024
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

    document.getElementById("responseArea").innerHTML = `
        <div class="response-section">
            <div class="response-header">
                <div class="response-label">
                    <span class="response-label-icon">✨</span>
                    <span class="response-label-text">Ready to Send</span>
                </div>
                <div class="response-actions">
                    <button class="btn-copy" onclick="copyToClipboard('responseText', this)">📋 Copy</button>
                    <button class="btn-copy" onclick="saveToFavorites()">⭐ Save</button>
                </div>
            </div>
            <div class="response-box" id="responseText">${escapeHtml(response)}</div>
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
    `;
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
function updateAnalytics() {
    // Total responses
    document.getElementById("analyticsTotal").textContent = responseHistory.length;

    // Today's responses
    const today = new Date().toDateString();
    const todayCount = responseHistory.filter(h =>
        new Date(h.timestamp).toDateString() === today
    ).length;
    document.getElementById("analyticsToday").textContent = todayCount;

    // Positive rating percentage
    const rated = responseHistory.filter(h => h.rating);
    const positive = rated.filter(h => h.rating === 'positive').length;
    const percentage = rated.length > 0 ? Math.round(positive / rated.length * 100) : 0;
    document.getElementById("analyticsPositive").textContent = `${percentage}%`;

    // Average response time
    const times = responseHistory.filter(h => h.responseTime).map(h => h.responseTime);
    const avgTime = times.length > 0 ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 0;
    document.getElementById("analyticsAvgTime").textContent = `${avgTime}s`;

    // Category chart
    const categories = {};
    responseHistory.forEach(h => {
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

    // History list
    const historyHtml = responseHistory.slice(0, 10).map(h => `
        <div class="history-item" onclick="showHistoryDetail('${h.id}')">
            <div class="history-header">
                <span class="history-type">${h.category || 'general'}</span>
                <span class="history-date">${new Date(h.timestamp).toLocaleDateString()}</span>
            </div>
            <div class="history-preview">${escapeHtml(h.inquiry.substring(0, 100))}...</div>
            <div class="history-meta">
                <span>⏱️ ${h.responseTime}s</span>
                ${h.rating ? `<span>${h.rating === 'positive' ? '👍' : '👎'}</span>` : ''}
            </div>
        </div>
    `).join('');

    document.getElementById("historyList").innerHTML = historyHtml ||
        '<div style="text-align: center; padding: 40px; color: var(--text-muted);">No response history yet.</div>';
}

function showHistoryDetail(id) {
    const item = responseHistory.find(h => h.id === id);
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

// ==================== DARK MODE ====================
function toggleDarkMode() {
    const html = document.documentElement;
    const btn = document.getElementById("themeToggle");

    if (html.getAttribute("data-theme") === "dark") {
        html.removeAttribute("data-theme");
        btn.textContent = "🌙";
        localStorage.setItem("theme", "light");
    } else {
        html.setAttribute("data-theme", "dark");
        btn.textContent = "☀️";
        localStorage.setItem("theme", "dark");
    }
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
                ${new Date(fav.date).toLocaleDateString()}
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

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

// ==================== INIT ====================
document.addEventListener("DOMContentLoaded", init);

