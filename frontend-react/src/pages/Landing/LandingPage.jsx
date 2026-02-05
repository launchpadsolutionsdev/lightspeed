import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

const FEATURES = [
  {
    icon: '✍️',
    title: 'Draft Assistant',
    description:
      'Create on-brand social media posts, emails, media releases, and ads in seconds with AI that knows your voice.',
  },
  {
    icon: '📧',
    title: 'Response Assistant',
    description:
      'Generate professional, AI-powered responses to customer inquiries trained on your real support history.',
  },
  {
    icon: '📊',
    title: 'Insights Engine',
    description:
      'Upload Excel files and instantly generate visual dashboards with trends, summaries, and actionable insights.',
  },
  {
    icon: '🔄',
    title: 'List Normalizer',
    description:
      'Transform messy customer reports into clean, formatted, and standardized lists ready for action.',
  },
];

const DEMO_TABS = [
  {
    key: 'draft',
    label: 'Draft',
    heading: 'Draft Assistant',
    body: 'Generate a social media post for our upcoming 50/50 lottery draw...',
    sample:
      '🎉 The jackpot is climbing! Our 50/50 draw has already reached $127,000 and counting. Every ticket supports patient care at your local hospital. Don\'t miss your chance — get your tickets today! 🎟️ #5050 #HospitalLottery #SupportHealthcare',
  },
  {
    key: 'response',
    label: 'Response',
    heading: 'Response Assistant',
    body: 'Customer: "I bought tickets but never got a confirmation email."',
    sample:
      'Thank you for reaching out! I\'m sorry to hear you haven\'t received your confirmation. I\'ve located your order and resent the confirmation to your email. Please check your spam folder as well. If you still don\'t see it within 15 minutes, please let me know and I\'ll be happy to help further.',
  },
  {
    key: 'insights',
    label: 'Insights',
    heading: 'Insights Engine',
    body: 'Upload: Q4_Sales_Report.xlsx',
    sample:
      '📈 Revenue up 23% QoQ  |  📊 12,847 tickets sold  |  🏆 Top channel: Online (68%)  |  📉 Phone sales declining (-11%)  |  💡 Recommendation: Shift budget to digital campaigns',
  },
  {
    key: 'normalizer',
    label: 'Normalizer',
    heading: 'List Normalizer',
    body: 'Input: "john smith, JANE DOE, Bob johnson, alice WILLIAMS..."',
    sample:
      '1. Smith, John\n2. Doe, Jane\n3. Johnson, Bob\n4. Williams, Alice\n\n✅ 4 names normalized  |  Format: Last, First  |  Duplicates: 0',
  },
];

const STEPS = [
  {
    number: '1',
    title: 'Onboarding Call',
    description:
      'We learn about your organization, your workflows, and your goals so Lightspeed fits like a glove.',
  },
  {
    number: '2',
    title: 'Knowledge Base Setup',
    description:
      'We configure your AI knowledge base with your brand voice, FAQs, past content, and customer data.',
  },
  {
    number: '3',
    title: 'Start Working',
    description:
      'Your team logs in and starts working at Lightspeed. No training manuals — just intuitive, powerful tools.',
  },
];

const FREE_FEATURES = [
  'All 4 AI tools',
  'Up to 50 generations',
  'Email support',
  '1 team member',
  'Basic knowledge base',
];

