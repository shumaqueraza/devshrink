import { qs, qsa, show, hide, copyToClipboard, prefersReducedMotion } from './ui.js';
import { Analyzer } from './analyzer.js';

const app = {
  analyzer: null,
  analyzing: false,
  landingView: qs('#landingView'),
  analysisView: qs('#analysisView'),
  repoInput: qs('#repoInput'),
  analyzeBtn: qs('#analyzeBtn'),
  headerRepo: qs('#headerRepo'),
  headerBadge: qs('#headerBadge'),

  init() {
    this.analyzer = new Analyzer();

    this._initProviderToggle();

    this.analyzeBtn.addEventListener('click', () => this.startAnalysis());
    this.repoInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.startAnalysis();
    });

    qsa('.example-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this.repoInput.value = chip.dataset.url;
        this.startAnalysis();
      });
    });

    qs('#copyBtn').addEventListener('click', () => this._copyOutput());
    qs('#newBtn').addEventListener('click', () => this._newAnalysis());

    this.repoInput.focus();

    if (!prefersReducedMotion()) {
      this._animateEntrance();
    }
  },

  startAnalysis() {
    if (this.analyzing) return;

    const url = this.repoInput.value.trim();
    if (!url) return;

    if (!url.match(/github\.com\//)) {
      this._showValidationError('Please enter a valid GitHub URL');
      return;
    }

    this.analyzing = true;
    this.analyzeBtn.disabled = true;
    this.analyzeBtn.textContent = 'Analyzing...';

    this.landingView.hidden = true;
    this.analysisView.hidden = false;

    if (!prefersReducedMotion()) {
      this.analysisView.style.animation = 'none';
      void this.analysisView.offsetHeight;
      this.analysisView.style.animation = 'fadeSlideUp 400ms ease both';
    }

    const provider = {};
    const apiKey = qs('#apiKeyInput').value.trim();
    const baseUrl = qs('#baseUrlInput').value.trim();
    const model = qs('#modelInput').value.trim();
    if (apiKey) provider.api_key = apiKey;
    if (baseUrl) provider.base_url = baseUrl;
    if (model) provider.model = model;

    this.analyzer.start(url, provider).then(() => {
      this._finishAnalysis();
    }).catch(() => {
      this._finishAnalysis();
    });
  },

  _finishAnalysis() {
    this.analyzing = false;
    this.analyzeBtn.disabled = false;
    this.analyzeBtn.textContent = 'Analyze \u2192';
  },

  _showValidationError(msg) {
    const toast = qs('#errorToast');
    toast.textContent = msg;
    toast.hidden = false;
    toast.style.animation = 'none';
    requestAnimationFrame(() => {
      toast.style.animation = 'toastSlideIn 300ms ease forwards';
    });
    setTimeout(() => {
      toast.style.animation = 'toastSlideOut 300ms ease forwards';
      setTimeout(() => { toast.hidden = true; }, 300);
    }, 3000);
  },

  _newAnalysis() {
    this.analyzer._reset('');
    this.analysisView.hidden = true;
    this.landingView.hidden = false;
    this.repoInput.value = '';
    this.repoInput.focus();
    this._finishAnalysis();
  },

  _copyOutput() {
    if (!this.analyzer || !this.analyzer.rawMarkdown) return;
    copyToClipboard(this.analyzer.rawMarkdown).then(() => {
      const btn = qs('#copyBtn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  },

  _initProviderToggle() {
    const toggle = qs('#providerToggle');
    const fields = qs('#providerFields');
    if (!toggle) return;
    const toggleFn = () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', !expanded);
      fields.hidden = expanded;
    };
    toggle.addEventListener('click', toggleFn);
    toggle.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFn(); }
    });
  },

  _animateEntrance() {
    const els = [
      qs('.landing-title'),
      qs('.landing-subtitle'),
      qs('.input-group'),
      qs('.examples')
    ];
    els.forEach((el, i) => {
      if (!el) return;
      el.style.opacity = '0';
      el.style.transform = 'translateY(16px)';
      setTimeout(() => {
        el.style.transition = 'opacity 500ms ease, transform 500ms var(--ease-spring)';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, 100 + i * 120);
    });
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());
