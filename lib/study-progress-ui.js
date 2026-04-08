/**
 * StudyProgressUI — 進捗可視化 UIコンポーネント
 * 
 * 学習進捗をパネル/短冊、サマリーバー、統計として表示する
 * 汎用コンポーネント群。StudyDB と組み合わせて使用。
 */

// ─── レベル定義 ────────────────────────────────────

const LEVEL_CONFIG = {
    0: { label: '未学習',   color: '#6b7280', bgColor: '#374151', icon: '○' },
    1: { label: '練習中',   color: '#ef4444', bgColor: '#7f1d1d', icon: '△' },
    2: { label: 'やや定着', color: '#f59e0b', bgColor: '#78350f', icon: '▽' },
    3: { label: 'ほぼ定着', color: '#eab308', bgColor: '#713f12', icon: '◇' },
    4: { label: '習得済み', color: '#22c55e', bgColor: '#14532d', icon: '◆' }
};

const MAX_LEVEL = 4;

// ─── ProgressPanel（短冊ビュー） ────────────────────

class ProgressPanel {
    constructor(container) {
        this.container = container;
        this.onCardClick = null;
        this.currentFilter = -1; // -1 = 全表示
        this.layoutMode = 'grid'; // デフォルトをタイルにする（'list' でリスト表示）
    }

    render(cardsWithProgress, options = {}) {
        this.onCardClick = options.onCardClick || null;
        this.cards = cardsWithProgress;
        this._buildUI();
    }

    _buildUI() {
        this.container.innerHTML = '';
        this.container.classList.add('sp-panel-container');

        // フィルターバー
        const filterBar = document.createElement('div');
        filterBar.className = 'sp-filter-bar';

        const allBtn = document.createElement('button');
        allBtn.className = 'sp-filter-btn' + (this.currentFilter === -1 ? ' active' : '');
        allBtn.textContent = `すべて (${this.cards.length})`;
        allBtn.onclick = () => { this.currentFilter = -1; this._buildUI(); };
        filterBar.appendChild(allBtn);

        for (let level = 0; level <= MAX_LEVEL; level++) {
            const config = LEVEL_CONFIG[level];
            const count = this.cards.filter(c => (c.progress?.level || 0) === level).length;
            const btn = document.createElement('button');
            btn.className = 'sp-filter-btn' + (this.currentFilter === level ? ' active' : '');
            btn.style.setProperty('--filter-color', config.color);
            btn.innerHTML = `<span class="sp-level-dot" style="background:${config.color}"></span>${config.label} (${count})`;
            btn.onclick = () => { this.currentFilter = level; this._buildUI(); };
            filterBar.appendChild(btn);
        }

        const layoutToggle = document.createElement('button');
        layoutToggle.className = 'sp-filter-btn sp-layout-toggle';
        layoutToggle.innerHTML = this.layoutMode === 'list' ? '⊞ タイル表示' : '⊟ リスト表示';
        layoutToggle.onclick = () => {
            this.layoutMode = this.layoutMode === 'list' ? 'grid' : 'list';
            this._buildUI();
        };
        filterBar.appendChild(layoutToggle);

        this.container.appendChild(filterBar);

        // カード短冊一覧
        const grid = document.createElement('div');
        grid.className = 'sp-card-grid' + (this.layoutMode === 'grid' ? ' sp-grid-mode' : '');

        const filteredCards = this.currentFilter === -1
            ? this.cards
            : this.cards.filter(c => (c.progress?.level || 0) === this.currentFilter);

        if (filteredCards.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'sp-empty-state';
            empty.textContent = 'カードがありません';
            grid.appendChild(empty);
        } else {
            filteredCards.forEach((card, index) => {
                const strip = this._createStrip(card, index);
                grid.appendChild(strip);
            });
        }

        this.container.appendChild(grid);
    }

