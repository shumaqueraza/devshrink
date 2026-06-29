export class Charts {
  constructor() {
    this.radarChart = null;
  }

  create(data) {
    this.destroy();
    this._radar(data.radar);
  }

  _radar(data) {
    const ctx = document.getElementById('radarChart');
    if (!ctx) return;

    this.radarChart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Maintainability', 'Architecture', 'Documentation', 'Testing', 'Readability', 'Modularity'],
        datasets: [{
          label: 'Score',
          data: [
            data.maintainability || 0,
            data.architecture || 0,
            data.documentation || 0,
            data.testing || 0,
            data.readability || 0,
            data.modularity || 0
          ],
          backgroundColor: 'rgba(88, 166, 255, 0.12)',
          borderColor: '#58a6ff',
          borderWidth: 2,
          pointBackgroundColor: '#58a6ff',
          pointBorderColor: '#1e1e26',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e1e26',
            titleColor: '#ececf0',
            bodyColor: '#b0b0bc',
            borderColor: '#2a2a34',
            borderWidth: 1,
            cornerRadius: 6,
            padding: 10,
            callbacks: {
              label: ctx => `${ctx.parsed.r}%`
            }
          }
        },
        scales: {
          r: {
            min: 0,
            max: 100,
            ticks: {
              stepSize: 25,
              color: '#6b6b78',
              backdropColor: 'transparent',
              font: { family: 'JetBrains Mono', size: 10 }
            },
            grid: { color: '#2a2a34' },
            angleLines: { color: '#2a2a34' },
            pointLabels: {
              color: '#b0b0bc',
              font: { family: 'Inter', size: 11 }
            }
          }
        }
      }
    });
  }

  destroy() {
    if (this.radarChart) { this.radarChart.destroy(); this.radarChart = null; }
  }
}
