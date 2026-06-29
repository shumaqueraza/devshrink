import { create, clear, prefersReducedMotion } from './ui.js';

export class TerminalFeed {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.body = this.container.querySelector('.terminal-body');
    this.countEl = this.container.querySelector('.terminal-count');
    this.entries = [];
    this.autoScroll = true;

    this.body.addEventListener('scroll', () => {
      const el = this.body;
      this.autoScroll = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    });
  }

  write(text, category = 'info') {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const line = create('div', { className: `terminal-line ${category}` }, [
      create('span', { className: 'terminal-time' }, [time]),
      create('span', { className: 'terminal-text' }, [text])
    ]);
    this.body.appendChild(line);
    this.entries.push({ time, text, category });

    if (this.countEl) {
      this.countEl.textContent = `${this.entries.length} lines`;
    }

    if (this.autoScroll) {
      this.body.scrollTop = this.body.scrollHeight;
    }

    if (!prefersReducedMotion()) {
      line.style.animation = 'terminalSlideIn 200ms ease both';
    }
  }

  info(text) { this.write(text, 'info'); }
  success(text) { this.write(text, 'success'); }
  warn(text) { this.write(text, 'warn'); }
  error(text) { this.write(text, 'error'); }
  system(text) { this.write(text, 'system'); }

  clear() {
    clear(this.body);
    this.entries = [];
    if (this.countEl) this.countEl.textContent = '0 lines';
  }
}