    _createStrip(card, index) {
        const level = card.progress?.level || 0;
        const config = LEVEL_CONFIG[level];

        const strip = document.createElement('div');
        strip.className = 'sp-card-strip';
        strip.style.setProperty('--strip-color', config.color);
        strip.style.setProperty('--strip-bg', config.bgColor);
        strip.style.animationDelay = `${index * 30}ms`;

        // レベルインジケーター
        const indicator = document.createElement('div');
        indicator.className = 'sp-level-indicator';
        indicator.style.background = config.color;
        indicator.title = config.label;

        // コンテンツ
        const content = document.createElement('div');
        content.className = 'sp-strip-content';

        // メインテキスト（fields の最初の値を表示）
        const mainText = document.createElement('div');
        mainText.className = 'sp-strip-main';
        const fieldValues = Object.values(card.fields || {});
        mainText.textContent = fieldValues[0] || '(空)';

        // サブテキスト（2番目の値）
        const subText = document.createElement('div');
        subText.className = 'sp-strip-sub';
        subText.textContent = fieldValues[1] || '';

        content.appendChild(mainText);
        if (fieldValues[1]) content.appendChild(subText);

        // メタ情報
        const meta = document.createElement('div');
        meta.className = 'sp-strip-meta';

        const levelBadge = document.createElement('span');
        levelBadge.className = 'sp-level-badge';
        levelBadge.style.background = config.color;
        levelBadge.textContent = this.layoutMode === 'grid' ? `Lvl ${level}` : config.label;

        const practiceCount = document.createElement('span');
        practiceCount.className = 'sp-practice-count';
        const count = card.progress?.practiceCount || 0;
        practiceCount.textContent = count > 0 ? `${count}回練習` : '';

        meta.appendChild(levelBadge);
        meta.appendChild(practiceCount);

        strip.appendChild(indicator);
        strip.appendChild(content);
        strip.appendChild(meta);

        if (this.onCardClick) {
            strip.classList.add('clickable');
            strip.onclick = () => this.onCardClick(card);
        }

        return strip;
    }
}

// ─── ProgressSummaryBar（進捗サマリーバー） ─────────

class ProgressSummaryBar {
    constructor(container) {
        this.container = container;
    }

    render(cardsWithProgress) {
        this.container.innerHTML = '';
        this.container.classList.add('sp-summary-container');

        const total = cardsWithProgress.length;
        if (total === 0) {
            this.container.innerHTML = '<div class="sp-summary-empty">カードが登録されていません</div>';
            return;
        }

        // レベル別集計
        const counts = {};
        for (let i = 0; i <= MAX_LEVEL; i++) counts[i] = 0;
        cardsWithProgress.forEach(c => {
            const level = Math.min(c.progress?.level || 0, MAX_LEVEL);
            counts[level]++;
        });

        // 習得率
        const masteredCount = counts[MAX_LEVEL];
        const masteredPct = Math.round((masteredCount / total) * 100);

        // ヘッダー
        const header = document.createElement('div');
        header.className = 'sp-summary-header';
        header.innerHTML = `
            <div class="sp-summary-title">学習進捗</div>
            <div class="sp-summary-ratio">
                <span class="sp-summary-pct">${masteredPct}%</span>
                <span class="sp-summary-detail">${masteredCount} / ${total} 習得</span>
            </div>
        `;
        this.container.appendChild(header);

        // スタックドバー
        const bar = document.createElement('div');
        bar.className = 'sp-stacked-bar';

        for (let level = MAX_LEVEL; level >= 0; level--) {
            const pct = (counts[level] / total) * 100;
            if (pct > 0) {
                const segment = document.createElement('div');
                segment.className = 'sp-bar-segment';
                segment.style.width = `${pct}%`;
                segment.style.background = LEVEL_CONFIG[level].color;
                segment.title = `${LEVEL_CONFIG[level].label}: ${counts[level]}件 (${Math.round(pct)}%)`;
                bar.appendChild(segment);
            }
        }

        this.container.appendChild(bar);

        // レジェンド
        const legend = document.createElement('div');
        legend.className = 'sp-legend';

        for (let level = 0; level <= MAX_LEVEL; level++) {
            const item = document.createElement('div');
            item.className = 'sp-legend-item';
            item.innerHTML = `
                <span class="sp-legend-dot" style="background:${LEVEL_CONFIG[level].color}"></span>
                <span class="sp-legend-label">${LEVEL_CONFIG[level].label}</span>
                <span class="sp-legend-count">${counts[level]}</span>
            `;
            legend.appendChild(item);
        }

        this.container.appendChild(legend);
    }
}

