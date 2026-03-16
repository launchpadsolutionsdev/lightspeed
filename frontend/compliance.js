/**
 * Compliance Tool — Frontend Logic
 * AI-powered compliance assistant for charitable lottery operators
 */

(function() {
    'use strict';

    // ============================================================
    // STATE
    // ============================================================
    let complianceState = {
        currentConversationId: null,
        currentJurisdiction: 'ON',
        jurisdictions: [],
        messages: [],
        citations: [],
        isLoading: false,
        initialized: false
    };

    // ============================================================
    // INITIALIZATION
    // ============================================================
    window.initComplianceTool = async function() {
        if (complianceState.initialized) {
            return;
        }

        try {
            // Load jurisdictions
            const resp = await apiFetch('/api/compliance/jurisdictions');
            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                console.error('Compliance jurisdictions API error:', resp.status, errText);
                const messagesEl = document.getElementById('complianceChatMessages');
                if (messagesEl) {
                    messagesEl.innerHTML = '<div style="padding:20px;color:#c62828;text-align:center;">Failed to load Compliance Assistant (HTTP ' + resp.status + '). Please try refreshing the page.</div>';
                }
                return;
            }
            const data = await resp.json();
            complianceState.jurisdictions = data.jurisdictions || [];

            // Populate jurisdiction dropdown
            populateJurisdictionDropdown();

            // Set up event listeners
            setupComplianceListeners();

            // Load welcome message
            await loadWelcomeMessage();

            complianceState.initialized = true;
        } catch (err) {
            console.error('Failed to initialize compliance tool:', err);
            const messagesEl = document.getElementById('complianceChatMessages');
            if (messagesEl) {
                messagesEl.innerHTML = '<div style="padding:20px;color:#c62828;text-align:center;">Failed to load Compliance Assistant. Please try refreshing the page.</div>';
            }
        }
    };

    // ============================================================
    // UI SETUP
    // ============================================================
    function populateJurisdictionDropdown() {
        const select = document.getElementById('complianceJurisdictionSelect');
        if (!select) return;

        select.innerHTML = '';
        complianceState.jurisdictions.forEach(j => {
            const option = document.createElement('option');
            option.value = j.code;
            option.textContent = j.name;
            if (!j.is_active) {
                option.disabled = true;
                option.textContent += ' (Coming soon)';
            }
            if (j.code === complianceState.currentJurisdiction) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        // Update header subtitle
        updateJurisdictionSubtitle();
    }

    function updateJurisdictionSubtitle() {
        const subtitle = document.getElementById('complianceHeaderSubtitle');
        const j = complianceState.jurisdictions.find(j => j.code === complianceState.currentJurisdiction);
        if (subtitle && j) {
            subtitle.textContent = j.name + ' — ' + j.regulatory_body;
        }
    }

    function setupComplianceListeners() {
        // Jurisdiction change
        const select = document.getElementById('complianceJurisdictionSelect');
        if (select) {
            select.addEventListener('change', function() {
                const newCode = this.value;
                if (newCode !== complianceState.currentJurisdiction) {
                    complianceState.currentJurisdiction = newCode;
                    startNewConversation();
                }
            });
        }

        // Send button
        const sendBtn = document.getElementById('complianceSendBtn');
        if (sendBtn) {
            sendBtn.addEventListener('click', sendComplianceMessage);
        }

        // Text input — Enter to send, Shift+Enter for newline
        const input = document.getElementById('complianceChatInput');
        if (input) {
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendComplianceMessage();
                }
            });
            // Auto-resize
            input.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            });
        }

        // History button
        const historyBtn = document.getElementById('complianceHistoryBtn');
        if (historyBtn) {
            historyBtn.addEventListener('click', openConversationHistory);
        }

        // History overlay close
        const historyOverlay = document.getElementById('complianceHistoryOverlay');
        if (historyOverlay) {
            historyOverlay.addEventListener('click', function(e) {
                if (e.target === this) closeConversationHistory();
            });
        }

        const historyClose = document.getElementById('complianceHistoryClose');
        if (historyClose) {
            historyClose.addEventListener('click', closeConversationHistory);
        }

        // New conversation button in history
        const newConvBtn = document.getElementById('complianceHistoryNewBtn');
        if (newConvBtn) {
            newConvBtn.addEventListener('click', function() {
                closeConversationHistory();
                startNewConversation();
            });
        }

        // Mobile sources button
        const mobileSourcesBtn = document.getElementById('complianceMobileSourcesBtn');
        if (mobileSourcesBtn) {
            mobileSourcesBtn.addEventListener('click', function() {
                const panel = document.getElementById('complianceReferencePanel');
                if (panel) panel.classList.toggle('mobile-visible');
            });
        }
    }

    // ============================================================
    // CONVERSATION MANAGEMENT
    // ============================================================
    async function startNewConversation() {
        complianceState.currentConversationId = null;
        complianceState.messages = [];
        complianceState.citations = [];

        // Clear chat and references
        const messagesEl = document.getElementById('complianceChatMessages');
        if (messagesEl) messagesEl.innerHTML = '';

        renderReferences([]);
        updateJurisdictionSubtitle();
        updateInputPlaceholder();

        await loadWelcomeMessage();
    }

    async function loadWelcomeMessage() {
        try {
            const resp = await apiFetch('/api/compliance/welcome?jurisdiction_code=' + complianceState.currentJurisdiction);
            if (!resp.ok) return;

            const data = await resp.json();
            const messagesEl = document.getElementById('complianceChatMessages');
            if (!messagesEl) return;

            const welcomeDiv = document.createElement('div');
            welcomeDiv.className = 'compliance-welcome';
            welcomeDiv.innerHTML = formatMarkdown(data.message);
            messagesEl.appendChild(welcomeDiv);
        } catch (err) {
            console.error('Failed to load welcome message:', err);
        }
    }

    function updateInputPlaceholder() {
        const input = document.getElementById('complianceChatInput');
        const j = complianceState.jurisdictions.find(j => j.code === complianceState.currentJurisdiction);
        if (input && j) {
            input.placeholder = 'Ask about compliance in ' + j.name + '...';
        }
    }

    // ============================================================
    // SENDING MESSAGES
    // ============================================================
    async function sendComplianceMessage() {
        const input = document.getElementById('complianceChatInput');
        if (!input) return;

        const message = input.value.trim();
        if (!message || complianceState.isLoading) return;

        complianceState.isLoading = true;
        input.value = '';
        input.style.height = 'auto';

        const sendBtn = document.getElementById('complianceSendBtn');
        if (sendBtn) sendBtn.disabled = true;

        // Add user message to UI
        addMessageToChat('user', message);

        // Add typing indicator
        const typingEl = addTypingIndicator();

        try {
            const response = await fetch(getApiBase() + '/api/compliance/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + getToken()
                },
                body: JSON.stringify({
                    conversation_id: complianceState.currentConversationId,
                    jurisdiction_code: complianceState.currentJurisdiction,
                    message: message
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                console.error('Compliance chat API error:', response.status, errData);
                throw new Error(errData.error || 'Request failed (HTTP ' + response.status + '). Please try refreshing the page.');
            }

            // Read SSE stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let assistantText = '';
            let assistantEl = null;
            let metadata = null;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6);
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const event = JSON.parse(jsonStr);

                        if (event.type === 'conversation_id') {
                            complianceState.currentConversationId = event.conversation_id;
                        } else if (event.type === 'text') {
                            // Remove typing indicator on first text
                            if (typingEl && typingEl.parentNode) {
                                typingEl.remove();
                            }

                            assistantText += event.text;

                            // Create or update assistant message
                            if (!assistantEl) {
                                assistantEl = addMessageToChat('assistant', '', true);
                            }
                            updateAssistantMessage(assistantEl, assistantText);
                        } else if (event.type === 'metadata') {
                            metadata = event;
                        } else if (event.type === 'error') {
                            throw new Error(event.error);
                        }
                    } catch (e) {
                        if (e.message && !e.message.includes('JSON')) throw e;
                    }
                }
            }

            // Process metadata (citations, disclaimers)
            if (metadata && assistantEl) {
                complianceState.citations = metadata.citations || [];

                // Add disclaimer to the message
                appendDisclaimer(assistantEl, metadata.disclaimer, metadata.stale_warning);

                // Render reference panel
                renderReferences(metadata.citations || []);

                // Replace citation markers with clickable badges
                replaceCitationMarkers(assistantEl, metadata.citations || []);
            }

        } catch (err) {
            console.error('Compliance chat error:', err);
            if (typingEl && typingEl.parentNode) typingEl.remove();
            addMessageToChat('assistant', 'Sorry, an error occurred: ' + err.message);
        } finally {
            complianceState.isLoading = false;
            if (sendBtn) sendBtn.disabled = false;
            input.focus();
        }
    }

    // ============================================================
    // CHAT UI HELPERS
    // ============================================================
    function addMessageToChat(role, content, streaming) {
        const messagesEl = document.getElementById('complianceChatMessages');
        if (!messagesEl) return null;

        const msgDiv = document.createElement('div');
        msgDiv.className = 'compliance-msg ' + role;

        if (role === 'user') {
            msgDiv.textContent = content;
        } else if (content) {
            msgDiv.innerHTML = formatMarkdown(content);
        }

        messagesEl.appendChild(msgDiv);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return msgDiv;
    }

    function updateAssistantMessage(el, text) {
        if (!el) return;
        el.innerHTML = formatMarkdown(text);
        const messagesEl = document.getElementById('complianceChatMessages');
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addTypingIndicator() {
        const messagesEl = document.getElementById('complianceChatMessages');
        if (!messagesEl) return null;

        const typing = document.createElement('div');
        typing.className = 'compliance-typing';
        typing.innerHTML = '<div class="compliance-typing-dot"></div><div class="compliance-typing-dot"></div><div class="compliance-typing-dot"></div>';
        messagesEl.appendChild(typing);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return typing;
    }

    function appendDisclaimer(el, disclaimer, staleWarning) {
        if (!el) return;

        let html = '';

        if (staleWarning) {
            html += '<div class="compliance-stale-warning">' + escapeHtml(staleWarning) + '</div>';
        }

        if (disclaimer) {
            html += '<div class="compliance-disclaimer">' + escapeHtml(disclaimer) + '</div>';
        }

        // Check for mandatory reminder
        const reminderText = el.textContent;
        if (reminderText.includes('We recommend you reach out to an agent or representative')) {
            // Already in the text — style it
            const content = el.innerHTML;
            const reminderStart = 'We recommend you reach out to an agent or representative';
            const idx = content.indexOf(reminderStart);
            if (idx !== -1) {
                const before = content.substring(0, idx);
                const after = content.substring(idx);
                el.innerHTML = before + '<div class="compliance-mandatory-reminder">' + after + '</div>';
            }
        }

        if (html) {
            el.insertAdjacentHTML('beforeend', html);
        }
    }

    function replaceCitationMarkers(el, citations) {
        if (!el || !citations || citations.length === 0) return;

        let html = el.innerHTML;
        // Replace [Citation: uuid] patterns with numbered badges
        citations.forEach((cite, i) => {
            const pattern = new RegExp('\\[Citation:\\s*' + escapeRegex(cite.knowledge_base_id) + '\\]', 'gi');
            const badge = '<span class="compliance-citation-marker" data-citation-index="' + (i + 1) + '" onclick="window.scrollToComplianceCitation(' + (i + 1) + ')">' + (i + 1) + '</span>';
            html = html.replace(pattern, badge);
        });
        el.innerHTML = html;
    }

    // ============================================================
    // REFERENCE PANEL
    // ============================================================
    function renderReferences(citations) {
        const content = document.getElementById('complianceReferenceContent');
        if (!content) return;

        if (!citations || citations.length === 0) {
            content.innerHTML = '<div class="compliance-reference-empty">' +
                '<div class="compliance-reference-empty-icon">&#128218;</div>' +
                '<div class="compliance-reference-empty-text">Sources and references will appear here when the Compliance Assistant cites regulatory content.</div>' +
                '</div>';
            return;
        }

        content.innerHTML = citations.map(cite => {
            const freshnessLabels = {
                'current': 'Current',
                'verify_recommended': 'Verify recommended',
                'outdated': 'May be outdated'
            };

            return '<div class="compliance-source-card" id="complianceCitation' + cite.index + '">' +
                '<div class="compliance-source-card-header">' +
                    '<span class="compliance-source-badge">' + cite.index + '</span>' +
                    '<span class="compliance-source-title">' + escapeHtml(cite.title) + '</span>' +
                '</div>' +
                '<div class="compliance-source-meta">' +
                    (cite.source_name ? '<span class="compliance-source-meta-item">&#128196; ' + escapeHtml(cite.source_name) + '</span>' : '') +
                    (cite.source_section ? '<span class="compliance-source-meta-item">&#167; ' + escapeHtml(cite.source_section) + '</span>' : '') +
                    (cite.last_verified_date ? '<span class="compliance-freshness ' + cite.freshness + '"><span class="compliance-freshness-dot"></span>' + freshnessLabels[cite.freshness] + ' (' + formatDate(cite.last_verified_date) + ')</span>' : '') +
                '</div>' +
                '<div class="compliance-source-excerpt">' + escapeHtml(cite.excerpt || '') + '</div>' +
                '<div class="compliance-source-actions">' +
                    (cite.source_url ? '<a class="compliance-source-link" href="' + escapeHtml(cite.source_url) + '" target="_blank" rel="noopener">View on regulator website &#8594;</a>' : '') +
                    '<button class="compliance-view-full-btn" onclick="window.toggleComplianceFullContent(this)">View full entry</button>' +
                '</div>' +
                '<div class="compliance-source-full-content" data-kb-id="' + cite.knowledge_base_id + '">' + escapeHtml(cite.excerpt) + '</div>' +
                '</div>';
        }).join('');

        // Update mobile button
        const mobileBtn = document.getElementById('complianceMobileSourcesBtn');
        if (mobileBtn) {
            mobileBtn.textContent = 'View sources (' + citations.length + ')';
            mobileBtn.style.display = citations.length > 0 ? 'flex' : 'none';
        }
    }

    // Global functions for onclick handlers
    window.scrollToComplianceCitation = function(index) {
        const card = document.getElementById('complianceCitation' + index);
        if (!card) return;

        // On mobile, show the panel first
        if (window.innerWidth <= 900) {
            const panel = document.getElementById('complianceReferencePanel');
            if (panel) panel.classList.add('mobile-visible');
        }

        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('highlighted');
        setTimeout(() => card.classList.remove('highlighted'), 2000);
    };

    window.toggleComplianceFullContent = function(btn) {
        const fullContent = btn.parentElement.nextElementSibling;
        if (fullContent) {
            fullContent.classList.toggle('expanded');
            btn.textContent = fullContent.classList.contains('expanded') ? 'Hide full entry' : 'View full entry';
        }
    };

    // ============================================================
    // CONVERSATION HISTORY
    // ============================================================
    async function openConversationHistory() {
        const overlay = document.getElementById('complianceHistoryOverlay');
        if (!overlay) return;

        overlay.classList.add('visible');

        // Load conversations
        const list = document.getElementById('complianceHistoryList');
        if (list) list.innerHTML = '<div style="text-align:center;padding:20px;color:#adb5bd;">Loading...</div>';

        try {
            const resp = await apiFetch('/api/compliance/conversations');
            if (!resp.ok) throw new Error('Failed to load');

            const data = await resp.json();
            const conversations = data.conversations || [];

            if (conversations.length === 0) {
                list.innerHTML = '<div style="text-align:center;padding:20px;color:#adb5bd;">No past conversations yet.</div>';
                return;
            }

            list.innerHTML = conversations.map(conv =>
                '<div class="compliance-history-item" data-conv-id="' + conv.id + '" onclick="window.loadComplianceConversation(\'' + conv.id + '\')">' +
                    '<div class="compliance-history-item-title">' + escapeHtml(conv.title || 'Untitled') + '</div>' +
                    '<div class="compliance-history-item-meta">' +
                        '<span>' + (conv.jurisdiction_name || conv.jurisdiction_code) + '</span>' +
                        '<span>' + formatDate(conv.created_at) + '</span>' +
                    '</div>' +
                '</div>'
            ).join('');
        } catch (err) {
            console.error('Failed to load conversation history:', err);
            list.innerHTML = '<div style="text-align:center;padding:20px;color:#c62828;">Failed to load conversations.</div>';
        }
    }

    function closeConversationHistory() {
        const overlay = document.getElementById('complianceHistoryOverlay');
        if (overlay) overlay.classList.remove('visible');
    }

    window.loadComplianceConversation = async function(convId) {
        closeConversationHistory();

        try {
            const resp = await apiFetch('/api/compliance/conversations/' + convId);
            if (!resp.ok) throw new Error('Failed to load conversation');

            const data = await resp.json();
            const conv = data.conversation;
            const msgs = data.messages || [];

            complianceState.currentConversationId = convId;
            complianceState.currentJurisdiction = conv.jurisdiction_code;

            // Update dropdown
            const select = document.getElementById('complianceJurisdictionSelect');
            if (select) select.value = conv.jurisdiction_code;
            updateJurisdictionSubtitle();
            updateInputPlaceholder();

            // Clear and rebuild chat
            const messagesEl = document.getElementById('complianceChatMessages');
            if (messagesEl) messagesEl.innerHTML = '';

            let lastCitations = [];
            msgs.forEach(msg => {
                const el = addMessageToChat(msg.role, msg.content);
                if (msg.role === 'assistant' && msg.citations && msg.citations.length > 0) {
                    lastCitations = msg.citations;
                    replaceCitationMarkers(el, msg.citations);
                }
            });

            // Show last citations in reference panel
            renderReferences(lastCitations);

        } catch (err) {
            console.error('Failed to load conversation:', err);
        }
    };

    // ============================================================
    // SUPER ADMIN — KB MANAGEMENT
    // ============================================================
    let complianceAdminState = {
        currentTab: 'dashboard',
        entries: [],
        selectedIds: new Set(),
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        filterJurisdiction: '',
        filterCategory: '',
        filterSearch: '',
        editingEntry: null,
        jurisdictions: [],
        categories: []
    };

    window.initComplianceAdmin = async function() {
        try {
            // Load jurisdictions and categories
            const [jurisResp, catResp] = await Promise.all([
                apiFetch('/api/compliance/admin/jurisdictions'),
                apiFetch('/api/compliance/admin/categories')
            ]);

            if (jurisResp.ok) {
                const data = await jurisResp.json();
                complianceAdminState.jurisdictions = data.jurisdictions || [];
            }
            if (catResp.ok) {
                const data = await catResp.json();
                complianceAdminState.categories = data.categories || [];
            }

            setupComplianceAdminListeners();
            switchComplianceAdminTab('dashboard');
        } catch (err) {
            console.error('Failed to init compliance admin:', err);
        }
    };

    function setupComplianceAdminListeners() {
        // Tab buttons
        document.querySelectorAll('.compliance-admin-tab').forEach(tab => {
            tab.addEventListener('click', function() {
                switchComplianceAdminTab(this.dataset.tab);
            });
        });
    }

    function switchComplianceAdminTab(tab) {
        complianceAdminState.currentTab = tab;

        document.querySelectorAll('.compliance-admin-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });

        const container = document.getElementById('complianceAdminContent');
        if (!container) return;

        if (tab === 'dashboard') {
            loadComplianceAdminDashboard(container);
        } else if (tab === 'entries') {
            loadComplianceAdminEntries(container);
        } else if (tab === 'jurisdictions') {
            loadComplianceAdminJurisdictions(container);
        }
    }

    async function loadComplianceAdminDashboard(container) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#adb5bd;">Loading dashboard...</div>';

        try {
            const resp = await apiFetch('/api/compliance/admin/dashboard');
            if (!resp.ok) throw new Error('Failed to load dashboard');

            const data = await resp.json();

            container.innerHTML =
                '<div class="compliance-admin-stats">' +
                    '<div class="compliance-admin-stat-card"><div class="compliance-admin-stat-value">' + data.total_active + '</div><div class="compliance-admin-stat-label">Active Entries</div></div>' +
                    '<div class="compliance-admin-stat-card warning"><div class="compliance-admin-stat-value">' + data.needs_verification + '</div><div class="compliance-admin-stat-label">Need Verification (90+ days)</div></div>' +
                    '<div class="compliance-admin-stat-card danger"><div class="compliance-admin-stat-value">' + data.critically_overdue + '</div><div class="compliance-admin-stat-label">Critically Overdue (180+ days)</div></div>' +
                '</div>' +
                '<h3 style="font-size:1rem;font-weight:600;margin:24px 0 12px;">Entries by Jurisdiction</h3>' +
                '<div class="compliance-admin-table-wrapper"><table class="compliance-admin-table">' +
                    '<thead><tr><th>Jurisdiction</th><th>Total</th><th>Active</th></tr></thead>' +
                    '<tbody>' + (data.by_jurisdiction || []).map(j =>
                        '<tr><td>' + escapeHtml(j.jurisdiction_name) + ' (' + j.jurisdiction_code + ')</td><td>' + j.total + '</td><td>' + j.active + '</td></tr>'
                    ).join('') + '</tbody>' +
                '</table></div>' +
                '<h3 style="font-size:1rem;font-weight:600;margin:24px 0 12px;">Recently Updated</h3>' +
                '<div class="compliance-admin-table-wrapper"><table class="compliance-admin-table">' +
                    '<thead><tr><th>Title</th><th>Category</th><th>Jurisdiction</th><th>Updated</th></tr></thead>' +
                    '<tbody>' + (data.recently_updated || []).map(e =>
                        '<tr><td>' + escapeHtml(e.title) + '</td><td>' + escapeHtml(e.category) + '</td><td>' + e.jurisdiction_code + '</td><td>' + formatDate(e.updated_at) + '</td></tr>'
                    ).join('') + '</tbody>' +
                '</table></div>';
        } catch (err) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#c62828;">Failed to load dashboard.</div>';
        }
    }

    async function loadComplianceAdminEntries(container) {
        // Build filter UI
        const filtersHtml =
            '<div class="compliance-admin-filters">' +
                '<select id="compAdminFilterJuris" onchange="window.compAdminFilterChanged()"><option value="">All Jurisdictions</option>' +
                    complianceAdminState.jurisdictions.map(j => '<option value="' + j.code + '"' + (complianceAdminState.filterJurisdiction === j.code ? ' selected' : '') + '>' + escapeHtml(j.name) + '</option>').join('') +
                '</select>' +
                '<select id="compAdminFilterCat" onchange="window.compAdminFilterChanged()"><option value="">All Categories</option>' +
                    complianceAdminState.categories.map(c => '<option value="' + c + '"' + (complianceAdminState.filterCategory === c ? ' selected' : '') + '>' + escapeHtml(c) + '</option>').join('') +
                '</select>' +
                '<input type="text" id="compAdminFilterSearch" placeholder="Search entries..." value="' + escapeHtml(complianceAdminState.filterSearch) + '" onkeyup="if(event.key===\'Enter\')window.compAdminFilterChanged()">' +
                '<button class="compliance-admin-add-btn" onclick="window.openComplianceEntryForm()">+ Add Entry</button>' +
            '</div>' +
            '<div class="compliance-admin-bulk-bar" id="compAdminBulkBar">' +
                '<span id="compAdminBulkCount">0 selected</span>' +
                '<button class="compliance-admin-bulk-btn" onclick="window.compAdminBulkVerify()">Mark as Verified</button>' +
                '<button class="compliance-admin-bulk-btn" onclick="window.compAdminBulkDeactivate()">Deactivate</button>' +
            '</div>' +
            '<div id="compAdminEntriesTable"></div>';

        container.innerHTML = filtersHtml;
        await refreshComplianceEntries();
    }

    window.compAdminFilterChanged = function() {
        complianceAdminState.filterJurisdiction = document.getElementById('compAdminFilterJuris')?.value || '';
        complianceAdminState.filterCategory = document.getElementById('compAdminFilterCat')?.value || '';
        complianceAdminState.filterSearch = document.getElementById('compAdminFilterSearch')?.value || '';
        complianceAdminState.pagination.page = 1;
        refreshComplianceEntries();
    };

    async function refreshComplianceEntries() {
        const tableContainer = document.getElementById('compAdminEntriesTable');
        if (!tableContainer) return;

        let url = '/api/compliance/admin/entries?page=' + complianceAdminState.pagination.page + '&limit=' + complianceAdminState.pagination.limit;
        if (complianceAdminState.filterJurisdiction) url += '&jurisdiction=' + complianceAdminState.filterJurisdiction;
        if (complianceAdminState.filterCategory) url += '&category=' + encodeURIComponent(complianceAdminState.filterCategory);
        if (complianceAdminState.filterSearch) url += '&search=' + encodeURIComponent(complianceAdminState.filterSearch);

        try {
            const resp = await apiFetch(url);
            if (!resp.ok) throw new Error('Failed');

            const data = await resp.json();
            complianceAdminState.entries = data.entries || [];
            complianceAdminState.pagination = data.pagination;
            complianceAdminState.selectedIds.clear();

            const now = new Date();

            tableContainer.innerHTML =
                '<div class="compliance-admin-table-wrapper"><table class="compliance-admin-table">' +
                '<thead><tr>' +
                    '<th><input type="checkbox" onchange="window.compAdminToggleAll(this.checked)"></th>' +
                    '<th>Title</th><th>Category</th><th>Jurisdiction</th><th>Verified</th><th>Status</th><th>Actions</th>' +
                '</tr></thead>' +
                '<tbody>' + complianceAdminState.entries.map(entry => {
                    const verified = new Date(entry.last_verified_date || '2020-01-01');
                    const daysSince = Math.floor((now - verified) / (1000 * 60 * 60 * 24));
                    let rowClass = '';
                    if (daysSince > 180) rowClass = 'row-danger';
                    else if (daysSince > 90) rowClass = 'row-warning';

                    return '<tr class="' + rowClass + '">' +
                        '<td><input type="checkbox" class="compliance-admin-row-checkbox" data-id="' + entry.id + '" onchange="window.compAdminToggleRow(this)"></td>' +
                        '<td>' + escapeHtml(entry.title) + '</td>' +
                        '<td>' + escapeHtml(entry.category) + '</td>' +
                        '<td>' + entry.jurisdiction_code + '</td>' +
                        '<td>' + formatDate(entry.last_verified_date) + '</td>' +
                        '<td>' + (entry.is_active ? '<span style="color:#2e7d32;">Active</span>' : '<span style="color:#adb5bd;">Inactive</span>') + '</td>' +
                        '<td class="compliance-admin-row-actions">' +
                            '<button class="compliance-admin-row-btn edit" onclick="window.openComplianceEntryForm(\'' + entry.id + '\')">Edit</button>' +
                            '<button class="compliance-admin-row-btn verify" onclick="window.compAdminVerifyOne(\'' + entry.id + '\')">Verify</button>' +
                            '<button class="compliance-admin-row-btn delete" onclick="window.compAdminDeleteOne(\'' + entry.id + '\')">Deactivate</button>' +
                        '</td>' +
                    '</tr>';
                }).join('') + '</tbody></table></div>' +
                renderPagination();

        } catch (err) {
            tableContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#c62828;">Failed to load entries.</div>';
        }
    }

    function renderPagination() {
        const p = complianceAdminState.pagination;
        if (p.totalPages <= 1) return '';

        let html = '<div class="compliance-admin-pagination">';
        html += '<button class="compliance-admin-page-btn" onclick="window.compAdminGoPage(' + (p.page - 1) + ')" ' + (p.page <= 1 ? 'disabled' : '') + '>&laquo; Prev</button>';

        for (let i = 1; i <= p.totalPages; i++) {
            if (p.totalPages > 7 && Math.abs(i - p.page) > 2 && i !== 1 && i !== p.totalPages) {
                if (i === 2 || i === p.totalPages - 1) html += '<span style="padding:0 4px;">...</span>';
                continue;
            }
            html += '<button class="compliance-admin-page-btn ' + (i === p.page ? 'active' : '') + '" onclick="window.compAdminGoPage(' + i + ')">' + i + '</button>';
        }

        html += '<button class="compliance-admin-page-btn" onclick="window.compAdminGoPage(' + (p.page + 1) + ')" ' + (p.page >= p.totalPages ? 'disabled' : '') + '>Next &raquo;</button>';
        html += '</div>';
        return html;
    }

    window.compAdminGoPage = function(page) {
        if (page < 1 || page > complianceAdminState.pagination.totalPages) return;
        complianceAdminState.pagination.page = page;
        refreshComplianceEntries();
    };

    window.compAdminToggleAll = function(checked) {
        document.querySelectorAll('.compliance-admin-row-checkbox').forEach(cb => {
            cb.checked = checked;
            if (checked) complianceAdminState.selectedIds.add(cb.dataset.id);
            else complianceAdminState.selectedIds.delete(cb.dataset.id);
        });
        updateBulkBar();
    };

    window.compAdminToggleRow = function(cb) {
        if (cb.checked) complianceAdminState.selectedIds.add(cb.dataset.id);
        else complianceAdminState.selectedIds.delete(cb.dataset.id);
        updateBulkBar();
    };

    function updateBulkBar() {
        const bar = document.getElementById('compAdminBulkBar');
        const count = document.getElementById('compAdminBulkCount');
        if (bar) bar.classList.toggle('visible', complianceAdminState.selectedIds.size > 0);
        if (count) count.textContent = complianceAdminState.selectedIds.size + ' selected';
    }

    window.compAdminBulkVerify = async function() {
        const ids = Array.from(complianceAdminState.selectedIds);
        if (ids.length === 0) return;
        try {
            await apiFetch('/api/compliance/admin/entries/bulk-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entry_ids: ids })
            });
            refreshComplianceEntries();
        } catch (err) {
            alert('Failed to bulk verify: ' + err.message);
        }
    };

    window.compAdminBulkDeactivate = async function() {
        const ids = Array.from(complianceAdminState.selectedIds);
        if (ids.length === 0) return;
        if (!confirm('Deactivate ' + ids.length + ' entries?')) return;
        try {
            await apiFetch('/api/compliance/admin/entries/bulk-deactivate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entry_ids: ids })
            });
            refreshComplianceEntries();
        } catch (err) {
            alert('Failed to bulk deactivate: ' + err.message);
        }
    };

    window.compAdminVerifyOne = async function(id) {
        try {
            await apiFetch('/api/compliance/admin/entries/' + id + '/verify', { method: 'POST' });
            refreshComplianceEntries();
        } catch (err) {
            alert('Failed to verify: ' + err.message);
        }
    };

    window.compAdminDeleteOne = async function(id) {
        if (!confirm('Deactivate this entry?')) return;
        try {
            await apiFetch('/api/compliance/admin/entries/' + id, { method: 'DELETE' });
            refreshComplianceEntries();
        } catch (err) {
            alert('Failed to deactivate: ' + err.message);
        }
    };

    // ============================================================
    // ENTRY FORM (Add/Edit)
    // ============================================================
    window.openComplianceEntryForm = async function(entryId) {
        const overlay = document.getElementById('complianceEntryFormOverlay');
        if (!overlay) {
            // Create form overlay if it doesn't exist
            createEntryFormOverlay();
        }

        const formOverlay = document.getElementById('complianceEntryFormOverlay');
        const formTitle = document.getElementById('compEntryFormTitle');

        if (entryId) {
            // Load entry for editing
            const entry = complianceAdminState.entries.find(e => e.id === entryId);
            if (entry) {
                complianceAdminState.editingEntry = entry;
                if (formTitle) formTitle.textContent = 'Edit Entry';
                fillEntryForm(entry);
            }
        } else {
            complianceAdminState.editingEntry = null;
            if (formTitle) formTitle.textContent = 'Add New Entry';
            fillEntryForm({});
        }

        formOverlay.classList.add('visible');
    };

    function createEntryFormOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'complianceEntryFormOverlay';
        overlay.className = 'compliance-admin-form-overlay';
        overlay.onclick = function(e) { if (e.target === this) this.classList.remove('visible'); };

        const defaultCategories = ['Licensing', 'Reporting', 'Online Sales', 'Draw Rules', 'Prize Limits', 'Advertising', 'Financial Requirements', 'Staffing & Volunteers', 'Compliance & Enforcement', 'General'];
        const allCategories = [...new Set([...defaultCategories, ...complianceAdminState.categories])];

        overlay.innerHTML =
            '<div class="compliance-admin-form-modal">' +
                '<h3 id="compEntryFormTitle">Add New Entry</h3>' +
                '<div class="compliance-admin-form-row">' +
                    '<div class="compliance-admin-form-group">' +
                        '<label>Jurisdiction</label>' +
                        '<select id="compEntryJurisdiction">' +
                            complianceAdminState.jurisdictions.map(j => '<option value="' + j.code + '">' + escapeHtml(j.name) + '</option>').join('') +
                        '</select>' +
                    '</div>' +
                    '<div class="compliance-admin-form-group">' +
                        '<label>Category</label>' +
                        '<select id="compEntryCategory">' +
                            allCategories.map(c => '<option value="' + c + '">' + escapeHtml(c) + '</option>').join('') +
                        '</select>' +
                    '</div>' +
                '</div>' +
                '<div class="compliance-admin-form-group">' +
                    '<label>Title</label>' +
                    '<input type="text" id="compEntryTitle" placeholder="e.g., Licence Amendment Requirements">' +
                '</div>' +
                '<div class="compliance-admin-form-group">' +
                    '<label>Content (plain language regulatory guidance)</label>' +
                    '<textarea id="compEntryContent" placeholder="Write clear, practical guidance for operators..."></textarea>' +
                '</div>' +
                '<div class="compliance-admin-form-row">' +
                    '<div class="compliance-admin-form-group">' +
                        '<label>Source Name</label>' +
                        '<input type="text" id="compEntrySourceName" placeholder="e.g., AGCO Registrar\'s Standards">' +
                    '</div>' +
                    '<div class="compliance-admin-form-group">' +
                        '<label>Source Section (optional)</label>' +
                        '<input type="text" id="compEntrySourceSection" placeholder="e.g., Section 4.2">' +
                    '</div>' +
                '</div>' +
                '<div class="compliance-admin-form-group">' +
                    '<label>Source URL</label>' +
                    '<input type="url" id="compEntrySourceUrl" placeholder="https://...">' +
                '</div>' +
                '<div class="compliance-admin-form-row">' +
                    '<div class="compliance-admin-form-group">' +
                        '<label>Active</label>' +
                        '<select id="compEntryActive"><option value="true">Active</option><option value="false">Inactive</option></select>' +
                    '</div>' +
                    '<div class="compliance-admin-form-group">' +
                        '<label>Last Verified Date</label>' +
                        '<input type="date" id="compEntryVerifiedDate">' +
                    '</div>' +
                '</div>' +
                '<div class="compliance-admin-form-actions">' +
                    '<button class="compliance-admin-form-cancel" onclick="document.getElementById(\'complianceEntryFormOverlay\').classList.remove(\'visible\')">Cancel</button>' +
                    '<button class="compliance-admin-form-save" onclick="window.saveComplianceEntry()">Save Entry</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);
    }

    function fillEntryForm(entry) {
        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        setVal('compEntryJurisdiction', entry.jurisdiction_code || 'ON');
        setVal('compEntryCategory', entry.category || 'Licensing');
        setVal('compEntryTitle', entry.title);
        setVal('compEntryContent', entry.content);
        setVal('compEntrySourceName', entry.source_name);
        setVal('compEntrySourceSection', entry.source_section);
        setVal('compEntrySourceUrl', entry.source_url);
        setVal('compEntryActive', entry.is_active !== false ? 'true' : 'false');
        setVal('compEntryVerifiedDate', entry.last_verified_date ? entry.last_verified_date.substring(0, 10) : new Date().toISOString().substring(0, 10));
    }

    window.saveComplianceEntry = async function() {
        const getVal = (id) => document.getElementById(id)?.value || '';

        const body = {
            jurisdiction_code: getVal('compEntryJurisdiction'),
            category: getVal('compEntryCategory'),
            title: getVal('compEntryTitle'),
            content: getVal('compEntryContent'),
            source_name: getVal('compEntrySourceName'),
            source_section: getVal('compEntrySourceSection'),
            source_url: getVal('compEntrySourceUrl'),
            is_active: getVal('compEntryActive') === 'true',
            last_verified_date: getVal('compEntryVerifiedDate')
        };

        if (!body.title || !body.content) {
            alert('Title and content are required.');
            return;
        }

        try {
            const editing = complianceAdminState.editingEntry;
            const url = editing ? '/api/compliance/admin/entries/' + editing.id : '/api/compliance/admin/entries';
            const method = editing ? 'PUT' : 'POST';

            const resp = await apiFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to save');
            }

            document.getElementById('complianceEntryFormOverlay')?.classList.remove('visible');
            refreshComplianceEntries();
        } catch (err) {
            alert('Failed to save entry: ' + err.message);
        }
    };

    // ============================================================
    // JURISDICTIONS MANAGEMENT
    // ============================================================
    async function loadComplianceAdminJurisdictions(container) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#adb5bd;">Loading jurisdictions...</div>';

        try {
            const resp = await apiFetch('/api/compliance/admin/jurisdictions');
            if (!resp.ok) throw new Error('Failed');

            const data = await resp.json();
            const jurisdictions = data.jurisdictions || [];

            container.innerHTML = '<div class="compliance-admin-juris-grid">' +
                jurisdictions.map(j =>
                    '<div class="compliance-admin-juris-card">' +
                        '<div class="compliance-admin-juris-info">' +
                            '<h4>' + escapeHtml(j.name) + ' (' + j.code + ')</h4>' +
                            '<p>' + escapeHtml(j.regulatory_body) + '</p>' +
                            '<div class="entry-count">' + (j.entry_count || 0) + ' entries</div>' +
                        '</div>' +
                        '<button class="compliance-toggle ' + (j.is_active ? 'active' : '') + '" data-code="' + j.code + '" onclick="window.toggleComplianceJurisdiction(this, \'' + j.code + '\')"></button>' +
                    '</div>'
                ).join('') +
            '</div>';
        } catch (err) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:#c62828;">Failed to load jurisdictions.</div>';
        }
    }

    window.toggleComplianceJurisdiction = async function(btn, code) {
        const isActive = btn.classList.contains('active');
        try {
            const resp = await apiFetch('/api/compliance/admin/jurisdictions/' + code, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_active: !isActive })
            });
            if (resp.ok) {
                btn.classList.toggle('active');
            }
        } catch (err) {
            alert('Failed to update jurisdiction: ' + err.message);
        }
    };

    // ============================================================
    // UTILITIES
    // ============================================================
    function getApiBase() {
        if (window.API_BASE) return window.API_BASE;
        var h = window.location.hostname;
        if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3001';
        return 'https://lightspeed-backend.onrender.com';
    }

    function getToken() {
        return localStorage.getItem('authToken') || '';
    }

    async function apiFetch(url, options) {
        const opts = options || {};
        opts.headers = opts.headers || {};
        opts.headers['Authorization'] = 'Bearer ' + getToken();
        return fetch(getApiBase() + url, opts);
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatMarkdown(text) {
        if (!text) return '';
        // Simple markdown-to-HTML conversion
        let html = escapeHtml(text);

        // Headers
        html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');

        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // Bullet lists
        html = html.replace(/^[•\-]\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

        // Numbered lists
        html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

        // Line breaks to paragraphs
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';

        // Clean up empty paragraphs
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.replace(/<p>(<[hul])/g, '<$1'.replace('<$1', '$1'));
        html = html.replace(/(<\/[hul][^>]*>)<\/p>/g, '$1');

        return html;
    }

})();
