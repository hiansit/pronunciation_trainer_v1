/**
 * StudyDB — 汎用 教材・進捗管理 IndexedDB モジュール
 * 
 * ankiflow の MemorizationDB を参考に、より汎用的なスキーマで再設計。
 * cards.fields を JSON Object にすることで、様々な学習アプリに対応可能。
 * 
 * ストア構成:
 *   - decks: 教材セット（科目）の管理
 *   - cards: 個々の教材カード（柔軟なフィールド構造）
 *   - progress: カードごとの学習進捗
 */

class StudyDB {
    constructor(dbName = 'StudyDB_v1', version = 1) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }

    // ─── 初期化 ───────────────────────────────────────

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // デッキストア
                if (!db.objectStoreNames.contains('decks')) {
                    db.createObjectStore('decks', { keyPath: 'id', autoIncrement: true });
                }

                // カードストア
                if (!db.objectStoreNames.contains('cards')) {
                    const cardStore = db.createObjectStore('cards', { keyPath: 'id', autoIncrement: true });
                    cardStore.createIndex('deckId', 'deckId', { unique: false });
                }

                // 進捗ストア
                if (!db.objectStoreNames.contains('progress')) {
                    db.createObjectStore('progress', { keyPath: 'cardId' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('[StudyDB] 初期化完了:', this.dbName);
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('[StudyDB] 初期化エラー:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // ─── デッキ操作 ───────────────────────────────────

    async getDecks() {
        return this._readAll('decks');
    }

    async getDeck(id) {
        return this._get('decks', id);
    }

    async createDeck(name, description = '', settings = {}) {
        const now = Date.now();
        return this._add('decks', {
            name,
            description,
            settings,
            createdAt: now,
            updatedAt: now
        });
    }

    async updateDeck(id, updates) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['decks'], 'readwrite');
            const store = tx.objectStore('decks');
            const getReq = store.get(id);

            getReq.onsuccess = () => {
                const data = getReq.result;
                if (!data) { reject(new Error('デッキが見つかりません')); return; }
                const updated = { ...data, ...updates, updatedAt: Date.now() };
                store.put(updated).onsuccess = () => resolve(updated);
            };

            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async deleteDeck(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['decks', 'cards', 'progress'], 'readwrite');

            // デッキ削除
            tx.objectStore('decks').delete(id);

            // 配下カード・進捗を連鎖削除
            const cardStore = tx.objectStore('cards');
            const index = cardStore.index('deckId');
            const request = index.getAllKeys(id);

            request.onsuccess = () => {
                const cardIds = request.result;
                const progressStore = tx.objectStore('progress');
                cardIds.forEach(cardId => {
                    cardStore.delete(cardId);
                    progressStore.delete(cardId);
                });
            };

            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    // ─── カード操作 ───────────────────────────────────

    async getCards(deckId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['cards'], 'readonly');
            const index = tx.objectStore('cards').index('deckId');
            const request = index.getAll(deckId);
            request.onsuccess = () => {
                const cards = request.result;
                cards.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
                resolve(cards);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getCardsWithProgress(deckId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['cards', 'progress'], 'readonly');
            const cardIndex = tx.objectStore('cards').index('deckId');
            const progressStore = tx.objectStore('progress');

            const cardsReq = cardIndex.getAll(deckId);
            const progressReq = progressStore.getAll();

            let cards = [];
            let progressList = [];

            cardsReq.onsuccess = () => { cards = cardsReq.result; };
            progressReq.onsuccess = () => { progressList = progressReq.result; };

            tx.oncomplete = () => {
                const progressMap = new Map();
                progressList.forEach(p => progressMap.set(p.cardId, p));

                const result = cards.map(card => {
                    const p = progressMap.get(card.id) || this._defaultProgress(card.id);
                    return { ...card, progress: p };
                });

                result.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
                resolve(result);
            };

            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async addCards(deckId, cardsData) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['cards', 'progress'], 'readwrite');
            const cardStore = tx.objectStore('cards');
            const progressStore = tx.objectStore('progress');
            const addedIds = [];

            cardsData.forEach((data, index) => {
                const req = cardStore.add({
                    deckId,
                    fields: data.fields || {},
                    tags: data.tags || [],
                    sortOrder: data.sortOrder !== undefined ? data.sortOrder : index,
                    createdAt: Date.now()
                });

                req.onsuccess = (e) => {
                    const cardId = e.target.result;
                    addedIds.push(cardId);

                    // 進捗も初期化（またはインポートデータから復元）
                    const progressData = data.progress || this._defaultProgress(cardId);
                    progressData.cardId = cardId;
                    progressStore.put(progressData);
                };
            });

            tx.oncomplete = () => resolve(addedIds);
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async updateCard(card) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['cards'], 'readwrite');
            const store = tx.objectStore('cards');

            const getReq = store.get(card.id);
            getReq.onsuccess = () => {
                const existing = getReq.result;
                if (!existing) { reject(new Error('カードが見つかりません')); return; }

                const updated = {
                    ...existing,
                    fields: card.fields !== undefined ? card.fields : existing.fields,
                    tags: card.tags !== undefined ? card.tags : existing.tags,
                    sortOrder: card.sortOrder !== undefined ? card.sortOrder : existing.sortOrder
                };
                store.put(updated);
            };

            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async deleteCard(cardId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['cards', 'progress'], 'readwrite');
            tx.objectStore('cards').delete(cardId);
            tx.objectStore('progress').delete(cardId);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async getCardCount(deckId) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['cards'], 'readonly');
            const index = tx.objectStore('cards').index('deckId');
            const request = index.count(deckId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // ─── 進捗操作 ───────────────────────────────────

    async getProgress(cardId) {
        const p = await this._get('progress', cardId);
        return p || this._defaultProgress(cardId);
    }

    async updateProgress(cardId, updates) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['progress'], 'readwrite');
            const store = tx.objectStore('progress');

            const getReq = store.get(cardId);
            getReq.onsuccess = () => {
                const existing = getReq.result || this._defaultProgress(cardId);
                const now = Date.now();

                const updated = {
                    ...existing,
                    cardId,
                    level: updates.level !== undefined ? updates.level : existing.level,
                    practiceCount: (existing.practiceCount || 0) + 1,
                    lastScore: updates.score !== undefined ? updates.score : existing.lastScore,
                    lastPracticedAt: now
                };

                // 履歴に追加（最新10件を保持）
                if (!updated.history) updated.history = [];
                updated.history.push({
                    timestamp: now,
                    score: updates.score || 0,
                    level: updated.level
                });
                if (updated.history.length > 10) {
                    updated.history = updated.history.slice(-10);
                }

                // 誤認識データの蓄積（案B: 重複排除方式）
                if (updates.spokenText && updates.originalText &&
                    updates.spokenText !== updates.originalText) {
                    if (!updated.misrecognitions) updated.misrecognitions = [];

                    const existingMisrec = updated.misrecognitions.find(
                        m => m.spokenText === updates.spokenText
                    );
                    if (existingMisrec) {
                        existingMisrec.count++;
                        existingMisrec.lastAt = now;
                    } else {
                        updated.misrecognitions.push({
                            spokenText: updates.spokenText,
                            count: 1,
                            firstAt: now,
                            lastAt: now
                        });
                    }
                }

                store.put(updated);
            };

            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async removeMisrecognition(cardId, spokenText) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['progress'], 'readwrite');
            const store = tx.objectStore('progress');
            const getReq = store.get(cardId);

            getReq.onsuccess = () => {
                const data = getReq.result;
                if (data && data.misrecognitions) {
                    data.misrecognitions = data.misrecognitions.filter(m => m.spokenText !== spokenText);
                    store.put(data);
                }
                resolve();
            };

            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async resetProgress(deckId) {
        const cards = await this.getCards(deckId);
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['progress'], 'readwrite');
            const store = tx.objectStore('progress');

            cards.forEach(card => {
                store.put(this._defaultProgress(card.id));
            });

            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    // ─── インポート / エクスポート ─────────────────

    async exportDeck(deckId) {
        const deck = await this.getDeck(deckId);
        if (!deck) throw new Error('デッキが見つかりません');

        const cardsWithProgress = await this.getCardsWithProgress(deckId);

        return {
            version: 1,
            exportedAt: Date.now(),
            deck: {
                name: deck.name,
                description: deck.description,
                settings: deck.settings
            },
            cards: cardsWithProgress.map(c => ({
                fields: c.fields,
                tags: c.tags,
                sortOrder: c.sortOrder,
                progress: {
                    level: c.progress.level,
                    practiceCount: c.progress.practiceCount,
                    lastScore: c.progress.lastScore,
                    lastPracticedAt: c.progress.lastPracticedAt,
                    history: c.progress.history,
                    misrecognitions: c.progress.misrecognitions || []
                }
            }))
        };
    }

    async importDeck(jsonData) {
        const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

        const deckId = await this.createDeck(
            data.deck.name,
            data.deck.description || '',
            data.deck.settings || {}
        );

        if (data.cards && data.cards.length > 0) {
            await this.addCards(deckId, data.cards);
        }

        return deckId;
    }

    /**
     * TSVテキストからカードをインポート
     * @param {number} deckId - 対象デッキID
     * @param {string} tsvText - タブ区切りテキスト
     * @param {string[]} fieldMapping - カラムとフィールド名の対応
     *   例: ['text', 'translation', 'notes']
     */
    async importFromTSV(deckId, tsvText, fieldMapping = ['text', 'translation']) {
        const lines = tsvText.split('\n').filter(line => line.trim());
        const cardsData = [];

        lines.forEach((line, index) => {
            const columns = line.split('\t');
            const fields = {};

            fieldMapping.forEach((fieldName, colIndex) => {
                if (colIndex < columns.length) {
                    fields[fieldName] = columns[colIndex].trim();
                }
            });

            // 少なくとも最初のフィールドに値があれば追加
            if (fields[fieldMapping[0]]) {
                cardsData.push({
                    fields,
                    sortOrder: index
                });
            }
        });

        if (cardsData.length > 0) {
            await this.addCards(deckId, cardsData);
        }

        return cardsData.length;
    }

    // ─── 内部ヘルパー ─────────────────────────────

    _defaultProgress(cardId) {
        return {
            cardId,
            level: 0,
            practiceCount: 0,
            lastScore: 0,
            lastPracticedAt: 0,
            history: [],
            misrecognitions: []
        };
    }

    _readAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const request = tx.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    _get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const request = tx.objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    _add(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readwrite');
            const request = tx.objectStore(storeName).add(data);
            request.onsuccess = (e) => resolve(e.target.result);
            tx.onerror = (e) => reject(e.target.error);
        });
    }
}

// ES Module & グローバル両対応
if (typeof window !== 'undefined') {
    window.StudyDB = StudyDB;
}
