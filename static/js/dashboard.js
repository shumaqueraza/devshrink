import { create, clear, formatNumber, show, prefersReducedMotion } from './ui.js';

const LANGUAGE_COLORS = {
  Python: '#3572A5', JavaScript: '#F7DF1E', TypeScript: '#3178C6',
  Go: '#00ADD8', Rust: '#DEA584', Java: '#B07219', Ruby: '#701516',
  PHP: '#4F5D95', C: '#555555', 'C++': '#F34B7D', 'C#': '#178600',
  HTML: '#E34F26', CSS: '#563D7C', SCSS: '#C6538C', Less: '#1D365D',
  Shell: '#89E051', Lua: '#000080', Kotlin: '#A97BFF', Swift: '#F05138',
  Dart: '#00B4AB', Scala: '#c22d40', Elixir: '#4E2A59', R: '#198CE7',
  Dockerfile: '#384D54', Makefile: '#427819', Haskell: '#5e5086',
  Clojure: '#db5855', Erlang: '#B83998', Julia: '#a270ba',
  Vue: '#4FC08D', Svelte: '#FF3E00', Solidity: '#AA6746',
  Terraform: '#623CE4', YAML: '#CB171E', Markdown: '#083fa1',
};

export class Dashboard {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  build(data) {
    clear(this.container);
    show(this.container);

    this._buildInfoCard(data);
    this._buildChartRow(data);
  }

  _buildInfoCard(data) {
    const card = create('div', { className: 'info-card' });

    const header = create('div', { className: 'info-card-header' });
    const name = create('span', { className: 'info-card-name' }, [
      `${data.owner || '?'}/${data.name || '?'}`
    ]);
    const stars = create('span', { className: 'info-card-stars', innerHTML: `&#9733; ${formatNumber(data.stars) || 0}` });
    header.appendChild(name);
    header.appendChild(stars);
    card.appendChild(header);

    const grid = create('div', { className: 'info-card-grid' });

    const fields = [
      { label: 'Stars', value: data.stars !== undefined ? formatNumber(data.stars) : '\u2014', mono: true },
      { label: 'Forks', value: data.forks !== undefined ? formatNumber(data.forks) : '\u2014', mono: true },
      { label: 'Language', value: data.language || '\u2014', mono: true },
      { label: 'Branch', value: data.default_branch || '\u2014', mono: true },
      { label: 'Files', value: data.total_files ? formatNumber(data.total_files) : '\u2014', mono: true },
      { label: 'Source', value: data.source_files ? formatNumber(data.source_files) : '\u2014', mono: true },
      { label: 'Selected', value: data.selected_files ? String(data.selected_files) : '\u2014', mono: true },
    ];

    for (const f of fields) {
      const item = create('div', { className: 'info-item' }, [
        create('span', { className: 'info-label' }, [f.label]),
        create('span', { className: `info-value${f.mono ? ' mono' : ''}` }, [f.value])
      ]);
      grid.appendChild(item);
    }

    card.appendChild(grid);

    if (data.topics && data.topics.length > 0) {
      const topicRow = create('div', { className: 'info-topics' }, [
        create('span', { className: 'info-label' }, ['Topics'])
      ]);
      const topicChips = create('span', { className: 'info-topic-chips' });
      const shown = data.topics.slice(0, 5);
      for (const t of shown) {
        topicChips.appendChild(create('span', { className: 'info-topic-chip' }, [t]));
      }
      if (data.topics.length > 5) {
        topicChips.appendChild(create('span', { className: 'info-topic-chip more' }, [`+${data.topics.length - 5}`]));
      }
      topicRow.appendChild(topicChips);
      card.appendChild(topicRow);
    }

    if (!prefersReducedMotion()) {
      card.style.animation = 'fadeSlideUp 350ms ease both';
    }

    this.container.appendChild(card);
  }

  _buildChartRow(data) {
    const row = create('div', { className: 'charts-row' });

    const radarWrap = create('div', { className: 'chart-container' }, [
      create('canvas', { id: 'radarChart' })
    ]);
    row.appendChild(radarWrap);

    const langWrap = create('div', { className: 'chart-container lang-chart' });
    this._buildLanguageBar(data.languages, langWrap);
    row.appendChild(langWrap);

    this.container.appendChild(row);

    this._radarData = data.radar || {
      maintainability: 0, architecture: 0, documentation: 0,
      testing: 0, readability: 0, modularity: 0
    };
  }

  _buildLanguageBar(languages, container) {
    if (!languages || Object.keys(languages).length === 0) return;

    const total = Object.values(languages).reduce((a, b) => a + b, 0);
    const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
    const topEntries = entries.slice(0, 8);
    const otherBytes = entries.slice(8).reduce((sum, [, bytes]) => sum + bytes, 0);

    container.appendChild(create('div', { className: 'lang-section-title' }, ['Languages']));

    const bar = create('div', { className: 'lang-bar' });
    for (const [lang, bytes] of topEntries) {
      const pct = (bytes / total) * 100;
      const segment = create('div', {
        className: 'lang-bar-segment',
        style: `width: ${pct}%; background: ${LANGUAGE_COLORS[lang] || '#6b6b78'}`
      });
      if (!prefersReducedMotion()) {
        segment.style.width = '0';
        bar.appendChild(segment);
        requestAnimationFrame(() => { segment.style.transition = 'width 600ms var(--ease-spring)'; segment.style.width = `${pct}%`; });
      } else {
        bar.appendChild(segment);
      }
    }
    if (otherBytes > 0) {
      const pct = (otherBytes / total) * 100;
      const segment = create('div', {
        className: 'lang-bar-segment',
        style: `width: ${pct}%; background: #6b6b78`
      });
      if (!prefersReducedMotion()) { segment.style.width = '0'; bar.appendChild(segment); requestAnimationFrame(() => { segment.style.transition = 'width 600ms var(--ease-spring)'; segment.style.width = `${pct}%`; }); }
      else bar.appendChild(segment);
    }
    container.appendChild(bar);

    const chips = create('div', { className: 'lang-chips' });
    for (const [lang, bytes] of topEntries) {
      const pct = ((bytes / total) * 100).toFixed(1);
      chips.appendChild(create('span', { className: 'lang-chip' }, [
        create('span', { className: 'lang-chip-dot', style: `background: ${LANGUAGE_COLORS[lang] || '#6b6b78'}` }),
        ` ${lang} `,
        create('span', { className: 'lang-chip-pct' }, [`${pct}%`])
      ]));
    }
    if (otherBytes > 0) {
      const remainingPct = ((otherBytes / total) * 100).toFixed(1);
      chips.appendChild(create('span', { className: 'lang-chip' }, [
        create('span', { className: 'lang-chip-dot', style: 'background: #6b6b78' }),
        ` Other `,
        create('span', { className: 'lang-chip-pct' }, [`${remainingPct}%`])
      ]));
    }
    container.appendChild(chips);
  }

  getChartData() {
    return { radar: this._radarData };
  }
}