// ─── ProgressStats（統計表示） ──────────────────────

class ProgressStats {
    constructor(container) {
        this.container = container;
    }

    render(cardsWithProgress) {
        this.container.innerHTML = '';
        this.container.classList.add('sp-stats-container');

        const total = cardsWithProgress.length;
        const studied = cardsWithProgress.filter(c => (c.progress?.practiceCount || 0) > 0).length;
        const mastered = cardsWithProgress.filter(c => (c.progress?.level || 0) >= MAX_LEVEL).length;
        const totalPractices = cardsWithProgress.reduce((sum, c) => sum + (c.progress?.practiceCount || 0), 0);

        const avgScore = cardsWithProgress.length > 0
            ? Math.round(cardsWithProgress.reduce((sum, c) => sum + (c.progress?.lastScore || 0), 0) / total)
            : 0;

        const stats = [
            { label: '総カード数', value: total, icon: '📚' },
            { label: '学習済み', value: studied, icon: '✏️' },
            { label: '習得済み', value: mastered, icon: '🏆' },
            { label: '総練習回数', value: totalPractices, icon: '🔄' },
            { label: '平均スコア', value: `${avgScore}%`, icon: '📊' }
        ];

        stats.forEach(stat => {
            const card = document.createElement('div');
            card.className = 'sp-stat-card';
            card.innerHTML = `
                <div class="sp-stat-icon">${stat.icon}</div>
                <div class="sp-stat-value">${stat.value}</div>
                <div class="sp-stat-label">${stat.label}</div>
            `;
            this.container.appendChild(card);
        });
    }
}

// ─── ProgressGraph（時間変化グラフ） ──────────────────

class ProgressGraph {
    constructor(canvasId) {
        this.ctx = document.getElementById(canvasId).getContext('2d');
        this.chart = null;
    }

    render(snapshots, isStacked = true) {
        if (!snapshots || snapshots.length === 0) {
            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
            return;
        }

        // ラベル（日時）
        const labels = snapshots.map(s => {
            const d = new Date(s.timestamp);
            return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        });

        // データセット
        const datasets = [];
        for (let level = 0; level <= MAX_LEVEL; level++) {
            datasets.push({
                label: LEVEL_CONFIG[level].label,
                data: snapshots.map(s => s.counts[level]),
                backgroundColor: LEVEL_CONFIG[level].color,
                borderColor: LEVEL_CONFIG[level].color,
                fill: isStacked,
                tension: 0.1, // 曲線を少しだけ滑らかに
                borderWidth: isStacked ? 1 : 2
            });
        }

        if (this.chart) {
            this.chart.destroy();
        }

        // デフォルトの文字色を調整
        Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';
        Chart.defaults.font.family = 'Inter, sans-serif';

        this.chart = new Chart(this.ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, font: { size: 10 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)'
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    },
                    y: {
                        stacked: isStacked,
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                        beginAtZero: true
                    }
                }
            }
        });
    }
}

// ─── ユーティリティ ────────────────────────────────

function getLevelConfig(level) {
    return LEVEL_CONFIG[Math.min(Math.max(level || 0, 0), MAX_LEVEL)];
}

function suggestLevel(score) {
    if (score >= 90) return 4;
    if (score >= 70) return 3;
    if (score >= 50) return 2;
    if (score > 0) return 1;
    return 0;
}

// グローバル公開
if (typeof window !== 'undefined') {
    window.ProgressPanel = ProgressPanel;
    window.ProgressSummaryBar = ProgressSummaryBar;
    window.ProgressStats = ProgressStats;
    window.ProgressGraph = ProgressGraph;
    window.LEVEL_CONFIG = LEVEL_CONFIG;
    window.MAX_LEVEL = MAX_LEVEL;
    window.getLevelConfig = getLevelConfig;
    window.suggestLevel = suggestLevel;
}
