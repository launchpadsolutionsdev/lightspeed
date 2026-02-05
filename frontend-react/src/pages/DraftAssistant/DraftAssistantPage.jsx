import { useState } from 'react';
import { apiPost, apiRequest } from '../../api/client';
import { useToast } from '../../components/common/Toast';
import ToolHeader from '../../components/Layout/ToolHeader';
import Footer from '../../components/Layout/Footer';
import {
  DRAFT_TYPE_LABELS,
  EMAIL_TYPE_LABELS,
  EMAIL_DETAILS_PLACEHOLDERS,
  EMAIL_DETAILS_LABELS,
} from '../../utils/constants';

const DRAFT_TYPE_OPTIONS = [
  { key: 'social', icon: '\uD83D\uDCF1', label: DRAFT_TYPE_LABELS.social },
  { key: 'email', icon: '\uD83D\uDCE7', label: DRAFT_TYPE_LABELS.email },
  { key: 'media-release', icon: '\uD83D\uDCF0', label: DRAFT_TYPE_LABELS['media-release'] },
  { key: 'ad', icon: '\uD83D\uDCE3', label: DRAFT_TYPE_LABELS.ad },
];

const TONE_OPTIONS = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'exciting', label: 'Exciting' },
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'urgent', label: 'Urgent' },
];

function buildSystemPrompt(draftType, emailType) {
  switch (draftType) {
    case 'social':
      return (
        'You are an expert social media copywriter. Follow these guidelines:\n' +
        '- Keep posts concise and engaging\n' +
        '- Twitter/X: max 280 characters\n' +
        '- Instagram: max 2,200 characters, use line breaks for readability\n' +
        '- Facebook: keep under 500 characters for best engagement\n' +
        '- Use relevant hashtags sparingly (2-5 max)\n' +
        '- Include a clear call-to-action\n' +
        '- Write in an authentic, on-brand voice\n' +
        '- Use emojis strategically to draw attention'
      );
    case 'email':
      return (
        'You are an expert email copywriter. Follow these guidelines:\n' +
        '- Include a compelling subject line at the top\n' +
        '- Use proper email structure: greeting, body, closing, signature\n' +
        '- Keep paragraphs short (2-3 sentences)\n' +
        '- Include a clear call-to-action\n' +
        '- Write in a warm, professional tone appropriate for lottery/fundraising\n' +
        '- Use bullet points for key details\n' +
        (emailType === 'impact-sunday'
          ? '- Focus on storytelling and the impact of donations on the community\n'
          : '') +
        (emailType === 'last-chance'
          ? '- Create urgency without being pushy\n'
          : '') +
        (emailType === 'winners'
          ? '- Celebrate the winner(s) and build excitement for future draws\n'
          : '')
      );
    case 'media-release':
      return (
        'You are an expert media release writer. Follow these guidelines:\n' +
        '- Follow AP style formatting\n' +
        '- Include a strong headline and dateline\n' +
        '- Lead with the most newsworthy information (inverted pyramid)\n' +
        '- Include at least one direct quote from a spokesperson\n' +
        '- Maintain a formal, journalistic tone\n' +
        '- Include boilerplate "About" section at the end\n' +
        '- Add ### or -30- at the end to indicate the end of the release\n' +
        '- Include contact information for media inquiries'
      );
    case 'ad':
      return (
        'You are an expert Facebook/Instagram ad copywriter. Follow these guidelines:\n' +
        '- Lead with an attention-grabbing hook in the first line\n' +
        '- Keep primary text under 125 characters for best display\n' +
        '- Include a strong, clear call-to-action (CTA)\n' +
        '- Create urgency or excitement\n' +
        '- Write multiple ad variations when possible\n' +
        '- Consider both headline and description text\n' +
        '- Use simple, direct language\n' +
        '- Focus on benefits over features'
      );
    default:
      return '';
  }
}