const PRO_FEATURES = [
  'All 4 AI tools',
  'Unlimited generations',
  'Priority support',
  'Unlimited team members',
  'Custom knowledge base',
  'Dedicated onboarding',
  'Advanced analytics',
  'API access',
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [activeDemo, setActiveDemo] = useState('draft');
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-visible');
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    const elements = document.querySelectorAll('.animate-on-scroll');
    elements.forEach((el) => observer.observe(el));

    return () => {
      elements.forEach((el) => observer.unobserve(el));
    };
  }, []);

  const scrollToFeatures = () => {
    const el = document.getElementById('features');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const currentDemo = DEMO_TABS.find((t) => t.key === activeDemo);
  const proPrice = billingCycle === 'annual' ? 449 : 499;

  return (
    <div className="landing-page">
      {/* Parallax background orbs */}
      <div className="parallax-orb parallax-orb-1" />
      <div className="parallax-orb parallax-orb-2" />
      <div className="parallax-orb parallax-orb-3" />
      <div className="parallax-orb parallax-orb-4" />

      {/* Top Banner */}
      <div className="landing-top-banner">
        <span>
          🚀 Lightspeed is now available! Start your free trial today.
        </span>
      </div>

      {/* Navigation */}
      <nav className={`landing-nav${scrolled ? ' landing-nav-scrolled' : ''}`}>
        <div className="landing-nav-inner">
          <div className="landing-nav-brand">
            <img
              src="/launchpad-logo.svg"
              alt="Lightspeed logo"
              className="landing-nav-logo"
            />
            <span className="landing-nav-brand-text">Lightspeed</span>
          </div>
          <button
            className="landing-nav-cta"
            onClick={() => navigate('/login')}
          >
            Launch App
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="landing-hero">
        <div className="landing-hero-content animate-on-scroll">
          <span className="landing-section-tag">AI-Powered Productivity</span>
          <h1 className="landing-hero-title">Work at the speed of light.</h1>
          <p className="landing-hero-subtitle">
            Lightspeed is the AI-powered productivity suite built for charitable
            gaming and nonprofit organizations. Draft content, respond to
            customers, analyze data, and normalize lists — all in seconds.
          </p>
          <div className="landing-hero-buttons">
            <button
              className="landing-btn landing-btn-primary"
              onClick={() => navigate('/login')}
            >
              Start Free Trial
            </button>
            <button
              className="landing-btn landing-btn-secondary"
              onClick={scrollToFeatures}
            >
              See Features
            </button>
          </div>
        </div>
      </section>

      {/* Why Lightspeed Section */}
      <section className="landing-section landing-section-dark">
        <div className="landing-section-inner animate-on-scroll">
          <div className="landing-section-header">
            <span className="landing-section-tag">Why Lightspeed</span>
            <h2 className="landing-section-title">
              Leverage the Power of AI.
            </h2>
            <p className="landing-section-subtitle">
              Built by the team behind Canada's largest hospital 50/50 lottery,
              every feature in Lightspeed was born from real operational
              challenges. Our AI has been trained on tens of thousands of
              real-world examples so it delivers results that actually work.
            </p>
          </div>
          <div className="landing-benefits-grid">
            <div className="landing-benefit-card">
              <span className="landing-benefit-icon">🏥</span>
              <h3>Built by Operators</h3>
              <p>
                We run lotteries ourselves. Every feature solves a problem we
                face daily — so you know it works in the real world.
              </p>
            </div>
            <div className="landing-benefit-card">
              <span className="landing-benefit-icon">📊</span>
              <h3>Trained on Real Data</h3>
              <p>
                Our models are fine-tuned on tens of thousands of real customer
                interactions, marketing campaigns, and operational datasets.
              </p>
            </div>
            <div className="landing-benefit-card">
              <span className="landing-benefit-icon">🚀</span>
              <h3>Always Improving</h3>
              <p>
                Lightspeed learns from every interaction and continuously
                improves. New features and enhancements ship every month.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section
        id="features"
        className="landing-section landing-section-light"
      >
        <div className="landing-section-inner animate-on-scroll">
          <div className="landing-section-header">
            <span className="landing-section-tag">Features</span>
            <h2 className="landing-section-title">Work at Lightspeed.</h2>
            <p className="landing-section-subtitle">
              Four purpose-built AI tools designed to eliminate busywork and let
              your team focus on what matters most.
            </p>
          </div>
          <div className="landing-features-grid">
            {FEATURES.map((feature) => (
              <div className="landing-feature-card" key={feature.title}>
                <span className="landing-feature-icon">{feature.icon}</span>
                <h3 className="landing-feature-title">{feature.title}</h3>
                <p className="landing-feature-description">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo Section */}
      <section className="landing-section landing-section-dark">
        <div className="landing-section-inner animate-on-scroll">
          <div className="landing-section-header">
            <span className="landing-section-tag">See It In Action</span>
            <h2 className="landing-section-title">
              Try it for free today.
            </h2>
          </div>
          <div className="landing-demo-tabs">
            {DEMO_TABS.map((tab) => (
              <button
                key={tab.key}
                className={`landing-demo-tab${activeDemo === tab.key ? ' landing-demo-tab-active' : ''}`}
                onClick={() => setActiveDemo(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {currentDemo && (
            <div className="landing-demo-panel">
              <div className="landing-demo-panel-header">
                <h3>{currentDemo.heading}</h3>
              </div>
              <div className="landing-demo-panel-body">
                <div className="landing-demo-input">
                  <span className="landing-demo-label">Input</span>
                  <p>{currentDemo.body}</p>
                </div>
                <div className="landing-demo-divider" />
                <div className="landing-demo-output">
                  <span className="landing-demo-label">AI Output</span>
                  <p className="landing-demo-sample">{currentDemo.sample}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* How It Works Section */}
      <section className="landing-section landing-section-light">
        <div className="landing-section-inner animate-on-scroll">
          <div className="landing-section-header">
            <span className="landing-section-tag">How It Works</span>
            <h2 className="landing-section-title">
              We set it up. You start working.
            </h2>
          </div>
          <div className="landing-steps-grid">
            {STEPS.map((step, idx) => (
              <div className="landing-step-card" key={step.number}>
                <div className="landing-step-number">{step.number}</div>
                <h3 className="landing-step-title">{step.title}</h3>
                <p className="landing-step-description">{step.description}</p>
                {idx < STEPS.length - 1 && (
                  <div className="landing-step-connector" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Always Improving Section */}
      <section className="landing-section landing-section-dark">
        <div className="landing-section-inner animate-on-scroll">
          <div className="landing-section-header">
            <span className="landing-section-tag">Always Improving</span>
            <h2 className="landing-section-title">
              Lightspeed evolves with you.
            </h2>
            <p className="landing-section-subtitle">
              Every interaction makes Lightspeed smarter. Our AI continuously
              learns from your organization's unique voice, workflows, and data
              — so the more you use it, the better it gets. We ship new features
              and improvements every month based on direct feedback from
              operators like you.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="landing-section landing-section-light">
        <div className="landing-section-inner animate-on-scroll">
          <div className="landing-section-header">
            <span className="landing-section-tag">Pricing</span>
            <h2 className="landing-section-title">
              Simple, transparent pricing.
            </h2>
          </div>
          <div className="landing-pricing-toggle">
            <button
              className={`landing-pricing-toggle-btn${billingCycle === 'monthly' ? ' active' : ''}`}
              onClick={() => setBillingCycle('monthly')}
            >
              Monthly
            </button>
            <button
              className={`landing-pricing-toggle-btn${billingCycle === 'annual' ? ' active' : ''}`}
              onClick={() => setBillingCycle('annual')}
            >
              Annual
            </button>
          </div>
          <div className="landing-pricing-grid">
            {/* Free Trial Card */}
            <div className="landing-pricing-card">
              <div className="landing-pricing-card-header">
                <h3 className="landing-pricing-plan-name">Free Trial</h3>
                <div className="landing-pricing-price">
                  <span className="landing-pricing-amount">$0</span>
                  <span className="landing-pricing-period">for 14 days</span>
                </div>
              </div>
              <ul className="landing-pricing-features">
                {FREE_FEATURES.map((feature) => (
                  <li key={feature}>
                    <span className="landing-pricing-check">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                className="landing-btn landing-btn-secondary landing-pricing-btn"
                onClick={() => navigate('/login')}
              >
                Start Free Trial
              </button>
            </div>

            {/* Pro Card */}
            <div className="landing-pricing-card landing-pricing-card-featured">
              <div className="landing-pricing-badge">Recommended</div>
              <div className="landing-pricing-card-header">
                <h3 className="landing-pricing-plan-name">Pro</h3>
                <div className="landing-pricing-price">
                  <span className="landing-pricing-amount">${proPrice}</span>
                  <span className="landing-pricing-period">/month</span>
                </div>
                {billingCycle === 'annual' && (
                  <span className="landing-pricing-save">Save 10%</span>
                )}
              </div>
              <ul className="landing-pricing-features">
                {PRO_FEATURES.map((feature) => (
                  <li key={feature}>
                    <span className="landing-pricing-check">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                className="landing-btn landing-btn-primary landing-pricing-btn"
                onClick={() => navigate('/login')}
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="landing-cta-section">
        <div className="landing-cta-inner animate-on-scroll">
          <h2 className="landing-cta-title">
            Ready to work at Lightspeed?
          </h2>
          <button
            className="landing-btn landing-btn-primary landing-cta-btn"
            onClick={() => navigate('/login')}
          >
            Start Your Free Trial
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <img
              src="/launchpad-logo.svg"
              alt="Lightspeed logo"
              className="landing-footer-logo"
            />
            <span className="landing-footer-brand-text">Lightspeed</span>
          </div>
          <div className="landing-footer-links">
            <a
              href="https://launchpadlotteries.com"
              target="_blank"
              rel="noopener noreferrer"
              className="landing-footer-link"
            >
              Visit Launchpad
            </a>
            <button className="landing-footer-link-btn">Privacy</button>
            <button className="landing-footer-link-btn">Terms</button>
          </div>
          <div className="landing-footer-copyright">
            &copy; {new Date().getFullYear()} Lightspeed. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
