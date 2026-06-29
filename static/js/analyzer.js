import { qs, show, hide, create, clear, formatTime } from './ui.js';
import { TerminalFeed } from './terminal.js';
import { Dashboard } from './dashboard.js';
import { Charts } from './charts.js';
import { MermaidRenderer } from './mermaid-renderer.js';

export class Analyzer {
  constructor() {
    this.terminal = new TerminalFeed('terminal');
    this.dashboard = new Dashboard('dashboard');
    this.charts = new Charts();
    this.mermaid = new MermaidRenderer();
    this.rawMarkdown = '';
    this.startTime = 0;
    this.timerInterval = null;
    this.currentStep = null;
    this.pipelineData = {};

    this.outputBody = qs('#outputBody');
    this.outputWrap = qs('#outputWrap');
    this.errorToast = qs('#errorToast');
    this.pipelineEl = qs('#pipeline');
    this.headerTimer = qs('#headerTimer');
    this.headerRepo = qs('#headerRepo');
    this.headerBadge = qs('#headerBadge');
    this.analyzeBtn = qs('#analyzeBtn');
    this.repoInput = qs('#repoInput');

    this._es = null;
    this._esClosed = false;
    this._scrollLocked = false;
    this._renderPending = false;

    this._pipelineSteps = [
      { id: 'validating', label: 'Validating repository' },
      { id: 'fetching', label: 'Fetching repository data' },
      { id: 'tree', label: 'Downloading file tree' },
      { id: 'selecting', label: 'Selecting signal files' },
      { id: 'reading', label: 'Reading source files' },
      { id: 'generating', label: 'AI generating report' },
    ];

    this._renderPipeline();
  }

  _esClose() {
    this._esClosed = true;
    if (this._es) {
      this._es.close();
      this._es = null;
    }
  }

  _renderPipeline() {
    clear(this.pipelineEl);
    for (const step of this._pipelineSteps) {
      step.el = create('div', {
        className: 'pipeline-step',
        dataset: { stepId: step.id }
      }, [
        create('div', { className: 'step-indicator' }, [
          create('div', { className: 'step-dot' })
        ]),
        create('div', { className: 'step-body' }, [
          create('span', { className: 'step-label' }, [step.label]),
          create('span', { className: 'step-time' })
        ])
      ]);
      this.pipelineEl.appendChild(step.el);
    }
  }

