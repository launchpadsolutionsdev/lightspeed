import Modal from './Modal';

export default function UpgradeModal({ show, onClose, reason, usageCount, limit }) {
  let title = 'Upgrade to Continue';
  let message = '';

  if (reason === 'limit') {
    title = 'Trial Limit Reached';
    message = `You've used all ${limit} free generations. Upgrade now to unlock unlimited access!`;
  } else if (reason === 'expired') {
    title = 'Trial Expired';
    message = 'Your 14-day free trial has ended. Upgrade to continue using Lightspeed.';
  }

  return (
    <Modal show={show} onClose={onClose} className="upgrade-modal">
      <div className="upgrade-header">
        <div className="upgrade-icon">⚡</div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
      <div className="upgrade-features">
        <div className="upgrade-feature">
          <span className="feature-icon">✓</span>
          <span>Unlimited AI generations</span>
        </div>
        <div className="upgrade-feature">
          <span className="feature-icon">✓</span>
          <span>Custom knowledge base</span>
        </div>
        <div className="upgrade-feature">
          <span className="feature-icon">✓</span>
          <span>Priority support</span>
        </div>
      </div>
      <div className="upgrade-pricing">
        <div className="upgrade-price">$499<span>/month</span></div>
        <p>or $449/month billed annually (save 10%)</p>
      </div>
      <div className="upgrade-actions">
        <a
          href="mailto:hello@launchpadsolutions.ca?subject=Lightspeed%20Upgrade%20Request"
          className="btn-primary btn-upgrade"
        >
          Contact Us to Upgrade
        </a>
        <button className="btn-secondary" onClick={onClose}>Maybe Later</button>
      </div>
    </Modal>
  );
}
