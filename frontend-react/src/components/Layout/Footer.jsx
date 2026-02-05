import { useState } from 'react';
import LegalModal from '../common/LegalModal';

export default function Footer() {
  const [legalType, setLegalType] = useState(null);

  return (
    <>
      <footer className="site-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <img src="/launchpad-logo.svg" alt="Launchpad" onError={(e) => (e.target.style.display = 'none')} />
            <span className="footer-brand-text">Lightspeed by Launchpad</span>
          </div>
          <div className="footer-links">
            <a href="https://launchpadsolutions.ca" target="_blank" rel="noopener noreferrer" className="footer-link">
              Visit Launchpad
            </a>
          </div>
          <div className="footer-legal">
            <button className="footer-legal-link" onClick={() => setLegalType('privacy')}>Privacy Policy</button>
            <span className="footer-divider">|</span>
            <button className="footer-legal-link" onClick={() => setLegalType('terms')}>Terms of Service</button>
          </div>
          <div className="footer-copyright">&copy; 2026 Launchpad Solutions. All rights reserved.</div>
        </div>
      </footer>
      <LegalModal type={legalType} onClose={() => setLegalType(null)} />
    </>
  );
}
