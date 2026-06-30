import { create, prefersReducedMotion } from './ui.js';

export class MermaidRenderer {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: 'dark',
      themeVariables: {
        background: '#0a0a0c',
        primaryColor: '#1c1c21',
        primaryTextColor: '#e8e8ec',
        primaryBorderColor: '#38383f',
        lineColor: '#58a6ff',
        secondaryColor: '#141417',
        tertiaryColor: '#0a0a0c',
        edgeLabelBackground: '#141417',
        clusterBkg: '#141417',
        titleColor: '#e8e8ec',
        nodeTextColor: '#e8e8ec',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: '13px'
      },
      flowchart: { curve: 'basis', padding: 20 }
    });
    mermaid.parseError = () => {};
    this.initialized = true;
  }

  _sanitize(code) {
    code = code.replace(/;\s*$/gm, '');
    code = code.replace(/\[([^\]]*)\]/g, (m, c) => `[${c.replace(/[()]/g, '')}]`);
    return code;
  }

  async renderAll(container) {
    this.init();
    const codeBlocks = container.querySelectorAll('pre code.language-mermaid');
    const results = [];
    for (const codeEl of codeBlocks) {
      const pre = codeEl.parentElement;
      const code = codeEl.textContent.trim();
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const wrap = document.createElement('div');
      wrap.className = 'mermaid-block';
      wrap.id = id;
      pre.parentElement.replaceChild(wrap, pre);

      const result = await this._renderOne(id, code);
      results.push(result);
      if (result.success) {
        wrap.innerHTML = result.svg;
        if (!prefersReducedMotion()) {
          wrap.style.animation = 'fadeSlideUp 400ms ease both';
        }
      } else {
        wrap.innerHTML = this._buildErrorCard();
      }
    }
    return results;
  }

  async _renderOne(id, code) {
    try {
      const { svg } = await mermaid.render(`svg-${id}`, this._sanitize(code));
      return { success: true, svg };
    } catch (err) {
      console.warn('Mermaid render failed:', err);
      return { success: false };
    }
  }

  _buildErrorCard() {
    const card = create('div', { className: 'mermaid-fallback' }, [
      create('div', { className: 'mermaid-fallback-icon' }, ['\u26A0\uFE0F']),
      create('div', { className: 'mermaid-fallback-title' }, ['Diagram unavailable']),
      create('div', { className: 'mermaid-fallback-text' }, ['This visualization could not be rendered. The diagram data may contain unsupported syntax.'])
    ]);
    return card.outerHTML;
  }
}
