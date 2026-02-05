import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/common/Toast';
import { apiPost, apiRequest } from '../../api/client';
import ToolHeader from '../../components/Layout/ToolHeader';
import Footer from '../../components/Layout/Footer';

const TABS = [
  { key: 'generator', label: 'Generator' },
  { key: 'quick-replies', label: 'Quick Replies' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'teams', label: 'Teams' },
];

const TONE_OPTIONS = ['Professional', 'Friendly', 'Empathetic', 'Formal', 'Casual'];

export default function ResponseAssistantPage() {
  const navigate = useNavigate();
  const { user, isSuperAdmin } = useAuth();
  const showToast = useToast();

  // Tab navigation
  const [activePage, setActivePage] = useState('generator');

  // Generator state
  const [format, setFormat] = useState('Email');
  const [tone, setTone] = useState('Professional');
  const [inquiry, setInquiry] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');
  const [includeKnowledgeBase, setIncludeKnowledgeBase] = useState(false);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState('');
  const [responseHistory, setResponseHistory] = useState([]);

  // Quick Replies state
  const [favorites, setFavorites] = useState(() => {
    try {
      const stored = localStorage.getItem('response-assistant-favorites');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Analytics state
  const [analytics, setAnalytics] = useState({
    totalGenerated: 0,
    thisWeek: 0,
    mostUsedTone: 'Professional',
  });

  // Persist favorites
  useEffect(() => {
    localStorage.setItem('response-assistant-favorites', JSON.stringify(favorites));
  }, [favorites]);

  // Load analytics from history
  useEffect(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisWeek = responseHistory.filter(
      (item) => new Date(item.timestamp) >= weekAgo
    ).length;

    const toneCounts = {};
    responseHistory.forEach((item) => {
      toneCounts[item.tone] = (toneCounts[item.tone] || 0) + 1;
    });
    const mostUsedTone =
      Object.entries(toneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Professional';

    setAnalytics({
      totalGenerated: responseHistory.length,
      thisWeek,
      mostUsedTone,
    });
  }, [responseHistory]);

  const buildSystemPrompt = useCallback(() => {
    let prompt = `You are a professional customer service representative for a nonprofit organization. Generate a ${tone.toLowerCase()} response to the following customer inquiry. Format the response as an ${format.toLowerCase()}.`;

    if (customerName) {
      prompt += ` Address the customer as ${customerName}.`;
    }

    if (additionalContext) {
      prompt += ` Additional context: ${additionalContext}`;
    }

    if (includeKnowledgeBase) {
      prompt += ' Use relevant information from the organization knowledge base to provide accurate and helpful responses.';
    }

    return prompt;
  }, [tone, format, customerName, additionalContext, includeKnowledgeBase]);

  const handleGenerate = useCallback(async () => {
    if (!inquiry.trim()) {
      showToast('Please enter a customer inquiry first.', 'error');
      return;
    }

    setLoading(true);
    try {
      const data = await apiPost('/api/generate', {
        messages: [{ role: 'user', content: inquiry.trim() }],
        system: buildSystemPrompt(),
        max_tokens: 1024,
      });

      const generatedText =
        data.response ||
        data.content ||
        data.choices?.[0]?.message?.content ||
        data.result ||
        '';

      setResponse(generatedText);
      setResponseHistory((prev) => [
        {
          id: Date.now(),
          text: generatedText,
          inquiry: inquiry.trim(),
          tone,
          format,
          timestamp: new Date().toISOString(),
        },
        ...prev,
      ]);
      showToast('Response generated successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to generate response. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [inquiry, buildSystemPrompt, tone, format, showToast]);

  const handleCopy = useCallback(
    (text) => {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success');
      });
    },
    [showToast]
  );

  const handleSaveToFavorites = useCallback(
    (text) => {
      const existing = favorites.find((f) => f.text === text);
      if (existing) {
        showToast('Already saved to Quick Replies.', 'info');
        return;
      }
      setFavorites((prev) => [
        { id: Date.now(), text, savedAt: new Date().toISOString() },
        ...prev,
      ]);
      showToast('Saved to Quick Replies!', 'success');
    },
    [favorites, showToast]
  );

  const handleDeleteFavorite = useCallback((id) => {
    setFavorites((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleUseFavorite = useCallback((text) => {
    setInquiry(text);
    setActivePage('generator');
    showToast('Loaded into inquiry field.', 'info');
  }, [showToast]);

  const handleTabClick = useCallback(
    (key) => {
      if (key === 'knowledge') {
        navigate('/knowledge-base');
        return;
      }
      if (key === 'teams') {
        navigate('/teams');
        return;
      }
      setActivePage(key);
    },
    [navigate]
  );

  // ---- Render Tabs ----

  const renderGenerator = () => (
    <div className="page active">
      <div className="response-grid">
        {/* Left Column - Inquiry Panel */}
        <div className="inquiry-panel">
          <div className="panel-section">
            <label className="section-label">Format</label>
            <div className="format-selector">
              <button
                className={`format-btn${format === 'Email' ? ' active' : ''}`}
                onClick={() => setFormat('Email')}
              >
                Email
              </button>
              <button
                className={`format-btn${format === 'Facebook' ? ' active' : ''}`}
                onClick={() => setFormat('Facebook')}
              >
                Facebook
              </button>
            </div>
          </div>

          <div className="panel-section">
            <label className="section-label">Tone</label>
            <select
              className="tone-select"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              {TONE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="panel-section">
            <label className="section-label">Customer Inquiry</label>
            <textarea
              className="inquiry-textarea"
              placeholder="Paste or type the customer inquiry here..."
              value={inquiry}
              onChange={(e) => setInquiry(e.target.value)}
              rows={6}
            />
          </div>

          <div className="panel-section options-section">
            <button
              className="options-toggle"
              onClick={() => setOptionsExpanded(!optionsExpanded)}
            >
              <span className={`options-arrow${optionsExpanded ? ' expanded' : ''}`}>
                &#9654;
              </span>
              Options
            </button>

            {optionsExpanded && (
              <div className="options-content">
                <div className="option-field">
                  <label className="option-label">Customer Name</label>
                  <input
                    type="text"
                    className="option-input"
                    placeholder="Customer name (optional)"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>

                <div className="option-field">
                  <label className="option-label">Additional Context</label>
                  <textarea
                    className="option-textarea"
                    placeholder="Any additional context for the AI..."
                    value={additionalContext}
                    onChange={(e) => setAdditionalContext(e.target.value)}
                    rows={3}
                  />
                </div>

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeKnowledgeBase}
                    onChange={(e) => setIncludeKnowledgeBase(e.target.checked)}
                  />
                  Include knowledge base
                </label>
              </div>
            )}
          </div>

          <button
            className="generate-btn"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="btn-spinner" />
                Generating...
              </>
            ) : (
              'Generate Response'
            )}
          </button>
        </div>

        {/* Right Column - Results Panel */}
        <div className="results-panel">
          {!response ? (
            <div className="results-placeholder">
              <div className="placeholder-icon">&#9993;</div>
              <p>Your AI-generated response will appear here</p>
            </div>
          ) : (
            <>
              <div className="result-card">
                <div className="result-text">{response}</div>
                <div className="result-actions">
                  <button
                    className="action-btn copy-btn"
                    onClick={() => handleCopy(response)}
                  >
                    Copy
                  </button>
                  <button
                    className="action-btn save-btn"
                    onClick={() => handleSaveToFavorites(response)}
                  >
                    Save to Favorites
                  </button>
                </div>
              </div>

              {responseHistory.length > 0 && (
                <div className="history-section">
                  <h3 className="history-title">Response History</h3>
                  <div className="history-list">
                    {responseHistory.map((item) => (
                      <div key={item.id} className="history-item">
                        <div className="history-meta">
                          <span className="history-tone">{item.tone}</span>
                          <span className="history-format">{item.format}</span>
                          <span className="history-time">
                            {new Date(item.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="history-preview">
                          {item.text.substring(0, 150)}
                          {item.text.length > 150 ? '...' : ''}
                        </p>
                        <button
                          className="action-btn copy-btn"
                          onClick={() => handleCopy(item.text)}
                        >
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  const renderQuickReplies = () => (
    <div className="page active">
      <div className="quick-replies-section">
        <h2 className="section-heading">Quick Replies</h2>
        {favorites.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">&#9734;</div>
            <h3>No saved replies yet</h3>
            <p>Generate responses and save them as favorites to quickly access them here.</p>
          </div>
        ) : (
          <div className="quick-replies-list">
            {favorites.map((fav) => (
              <div key={fav.id} className="quick-reply-item">
                <p className="quick-reply-preview">
                  {fav.text.substring(0, 200)}
                  {fav.text.length > 200 ? '...' : ''}
                </p>
                <div className="quick-reply-actions">
                  <button
                    className="action-btn copy-btn"
                    onClick={() => handleCopy(fav.text)}
                  >
                    Copy
                  </button>
                  <button
                    className="action-btn use-btn"
                    onClick={() => handleUseFavorite(fav.text)}
                  >
                    Use
                  </button>
                  <button
                    className="action-btn delete-btn"
                    onClick={() => handleDeleteFavorite(fav.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderAnalytics = () => (
    <div className="page active">
      <div className="analytics-section">
        <h2 className="section-heading">Analytics</h2>
        <div className="analytics-grid">
          <div className="analytics-card">
            <div className="analytics-value">{analytics.totalGenerated}</div>
            <div className="analytics-label">Total Responses Generated</div>
          </div>
          <div className="analytics-card">
            <div className="analytics-value">{analytics.thisWeek}</div>
            <div className="analytics-label">Responses This Week</div>
          </div>
          <div className="analytics-card">
            <div className="analytics-value">{analytics.mostUsedTone}</div>
            <div className="analytics-label">Most Used Tone</div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="response-assistant-page">
      <ToolHeader title="Response Assistant">
        {isSuperAdmin && (
          <button className="nav-btn admin-btn" onClick={() => navigate('/admin')}>
            Admin
          </button>
        )}
      </ToolHeader>

      <nav className="tool-nav">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`nav-btn${activePage === tab.key ? ' active' : ''}`}
            onClick={() => handleTabClick(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="tool-main">
        {activePage === 'generator' && renderGenerator()}
        {activePage === 'quick-replies' && renderQuickReplies()}
        {activePage === 'analytics' && renderAnalytics()}
      </main>

      <Footer />
    </div>
  );
}