export default function DraftAssistantPage() {
  const showToast = useToast();

  // Flow state
  const [draftType, setDraftType] = useState(null);
  const [emailType, setEmailType] = useState('');
  const [impactContext, setImpactContext] = useState('');
  const [details, setDetails] = useState('');
  const [subjectLine, setSubjectLine] = useState('');
  const [tone, setTone] = useState('balanced');
  const [includeTicketLink, setIncludeTicketLink] = useState(false);
  const [includeDrawSchedule, setIncludeDrawSchedule] = useState(false);

  // Output state
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);

  function resetFlow() {
    setDraftType(null);
    setEmailType('');
    setImpactContext('');
    setDetails('');
    setSubjectLine('');
    setTone('balanced');
    setIncludeTicketLink(false);
    setIncludeDrawSchedule(false);
    setOutput('');
    setLoading(false);
    setRefineText('');
    setRefining(false);
  }

  function buildPrompt() {
    if (draftType === 'email') {
      let prompt = `Email type: ${EMAIL_TYPE_LABELS[emailType] || emailType}\n`;
      if (subjectLine.trim()) {
        prompt += `Subject line: ${subjectLine.trim()}\n`;
      }
      if (emailType === 'impact-sunday' && impactContext.trim()) {
        prompt += `Impact context: ${impactContext.trim()}\n`;
      }
      if (details.trim()) {
        prompt += `Details: ${details.trim()}\n`;
      }
      if (includeTicketLink) {
        prompt += 'Include a ticket purchase link placeholder.\n';
      }
      if (includeDrawSchedule) {
        prompt += 'Include the draw schedule.\n';
      }
      return prompt;
    }
    return details.trim();
  }

  async function handleGenerate() {
    if (draftType === 'email' && !emailType) {
      showToast('Please select an email type.', 'error');
      return;
    }
    if (!details.trim() && draftType !== 'email') {
      showToast('Please provide some details or a prompt.', 'error');
      return;
    }
    if (draftType === 'email' && !details.trim() && !subjectLine.trim()) {
      showToast('Please provide details or a subject line.', 'error');
      return;
    }

    setLoading(true);
    setOutput('');

    try {
      const systemPrompt = buildSystemPrompt(draftType, emailType);
      const result = await apiPost('/api/draft', {
        prompt: buildPrompt(),
        draftType,
        tone,
        additionalContext: systemPrompt,
      });
      setOutput(result.content || result.draft || result.result || '');
    } catch (err) {
      showToast(err.message || 'Failed to generate draft. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRefine() {
    if (!refineText.trim()) {
      showToast('Please describe what you\'d like to change.', 'error');
      return;
    }

    setRefining(true);

    try {
      const systemPrompt = buildSystemPrompt(draftType, emailType);
      const result = await apiPost('/api/draft', {
        prompt: `Original draft:\n${output}\n\nPlease refine this draft with the following changes: ${refineText.trim()}`,
        draftType,
        tone,
        additionalContext: systemPrompt,
      });
      setOutput(result.content || result.draft || result.result || '');
      setRefineText('');
      showToast('Draft refined successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to refine draft. Please try again.', 'error');
    } finally {
      setRefining(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(output).then(
      () => showToast('Copied to clipboard!', 'success'),
      () => showToast('Failed to copy to clipboard.', 'error')
    );
  }

  function getDetailsPlaceholder() {
    if (draftType === 'email' && emailType) {
      return EMAIL_DETAILS_PLACEHOLDERS[emailType] || 'Provide any additional details or context...';
    }
    if (draftType === 'social') {
      return 'E.g., Announce our January Early Bird draw with $125,000 in prizes, 18 winners, draws starting Jan 15...';
    }
    if (draftType === 'media-release') {
      return 'E.g., Announce the Grand Prize winner of $1.2M, include quote from CEO, mention next draw details...';
    }
    if (draftType === 'ad') {
      return 'E.g., Promote our Spring draw with $500K Grand Prize, early bird deadline March 1, target audience lottery enthusiasts...';
    }
    return 'Describe what you want to create...';
  }

  function getDraftTypeIcon(type) {
    const option = DRAFT_TYPE_OPTIONS.find((o) => o.key === type);
    return option ? option.icon : '';
  }

  // Step 1: Content Type Selection
  function renderTypeSelection() {
    return (
      <div className="draft-type-section">
        <div className="draft-type-header">
          <h2>What would you like to create?</h2>
          <p>Select a content type to get started</p>
        </div>
        <div className="draft-type-grid">
          {DRAFT_TYPE_OPTIONS.map((option) => (
            <button
              key={option.key}
              className="draft-type-btn"
              onClick={() => setDraftType(option.key)}
            >
              <span className="draft-type-icon">{option.icon}</span>
              <span className="draft-type-label">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 2a: Email type selection and input
  function renderEmailInput() {
    return (
      <div className="draft-email-type-section">
        <div className="draft-selected-badge">
          <span className="draft-badge-icon">{getDraftTypeIcon('email')}</span>
          <span className="draft-badge-label">{DRAFT_TYPE_LABELS.email}</span>
          <button className="draft-change-type-btn" onClick={() => setDraftType(null)}>
            Change type
          </button>
        </div>

        <div className="draft-form-group">
          <label htmlFor="email-type-select">Email Type</label>
          <select
            id="email-type-select"
            className="draft-select"
            value={emailType}
            onChange={(e) => setEmailType(e.target.value)}
          >
            <option value="">Select an email type...</option>
            {Object.entries(EMAIL_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {emailType === 'impact-sunday' && (
          <div className="draft-form-group">
            <label htmlFor="impact-context">Impact Context</label>
            <textarea
              id="impact-context"
              className="draft-textarea"
              rows={3}
              placeholder="Tell us about the equipment purchased or funding provided (e.g., $50,000 MRI machine for Regional Hospital)..."
              value={impactContext}
              onChange={(e) => setImpactContext(e.target.value)}
            />
          </div>
        )}

        <div className="draft-form-group">
          <label htmlFor="email-details">
            {emailType && EMAIL_DETAILS_LABELS[emailType]
              ? EMAIL_DETAILS_LABELS[emailType]
              : 'Additional Details'}
          </label>
          <textarea
            id="email-details"
            className="draft-textarea"
            rows={4}
            placeholder={getDetailsPlaceholder()}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>

        <div className="draft-form-group">
          <label htmlFor="subject-line">Subject Line</label>
          <input
            id="subject-line"
            type="text"
            className="draft-input"
            placeholder="Enter a subject line or leave blank to auto-generate..."
            value={subjectLine}
            onChange={(e) => setSubjectLine(e.target.value)}
          />
        </div>

        <div className="draft-addons-section">
          <h4>Add-ons</h4>
          <label className="draft-checkbox-label">
            <input
              type="checkbox"
              checked={includeTicketLink}
              onChange={(e) => setIncludeTicketLink(e.target.checked)}
            />
            Include ticket link
          </label>
          <label className="draft-checkbox-label">
            <input
              type="checkbox"
              checked={includeDrawSchedule}
              onChange={(e) => setIncludeDrawSchedule(e.target.checked)}
            />
            Include draw schedule
          </label>
        </div>

        <button
          className="draft-generate-btn"
          onClick={handleGenerate}
          disabled={loading || !emailType}
        >
          {loading ? 'Generating...' : 'Generate Draft'}
        </button>
      </div>
    );
  }

  // Step 2b: Generic input for social, media-release, ad
  function renderGenericInput() {
    return (
      <div className="draft-input-section">
        <div className="draft-selected-badge">
          <span className="draft-badge-icon">{getDraftTypeIcon(draftType)}</span>
          <span className="draft-badge-label">{DRAFT_TYPE_LABELS[draftType]}</span>
          <button className="draft-change-type-btn" onClick={() => setDraftType(null)}>
            Change type
          </button>
        </div>

        <div className="draft-form-group">
          <label htmlFor="draft-details">Details</label>
          <textarea
            id="draft-details"
            className="draft-textarea"
            rows={5}
            placeholder={getDetailsPlaceholder()}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>

        <div className="draft-form-group">
          <label>Tone</label>
          <div className="draft-tone-selector">
            {TONE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`draft-tone-btn${tone === opt.value ? ' active' : ''}`}
                onClick={() => setTone(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          className="draft-generate-btn"
          onClick={handleGenerate}
          disabled={loading || !details.trim()}
        >
          {loading ? 'Generating...' : 'Generate Draft'}
        </button>
      </div>
    );
  }

  // Step 3: Output section
  function renderOutput() {
    if (!output && !loading) return null;

    return (
      <div className="draft-output-section">
        {loading && !output ? (
          <div className="draft-loading">
            <div className="loading-spinner" />
            <p>Generating your draft...</p>
          </div>
        ) : (
          <>
            <div className="draft-output-box">
              <pre className="draft-output-content">{output}</pre>
            </div>

            <div className="draft-action-bar">
              <button className="draft-action-btn" onClick={handleCopy}>
                Copy
              </button>
              <button
                className="draft-action-btn"
                onClick={handleGenerate}
                disabled={loading}
              >
                {loading ? 'Regenerating...' : 'Regenerate'}
              </button>
            </div>

            <div className="draft-refine-section">
              <textarea
                className="draft-textarea"
                rows={3}
                placeholder="Want to refine this? Tell us what to change..."
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
              />
              <button
                className="draft-refine-btn"
                onClick={handleRefine}
                disabled={refining || !refineText.trim()}
              >
                {refining ? 'Refining...' : 'Refine'}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="tool-page">
      <ToolHeader title="Draft Assistant">
        {draftType && (
          <button className="new-draft-btn" onClick={resetFlow}>
            New Draft
          </button>
        )}
      </ToolHeader>

      <main className="tool-main">
        {!draftType && renderTypeSelection()}
        {draftType === 'email' && renderEmailInput()}
        {draftType && draftType !== 'email' && renderGenericInput()}
        {renderOutput()}
      </main>

      <Footer />
    </div>
  );
}