  async start(url) {
    this._reset(url);
    this.outputBody.classList.add('streaming');

    const match = url.match(/github\.com\/([^\/]+)\/([^\/\s]+)/);
    const repoFull = match ? match[1].replace('.git', '') : url;
    this.headerRepo.textContent = repoFull;
    this.headerRepo.hidden = false;
    this.headerBadge.hidden = true;

    this.startTime = Date.now();
    this.timerInterval = setInterval(() => {
      this.headerTimer.textContent = formatTime((Date.now() - this.startTime) / 1000);
    }, 200);

    return new Promise((resolve) => {
      this._es = new EventSource(`/analyze?url=${encodeURIComponent(url)}`);

      this._es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleEvent(data);
          if (data.type === 'done' || data.type === 'error') {
            resolve();
          }
        } catch (e) {
          console.warn('SSE parse error:', e);
        }
      };

      this._es.onerror = () => {
        if (!this._esClosed) {
          this._esClosed = true;
          this._showError('Connection lost. Please try again.');
          resolve();
        }
      };
    });
  }

  _handleEvent(data) {
    switch (data.type) {
      case 'pipeline_step':
        this._updatePipeline(data.step, data.status);
        break;

      case 'terminal_line':
        this.terminal.write(data.text, data.category || 'info');
        break;

      case 'repo_metadata':
        this.pipelineData.stars = data.stars;
        this.pipelineData.forks = data.forks;
        this.pipelineData.license = data.license;
        this.pipelineData.topics = data.topics;
        this.pipelineData.default_branch = data.default_branch;
        this.pipelineData.language = data.language;
        this.pipelineData.size = data.size;
        this.pipelineData.owner = data.owner;
        this.pipelineData.name = data.name;
        break;

      case 'languages':
        this.pipelineData.languages = data.data;
        break;

      case 'dashboard_data':
        Object.assign(this.pipelineData, data.data);
        break;

      case 'chunk':
        this._appendChunk(data.text);
        break;

      case 'error':
        if (this.currentStep) {
          this._updatePipeline(this.currentStep, 'error');
        }
        this._showError(data.message);
        this._esClose();
        break;

      case 'done':
        this._finalize();
        this._esClose();
        break;
    }
  }

  _updatePipeline(stepId, status) {
    const step = this._pipelineSteps.find(s => s.id === stepId);
    if (!step || !step.el) return;

    const wasActive = this.currentStep === stepId && status === 'active';
    step.el.className = `pipeline-step ${status}`;
    this.currentStep = stepId;

    const timeEl = step.el.querySelector('.step-time');
    if (status === 'done' || status === 'active') {
      if (status === 'active') {
        timeEl.textContent = 'running...';
        step._startTime = Date.now();
      } else {
        const elapsed = ((Date.now() - (step._startTime || Date.now())) / 1000).toFixed(1);
        timeEl.textContent = `${elapsed}s`;
      }
    }

    if (status === 'done' && !wasActive) {
      this.terminal.success(step.label);
    }

    if (stepId === 'generating' && status === 'active') {
      show(this.outputWrap);
    }
  }

  _appendChunk(text) {
    this.rawMarkdown += text;
    this._scheduleRender();
  }

  _scheduleRender() {
    if (this._renderPending) return;
    this._renderPending = true;
    requestAnimationFrame(() => {
      if (!this._renderPending) return;
      this._renderPending = false;
      try {
        this.outputBody.innerHTML = marked.parse(this.rawMarkdown);
      } catch (e) {
        console.warn('Markdown render error:', e);
      }
      if (!this._scrollLocked) {
        const wrap = this.outputWrap;
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
      }
    });
  }

  async _finalize() {
    clearInterval(this.timerInterval);

    this._renderPending = false;

    this.outputBody.classList.remove('streaming');

    show(this.outputWrap);

    this._renderFinalMarkdown();

    await this.mermaid.renderAll(this.outputBody);

    this._buildDashboard();
  }

  _renderFinalMarkdown() {
    this.outputBody.innerHTML = marked.parse(this.rawMarkdown);
  }

  _buildDashboard() {
    const data = this.pipelineData;
    if (!data.total_files) return;

    const radar = this._computeRadar(data);

    data.radar = radar;

    this.dashboard.build(data);

    setTimeout(() => {
      this.charts.create(this.dashboard.getChartData());
    }, 100);

    this.outputWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  _computeRadar(data) {
    const docRatio = (data.doc_files || 0) / Math.max(data.source_files || 1, 1);
    const testFiles = data.test_files || 0;
    const testRatio = testFiles / Math.max(data.source_files || 1, 1);
    const hasLicense = data.license && data.license !== 'Unknown' ? 15 : 0;
    const hasReadme = data.has_readme ? 10 : 0;
    const avgDepth = data.avg_depth || 3;

    return {
      maintainability: Math.min(85, Math.round(50 + (data.source_files > 0 ? 10 : 0) + (docRatio > 0.1 ? 10 : 0) + (avgDepth < 4 ? 10 : 0))),
      architecture: Math.min(85, Math.round(40 + (data.selected_files > 3 ? 15 : 0) + (data.topics && data.topics.length > 0 ? 10 : 0) + hasLicense)),
      documentation: Math.min(95, Math.round(30 + docRatio * 40 + hasReadme)),
      testing: Math.min(90, Math.round(testRatio * 60 + (testFiles > 0 ? 20 : 0))),
      readability: Math.min(85, Math.round(50 + (data.source_files < 100 ? 15 : 0) + (avgDepth < 4 ? 10 : 0))),
      modularity: Math.min(85, Math.round(40 + (data.directories > 5 ? 15 : 0) + (avgDepth >= 2 && avgDepth <= 5 ? 15 : 0))),
    };
  }

  _showError(message) {
    clearInterval(this.timerInterval);
    this.outputBody.classList.remove('streaming');
    this.errorToast.textContent = message;
    this.errorToast.hidden = false;
    this.errorToast.style.animation = 'none';
    requestAnimationFrame(() => {
      this.errorToast.style.animation = 'toastSlideIn 300ms ease forwards';
    });
    setTimeout(() => {
      this.errorToast.style.animation = 'toastSlideOut 300ms ease forwards';
      setTimeout(() => { this.errorToast.hidden = true; }, 300);
    }, 5000);
  }

  _reset(url) {
    this._esClose();
    this.rawMarkdown = '';
    hide(this.errorToast);
    hide(this.outputWrap);
    this.outputBody.innerHTML = '';
    this.terminal.clear();
    clearInterval(this.timerInterval);
    this.charts.destroy();
    this._renderPipeline();
    this.pipelineData = {};
    this.currentStep = null;
  }
}
