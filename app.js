/**
 * 発音特訓ツール Pro — メインアプリケーション
 * 
 * 3つのビュー(デッキ管理・練習・進捗一覧)を統合し、
 * StudyDB + StudyProgressUI ライブラリを活用。
 */

document.addEventListener('DOMContentLoaded', async () => {

    // ─── DB初期化 ───────────────────────────────────

    const db = new StudyDB('PronunciationTrainerDB', 1);
    await db.init();

    // ─── Web Speech API チェック ─────────────────────

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const synth = window.speechSynthesis;
    let recognition = null;
    let isRecording = false;

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
    }

    // ─── 状態管理 ───────────────────────────────────

    let currentDeckId = null;       // デッキ管理で選択中のID
    let allPracticeCards = [];      // 全カード（フィルタ前）
    let practiceCards = [];         // 練習用カード一覧（フィルタ後）
    let practiceIndex = 0;          // 現在の練習インデックス
    let practiceMode = 'sequential';
    let selectedLevel = null;       // レベル更新用
    let editingDeckId = null;       // 編集中のデッキID (null=新規)
    let editingCardId = null;       // 編集中のカードID (null=新規)
    let lastSpokenText = '';        // 最後の音声認識結果を一時保持
    let showMisrecognitions = localStorage.getItem('showMisrecognitions') !== 'false'; // 誤認識注意喚起表示
    let showDispText = localStorage.getItem('showDispText') !== 'false';   // テキスト表示
    let showDispTrans = localStorage.getItem('showDispTrans') !== 'false'; // 訳表示
    let showDispNotes = localStorage.getItem('showDispNotes') !== 'false'; // 補足表示

    // ─── DOM要素 ────────────────────────────────────

    const $ = (id) => document.getElementById(id);

    // タブ・ビュー
    const navTabs = document.querySelectorAll('.nav-tab');
    const views = document.querySelectorAll('.view');

    // デッキ管理
    const deckList = $('deck-list');
    const deckEmpty = $('deck-empty');
    const deckDetailPanel = $('deck-detail-panel');
    const deckDetailName = $('deck-detail-name');
    const deckDetailStats = $('deck-detail-stats');
    const deckCardsList = $('deck-cards-list');
    const cardCount = $('card-count');

    // 練習ビュー
    const practiceDeckSelect = $('practice-deck-select');
    const practiceEmpty = $('practice-empty');
    const practiceMain = $('practice-main');
    const practiceCounter = $('practice-counter');
    const sentenceText = $('sentence-text');
    const sentenceTranslation = $('sentence-translation');
    const sentenceLevelBadge = $('sentence-level-badge');
    const sentenceNotes = $('sentence-notes');
    const resultTextEl = $('result-text');
    const diffContainer = $('diff-container');
    const diffResult = $('diff-result');
    const scoreValue = $('score-value');
    const levelUpdate = $('level-update');
    const langSelect = $('lang-select');

    // 進捗ビュー
    const progressDeckSelect = $('progress-deck-select');
    const progressSummary = $('progress-summary');
    const progressStats = $('progress-stats');
    const progressPanel = $('progress-panel');
    const progressEmpty = $('progress-empty');

    // ステータスバー
    const statusBar = $('status-bar');

    // ─── タブ切り替え ───────────────────────────────

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const viewId = tab.dataset.view;
            navTabs.forEach(t => t.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            tab.classList.add('active');
            $(viewId).classList.add('active');

            // ビュー切り替え時にデータ更新
            if (viewId === 'practice-view') refreshPracticeDeckSelect();
            if (viewId === 'progress-view') refreshProgressDeckSelect();
        });
    });

    // ─── ステータス更新 ─────────────────────────────

    function updateStatus(message, type = 'ready') {
        statusBar.textContent = `ステータス: ${message}`;
        statusBar.className = 'status-bar';
        statusBar.classList.add(`status-${type}`);
    }

    // ═══════════════════════════════════════════════
    //  デッキ管理ビュー
    // ═══════════════════════════════════════════════

    async function refreshDeckList() {
        const decks = await db.getDecks();
        deckList.innerHTML = '';

        if (decks.length === 0) {
            deckEmpty.classList.remove('hidden');
            deckDetailPanel.classList.add('hidden');
            return;
        }

        deckEmpty.classList.add('hidden');

        for (const deck of decks) {
            const count = await db.getCardCount(deck.id);
            const item = document.createElement('div');
            item.className = 'deck-item' + (deck.id === currentDeckId ? ' selected' : '');
            item.innerHTML = `
                <div class="deck-icon">📖</div>
                <div class="deck-info">
                    <div class="deck-name">${escapeHtml(deck.name)}</div>
                    <div class="deck-meta">${count}件の例文 ・ ${formatDate(deck.createdAt)}</div>
                </div>
            `;
            item.onclick = () => selectDeck(deck.id);
            deckList.appendChild(item);
        }
    }

    async function selectDeck(id) {
        currentDeckId = id;
        const deck = await db.getDeck(id);
        if (!deck) return;

        // UI更新
        document.querySelectorAll('.deck-item').forEach(el => el.classList.remove('selected'));
        deckDetailPanel.classList.remove('hidden');
        deckDetailName.textContent = deck.name;

        // デッキ統計
        const cardsWithProgress = await db.getCardsWithProgress(id);
        const miniSummary = new ProgressSummaryBar(deckDetailStats);
        miniSummary.render(cardsWithProgress);

        // カード一覧
        cardCount.textContent = cardsWithProgress.length;
        deckCardsList.innerHTML = '';

        if (cardsWithProgress.length === 0) {
            deckCardsList.innerHTML = '<div class="text-center text-muted text-sm" style="padding:20px">例文がまだありません。TSVインポートまたは手動追加で例文を登録しましょう。</div>';
        } else {
            cardsWithProgress.forEach(card => {
                const config = getLevelConfig(card.progress?.level || 0);
                const el = document.createElement('div');
                el.className = 'sp-card-strip';
                el.style.setProperty('--strip-color', config.color);
                const notesText = card.fields.notes ? `<div class="sp-strip-notes">${escapeHtml(card.fields.notes)}</div>` : '';
                el.innerHTML = `
                    <div class="sp-level-indicator" style="background:${config.color}"></div>
                    <div class="sp-strip-content">
                        <div class="sp-strip-main">${escapeHtml(card.fields.text || '')}</div>
                        <div class="sp-strip-sub">${escapeHtml(card.fields.translation || '')}</div>
                        ${notesText}
                    </div>
                    <div class="sp-strip-meta">
                        <span class="sp-level-badge" style="background:${config.color}">${config.label}</span>
                        <div class="deck-actions">
                            <button class="btn btn-ghost btn-sm" onclick="editCard(${card.id})">✏️</button>
                            <button class="btn btn-ghost btn-sm" onclick="deleteCard(${card.id})">🗑</button>
                        </div>
                    </div>
                `;
                deckCardsList.appendChild(el);
            });
        }

        refreshDeckList(); // ハイライト更新
    }

    // デッキ作成/編集モーダル
    $('btn-create-deck').onclick = () => {
        editingDeckId = null;
        $('modal-deck-title').textContent = '新しいデッキを作成';
        $('input-deck-name').value = '';
        $('input-deck-desc').value = '';
        $('modal-deck').classList.add('active');
    };

    $('btn-edit-deck').onclick = async () => {
        if (!currentDeckId) return;
        const deck = await db.getDeck(currentDeckId);
        editingDeckId = currentDeckId;
        $('modal-deck-title').textContent = 'デッキを編集';
        $('input-deck-name').value = deck.name;
        $('input-deck-desc').value = deck.description || '';
        $('modal-deck').classList.add('active');
    };

    $('modal-deck-save').onclick = async () => {
        const name = $('input-deck-name').value.trim();
        if (!name) { updateStatus('デッキ名を入力してください', 'error'); return; }

        if (editingDeckId) {
            await db.updateDeck(editingDeckId, { name, description: $('input-deck-desc').value.trim() });
            updateStatus('デッキを更新しました', 'ready');
        } else {
            const id = await db.createDeck(name, $('input-deck-desc').value.trim());
            currentDeckId = id;
            updateStatus(`デッキ「${name}」を作成しました`, 'ready');
        }

        $('modal-deck').classList.remove('active');
        await refreshDeckList();
        if (currentDeckId) await selectDeck(currentDeckId);
    };

    // デッキ削除
    $('btn-delete-deck').onclick = async () => {
        if (!currentDeckId) return;
        const deck = await db.getDeck(currentDeckId);
        if (!confirm(`デッキ「${deck.name}」とすべての例文を削除しますか？`)) return;

        await db.deleteDeck(currentDeckId);
        currentDeckId = null;
        deckDetailPanel.classList.add('hidden');
        await refreshDeckList();
        updateStatus('デッキを削除しました', 'ready');
    };

    // モーダル閉じる
    ['modal-deck-close', 'modal-deck-cancel'].forEach(id => {
        $(id).onclick = () => $('modal-deck').classList.remove('active');
    });
    ['modal-tsv-close', 'modal-tsv-cancel'].forEach(id => {
        $(id).onclick = () => $('modal-tsv').classList.remove('active');
    });
    ['modal-card-close', 'modal-card-cancel'].forEach(id => {
        $(id).onclick = () => $('modal-card').classList.remove('active');
    });
    ['modal-json-close', 'modal-json-cancel'].forEach(id => {
        $(id).onclick = () => $('modal-json-import').classList.remove('active');
    });

    // TSVインポート
    $('btn-import-tsv').onclick = () => {
        $('input-tsv').value = '';
        $('modal-tsv').classList.add('active');
    };

    $('modal-tsv-import').onclick = async () => {
        if (!currentDeckId) return;
        const tsvText = $('input-tsv').value;
        if (!tsvText.trim()) { updateStatus('テキストを入力してください', 'error'); return; }

        const count = await db.importFromTSV(currentDeckId, tsvText, ['text', 'translation', 'notes']);
        $('modal-tsv').classList.remove('active');
        updateStatus(`${count}件の例文をインポートしました`, 'ready');
        await selectDeck(currentDeckId);
    };

    // 例文追加/編集
    $('btn-add-card').onclick = () => {
        editingCardId = null;
        $('modal-card-title').textContent = '例文を追加';
        $('input-card-text').value = '';
        $('input-card-translation').value = '';
        $('input-card-notes').value = '';
        $('modal-card').classList.add('active');
    };

    window.editCard = async (cardId) => {
        const cards = await db.getCards(currentDeckId);
        const card = cards.find(c => c.id === cardId);
        if (!card) return;

        editingCardId = cardId;
        $('modal-card-title').textContent = '例文を編集';
        $('input-card-text').value = card.fields.text || '';
        $('input-card-translation').value = card.fields.translation || '';
        $('input-card-notes').value = card.fields.notes || '';
        $('modal-card').classList.add('active');
    };

    window.deleteCard = async (cardId) => {
        if (!confirm('この例文を削除しますか？')) return;
        await db.deleteCard(cardId);
        updateStatus('例文を削除しました', 'ready');
        if (currentDeckId) await selectDeck(currentDeckId);
    };

    $('modal-card-save').onclick = async () => {
        const text = $('input-card-text').value.trim();
        if (!text) { updateStatus('テキストを入力してください', 'error'); return; }

        const fields = {
            text,
            translation: $('input-card-translation').value.trim(),
            notes: $('input-card-notes').value.trim()
        };

        if (editingCardId) {
            await db.updateCard({ id: editingCardId, fields });
            updateStatus('例文を更新しました', 'ready');
        } else {
            await db.addCards(currentDeckId, [{ fields }]);
            updateStatus('例文を追加しました', 'ready');
        }

        $('modal-card').classList.remove('active');
        if (currentDeckId) await selectDeck(currentDeckId);
    };

    // JSONエクスポート
    $('btn-export-deck').onclick = async () => {
        if (!currentDeckId) return;
        const data = await db.exportDeck(currentDeckId);
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `deck_${data.deck.name.replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        updateStatus('デッキをエクスポートしました', 'ready');
    };

    // JSONインポート
    $('btn-import-json').onclick = () => {
        $('input-json-file').value = '';
        $('modal-json-import').classList.add('active');
    };

    $('modal-json-do-import').onclick = async () => {
        const file = $('input-json-file').files[0];
        if (!file) { updateStatus('ファイルを選択してください', 'error'); return; }

        const text = await file.text();
        try {
            const deckId = await db.importDeck(text);
            currentDeckId = deckId;
            $('modal-json-import').classList.remove('active');
            await refreshDeckList();
            await selectDeck(deckId);
            updateStatus('デッキをインポートしました', 'ready');
        } catch (e) {
            updateStatus('インポートエラー: ' + e.message, 'error');
        }
    };

    // ═══════════════════════════════════════════════
    //  練習ビュー
    // ═══════════════════════════════════════════════

    async function refreshPracticeDeckSelect() {
        const decks = await db.getDecks();
        practiceDeckSelect.innerHTML = '<option value="">デッキを選択…</option>';
        decks.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = d.name;
            practiceDeckSelect.appendChild(opt);
        });
    }

    practiceDeckSelect.onchange = async () => {
        const deckId = parseInt(practiceDeckSelect.value);
        if (!deckId) {
            practiceEmpty.classList.remove('hidden');
            practiceMain.classList.add('hidden');
            return;
        }

        allPracticeCards = await db.getCardsWithProgress(deckId);
        if (allPracticeCards.length === 0) {
            practiceEmpty.classList.remove('hidden');
            practiceMain.classList.add('hidden');
            updateStatus('選択したデッキに例文がありません', 'error');
            return;
        }

        applyPracticeMode();
        practiceIndex = 0;
        practiceEmpty.classList.add('hidden');
        practiceMain.classList.remove('hidden');
        showCurrentCard();
    };

    // 練習モード切り替え
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            practiceMode = btn.dataset.mode;
            applyPracticeMode();
            practiceIndex = 0;
            if (practiceCards.length > 0) showCurrentCard();
        });
    });

    // レベルフィルタ変更時
    document.querySelectorAll('.level-filter-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            applyPracticeMode();
            practiceIndex = 0;
            if (allPracticeCards.length > 0) showCurrentCard();
        });
    });

    function getActiveLevelFilter() {
        const checkboxes = document.querySelectorAll('.level-filter-cb');
        if (checkboxes.length === 0) return null; // チェックボックス未生成時は全表示
        const levels = new Set();
        checkboxes.forEach(cb => { if (cb.checked) levels.add(parseInt(cb.value)); });
        return levels;
    }

    function applyPracticeMode() {
        // レベルフィルタ適用
        const levelFilter = getActiveLevelFilter();
        let filtered = [...allPracticeCards];
        if (levelFilter && levelFilter.size > 0) {
            filtered = filtered.filter(c => levelFilter.has(c.progress?.level || 0));
        } else if (levelFilter && levelFilter.size === 0) {
            filtered = []; // 全チェックOFFなら0件
        }

        // モード適用
        if (practiceMode === 'random') {
            practiceCards = shuffleArray(filtered);
        } else if (practiceMode === 'weak') {
            filtered.sort((a, b) => (a.progress?.level || 0) - (b.progress?.level || 0));
            practiceCards = filtered;
        } else {
            filtered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
            practiceCards = filtered;
        }
    }

    function showCurrentCard() {
        if (practiceCards.length === 0) {
            practiceCounter.textContent = '0 / 0';
            sentenceText.textContent = '（対象なし）';
            sentenceTranslation.textContent = 'レベルフィルタを変更してください';
            sentenceNotes.classList.add('hidden');
            sentenceLevelBadge.textContent = '—';
            sentenceLevelBadge.style.background = '#555';
            diffContainer.classList.add('hidden');
            const misrecWarning = $('misrecognition-warning');
            if (misrecWarning) misrecWarning.classList.add('hidden');
            return;
        }

        const card = practiceCards[practiceIndex];
        const level = card.progress?.level || 0;
        const config = getLevelConfig(level);

        practiceCounter.textContent = `${practiceIndex + 1} / ${practiceCards.length}`;
        
        // テキスト表示
        sentenceText.textContent = card.fields.text || '(テキストなし)';
        if (showDispText) {
            sentenceText.classList.remove('hidden');
        } else {
            sentenceText.classList.add('hidden');
        }

        // 訳表示
        sentenceTranslation.textContent = card.fields.translation || '';
        if (showDispTrans && card.fields.translation) {
            sentenceTranslation.classList.remove('hidden');
        } else {
            sentenceTranslation.classList.add('hidden');
        }

        // 補足情報(notes)の表示
        const notesContent = card.fields.notes || '';
        if (showDispNotes && notesContent) {
            sentenceNotes.textContent = notesContent;
            sentenceNotes.classList.remove('hidden');
        } else {
            sentenceNotes.textContent = '';
            sentenceNotes.classList.add('hidden');
        }

        sentenceLevelBadge.textContent = config.label;
        sentenceLevelBadge.style.background = config.color;

        // 結果エリアリセット
        resultTextEl.innerHTML = '';
        diffContainer.classList.add('hidden');
        selectedLevel = null;
        lastSpokenText = '';  // 認識結果もリセット

        // 誤認識の注意喚起表示
        const misrecWarning = $('misrecognition-warning');
        if (misrecWarning) {
            if (showMisrecognitions && card.progress?.misrecognitions?.length > 0) {
                const alertContainer = $('misrecognition-alert');
                alertContainer.innerHTML = '';
                
                card.progress.misrecognitions.forEach(m => {
                    const span = document.createElement('span');
                    span.className = 'misrec-item';
                    
                    const textSpan = document.createElement('span');
                    textSpan.textContent = `${m.spokenText}(${m.count}回)`;
                    span.appendChild(textSpan);
                    
                    const delBtn = document.createElement('span');
                    delBtn.className = 'misrec-delete';
                    delBtn.textContent = '×';
                    delBtn.onclick = async () => {
                        await db.removeMisrecognition(card.id, m.spokenText);
                        card.progress.misrecognitions = card.progress.misrecognitions.filter(x => x.spokenText !== m.spokenText);
                        showCurrentCard();
                    };
                    span.appendChild(delBtn);
                    
                    alertContainer.appendChild(span);
                });
                misrecWarning.classList.remove('hidden');
            } else {
                misrecWarning.classList.add('hidden');
            }
        }

        updateStatus('待機中', 'ready');
    }

    // ナビゲーション
    $('btn-prev').onclick = () => {
        if (practiceCards.length === 0) return;
        practiceIndex = (practiceIndex - 1 + practiceCards.length) % practiceCards.length;
        showCurrentCard();
    };

    $('btn-next').onclick = () => {
        if (practiceCards.length === 0) return;
        practiceIndex = (practiceIndex + 1) % practiceCards.length;
        showCurrentCard();
    };

    // ─── 音声合成 (TTS) ─────────────────────────────

    $('btn-play').onclick = () => {
        const text = sentenceText.textContent;
        if (!text || text === '(テキストなし)') return;

        if (!synth) {
            updateStatus('音声合成に対応していないブラウザです', 'error');
            return;
        }

        if (synth.speaking) synth.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = langSelect.value;

        utterance.onstart = () => {
            updateStatus('お手本を再生中...', 'playing');
            $('btn-play').disabled = true;
        };
        utterance.onend = () => {
            updateStatus('待機中', 'ready');
            $('btn-play').disabled = false;
        };
        utterance.onerror = () => {
            updateStatus('音声再生エラー', 'error');
            $('btn-play').disabled = false;
        };

        synth.speak(utterance);
    };

    // ─── 音声認識 (STT) ─────────────────────────────

    $('btn-record').onclick = () => {
        if (!recognition) {
            updateStatus('音声認識に対応していないブラウザです', 'error');
            return;
        }

        if (isRecording) {
            recognition.stop();
            return;
        }

        recognition.lang = langSelect.value;
        resultTextEl.innerHTML = '';

        try {
            recognition.start();
        } catch (e) {
            updateStatus('音声認識の開始に失敗しました', 'error');
        }
    };

    if (recognition) {
        recognition.onstart = () => {
            isRecording = true;
            updateStatus('録音中... マイクに向かって発声してください', 'recording');
            $('btn-record').classList.add('recording');
            $('btn-record').innerHTML = '⏹ 停止';
            $('btn-play').disabled = true;
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            resultTextEl.innerHTML =
                `<strong>${escapeHtml(finalTranscript)}</strong>` +
                `<span style="color:var(--color-text-muted)">${escapeHtml(interimTranscript)}</span>`;

            // 最終結果が出たら突き合わせ
            if (finalTranscript) {
                setTimeout(() => showDiffResult(finalTranscript), 300);
            }
        };

        recognition.onend = () => {
            isRecording = false;
            if (!statusBar.classList.contains('status-error')) {
                updateStatus('待機中', 'ready');
            }
            $('btn-record').classList.remove('recording');
            $('btn-record').innerHTML = '🎤 マイク入力';
            $('btn-play').disabled = false;
        };

        recognition.onerror = (event) => {
            isRecording = false;
            $('btn-record').classList.remove('recording');
            $('btn-record').innerHTML = '🎤 マイク入力';
            $('btn-play').disabled = false;

            const errorMessages = {
                'not-allowed': 'マイクの使用が許可されていません',
                'no-speech': '音声が検出されませんでした',
                'network': 'ネットワーク接続に問題があります',
                'audio-capture': 'マイクが見つかりません'
            };
            updateStatus(errorMessages[event.error] || '音声認識エラー', 'error');
        };
    }

    // ─── 突き合わせ ─────────────────────────────────

    function showDiffResult(spokenText) {
        const card = practiceCards[practiceIndex];
        if (!card) return;

        const originalText = card.fields.text || '';
        const { html, score } = computeDiff(originalText, spokenText);

        diffResult.innerHTML = html;
        scoreValue.textContent = `${score}%`;
        diffContainer.classList.remove('hidden');

        // レベル提案
        const suggested = suggestLevel(score);
        buildLevelButtons(card.progress?.level || 0, suggested);

        updateStatus(`正確度: ${score}%`, 'ready');

        // 確定ボタン押下時に使うため一時保存
        lastSpokenText = spokenText;
    }

    function computeDiff(original, spoken) {
        const normalize = (text) => text.toLowerCase().replace(/[.,!?;:'"()\[\]{}。、！？「」『』（）]/g, '').trim();
        const origWords = normalize(original).split(/\s+/).filter(Boolean);
        const spokenWords = normalize(spoken).split(/\s+/).filter(Boolean);

        let matchCount = 0;
        const resultParts = [];

        // 原文の各単語を確認
        origWords.forEach((word, i) => {
            const spokenWord = spokenWords[i];
            if (!spokenWord) {
                resultParts.push(`<span class="diff-word diff-miss">${escapeHtml(word)}</span>`);
            } else if (spokenWord === word) {
                matchCount++;
                resultParts.push(`<span class="diff-word diff-match">${escapeHtml(word)}</span>`);
            } else if (spokenWord.includes(word) || word.includes(spokenWord) || levenshteinRatio(word, spokenWord) > 0.6) {
                matchCount += 0.5;
                resultParts.push(`<span class="diff-word diff-partial">${escapeHtml(word)} → ${escapeHtml(spokenWord)}</span>`);
            } else {
                resultParts.push(`<span class="diff-word diff-miss">${escapeHtml(word)}</span>`);
            }
        });

        // 発話に余分な単語がある場合
        if (spokenWords.length > origWords.length) {
            for (let i = origWords.length; i < spokenWords.length; i++) {
                resultParts.push(`<span class="diff-word diff-extra">+${escapeHtml(spokenWords[i])}</span>`);
            }
        }

        const score = origWords.length > 0 ? Math.round((matchCount / origWords.length) * 100) : 0;

        return { html: resultParts.join(' '), score };
    }

    function levenshteinRatio(a, b) {
        const matrix = [];
        for (let i = 0; i <= a.length; i++) matrix[i] = [i];
        for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                );
            }
        }

        const maxLen = Math.max(a.length, b.length);
        return maxLen === 0 ? 1 : 1 - matrix[a.length][b.length] / maxLen;
    }

    // ─── レベル更新ボタン ───────────────────────────

    function buildLevelButtons(currentLevel, suggestedLevel) {
        levelUpdate.innerHTML = '';
        selectedLevel = suggestedLevel;

        for (let lv = 0; lv <= MAX_LEVEL; lv++) {
            const config = LEVEL_CONFIG[lv];
            const btn = document.createElement('button');
            btn.className = 'level-btn';
            if (lv === suggestedLevel) btn.classList.add('suggested');
            btn.style.setProperty('--level-color', config.color);
            btn.style.setProperty('--level-bg', config.bgColor);
            btn.innerHTML = `
                <span class="level-number" style="color:${config.color}">${lv}</span>
                ${config.label}
                ${lv === suggestedLevel ? '<span style="font-size:0.65rem;opacity:0.7">（提案）</span>' : ''}
                ${lv === currentLevel ? '<span style="font-size:0.65rem;opacity:0.7">（現在）</span>' : ''}
            `;

            btn.onclick = () => {
                document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedLevel = lv;
            };

            levelUpdate.appendChild(btn);
        }
    }

    // レベル確定
    $('btn-confirm-level').onclick = async () => {
        if (practiceCards.length === 0) return;
        const card = practiceCards[practiceIndex];
        const level = selectedLevel !== null ? selectedLevel : 0;
        const scoreText = scoreValue.textContent.replace('%', '');
        const score = parseInt(scoreText) || 0;

        // 誤認識データを含めて進捗更新
        const progressUpdate = { level, score };
        if (score < 100 && lastSpokenText) {
            progressUpdate.spokenText = lastSpokenText;
            progressUpdate.originalText = card.fields.text || '';
        }
        await db.updateProgress(card.id, progressUpdate);
        lastSpokenText = '';  // リセット

        // スナップショットを更新（5分インターバル制御はDB層にお任せ）
        await db.updateDeckSnapshot(card.deckId);

        // ローカル状態も更新
        card.progress = {
            ...(card.progress || {}),
            level,
            lastScore: score,
            practiceCount: (card.progress?.practiceCount || 0) + 1,
            lastPracticedAt: Date.now()
        };

        updateStatus(`レベル ${level} を設定しました`, 'ready');

        // 次のカードへ
        if (practiceIndex < practiceCards.length - 1) {
            practiceIndex++;
            showCurrentCard();
        } else {
            updateStatus('🎉 デッキの全例文を練習しました！', 'ready');
            diffContainer.classList.add('hidden');
        }
    };

    // ═══════════════════════════════════════════════
    //  進捗一覧ビュー
    // ═══════════════════════════════════════════════

    async function refreshProgressDeckSelect() {
        const decks = await db.getDecks();
        progressDeckSelect.innerHTML = '<option value="">デッキを選択…</option>';
        decks.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.textContent = d.name;
            progressDeckSelect.appendChild(opt);
        });
    }

    progressDeckSelect.onchange = async () => {
        const deckId = parseInt(progressDeckSelect.value);
        if (!deckId) {
            progressSummary.innerHTML = '';
            progressStats.innerHTML = '';
            progressPanel.innerHTML = '';
            progressEmpty.classList.remove('hidden');
            return;
        }

        progressEmpty.classList.add('hidden');

        const cardsWithProgress = await db.getCardsWithProgress(deckId);
        const deck = await db.getDeck(deckId);

        // サマリーバー
        const summary = new ProgressSummaryBar(progressSummary);
        summary.render(cardsWithProgress);

        // 進捗グラフ
        const graphContainer = $('progress-graph-container');
        if (deck.snapshots && deck.snapshots.length > 0) {
            graphContainer.style.display = 'block';
            
            const renderGraph = () => {
                const wrapper = $('progress-graph-wrapper');
                // canvasの再生成でChart.jsのゴミを完全にクリア
                wrapper.innerHTML = '<canvas id="progress-chartCanvas"></canvas>';
                const graph = new ProgressGraph('progress-chartCanvas');
                const isStacked = $('toggle-stacked-chart').checked;
                graph.render(deck.snapshots, isStacked);
            };
            
            renderGraph();
            $('toggle-stacked-chart').onchange = renderGraph;
        } else {
            graphContainer.style.display = 'none';
        }

        // 統計
        const stats = new ProgressStats(progressStats);
        stats.render(cardsWithProgress);

        // パネルビュー
        const panel = new ProgressPanel(progressPanel);
        panel.render(cardsWithProgress, {
            onCardClick: (card) => {
                // 練習ビューに遷移してそのカードへ移動
                practiceDeckSelect.value = deckId;
                practiceDeckSelect.dispatchEvent(new Event('change'));

                setTimeout(() => {
                    const idx = practiceCards.findIndex(c => c.id === card.id);
                    if (idx !== -1) {
                        practiceIndex = idx;
                        showCurrentCard();
                    }
                    // タブ切り替え
                    $('tab-practice').click();
                }, 100);
            }
        });
    };

    // ═══════════════════════════════════════════════
    //  ユーティリティ
    // ═══════════════════════════════════════════════

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatDate(timestamp) {
        if (!timestamp) return '';
        const d = new Date(timestamp);
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }

    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // ─── キーボードショートカット ──────────────────────

    document.addEventListener('keydown', (e) => {
        // モーダルが開いている時は無効
        if (document.querySelector('.modal-overlay.active')) return;

        // テキスト入力中は無効
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        // 練習ビューがアクティブでない場合は無効
        const practiceView = $('practice-view');
        if (!practiceView || !practiceView.classList.contains('active')) return;

        // 練習カードがない場合は無効
        if (practiceCards.length === 0) return;

        switch (e.key) {
            case ' ':  // Space: マイク入力
                e.preventDefault();
                $('btn-record').click();
                break;

            case 'Enter':  // Enter: レベル確定して次へ
                e.preventDefault();
                if (!diffContainer.classList.contains('hidden')) {
                    $('btn-confirm-level').click();
                }
                break;

            case 'p':  // P: お手本再生
            case 'P':
                e.preventDefault();
                $('btn-play').click();
                break;

            case 'ArrowLeft':  // ←: 前へ
                e.preventDefault();
                $('btn-prev').click();
                break;

            case 'ArrowRight':  // →: 次へ
                e.preventDefault();
                $('btn-next').click();
                break;

            case '0': case '1': case '2': case '3': case '4':  // 数字: レベル選択
                if (!diffContainer.classList.contains('hidden')) {
                    const levelBtns = document.querySelectorAll('.level-btn');
                    const lvNum = parseInt(e.key);
                    if (levelBtns[lvNum]) {
                        levelBtns[lvNum].click();
                    }
                }
                break;
        }
    });

    // ─── 初期化 ─────────────────────────────────────

    await refreshDeckList();
    updateStatus('待機中', 'ready');

    // 誤認識トグルの初期状態設定
    const toggleMisrec = $('toggle-misrec');
    if (toggleMisrec) {
        toggleMisrec.checked = showMisrecognitions;
        toggleMisrec.onchange = (e) => {
            showMisrecognitions = e.target.checked;
            localStorage.setItem('showMisrecognitions', showMisrecognitions);
            if (practiceCards.length > 0) showCurrentCard();
        };
    }

    // 表示トグルの初期設定
    const setupDisplayToggle = (id, stateVar, storageKey) => {
        const toggle = $(id);
        if (toggle) {
            toggle.checked = stateVar;
            toggle.onchange = (e) => {
                localStorage.setItem(storageKey, e.target.checked);
                if (id === 'toggle-disp-text') showDispText = e.target.checked;
                if (id === 'toggle-disp-trans') showDispTrans = e.target.checked;
                if (id === 'toggle-disp-notes') showDispNotes = e.target.checked;
                if (practiceCards.length > 0) showCurrentCard();
            };
        }
    };
    setupDisplayToggle('toggle-disp-text', showDispText, 'showDispText');
    setupDisplayToggle('toggle-disp-trans', showDispTrans, 'showDispTrans');
    setupDisplayToggle('toggle-disp-notes', showDispNotes, 'showDispNotes');

    // 音声リスト読み込み（Chrome対策）
    if (synth && synth.onvoiceschanged !== undefined) {
        synth.onvoiceschanged = () => { /* 音声リスト準備完了 */ };
    }

});
