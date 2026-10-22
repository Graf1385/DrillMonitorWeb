'use strict';

// ── Сборка конфигурации монитора из кадров RS-485 ─────────────────────────────
//
// Большой конфиг (профиль + индикаторы) Loader режет на части и шлёт кадрами
// {"cfgSeq":{id,i,n,s}}: id — номер посылки, n — всего частей, i — индекс части
// (0..n-1), s — кусок JSON-строки конфига. Линия односторонняя, без подтверждений,
// поэтому Loader повторяет каждый кадр несколько раз — повтор затирает ту же
// ячейку (идемпотентно). Когда собраны все n частей одного id, строки
// склеиваются по порядку и парсятся в объект { profile, indicators }.
//
// В полёте держим только одну посылку (оператор шлёт один конфиг за раз): новый
// id, иной n или протухание по таймауту начинают сборку заново.

const DEFAULT_TTL_MS = 15000;

class ConfigReassembler {
    constructor(opts) {
        opts = opts || {};
        this._ttl = opts.ttlMs || DEFAULT_TTL_MS;
        this._now = opts.now || Date.now;   // инъекция времени для тестов
        this._cur = null;                   // { id, n, parts:[], count, at }
    }

    // Принять кадр {id, i, n, s}. Возвращает собранный объект конфига, когда все
    // части на месте и JSON валиден; иначе null (ждём остальные части / мусор).
    push(chunk) {
        if (!chunk || typeof chunk !== 'object') return null;
        const id = parseInt(chunk.id, 10);
        const i  = parseInt(chunk.i, 10);
        const n  = parseInt(chunk.n, 10);
        const s  = chunk.s;
        if (isNaN(id) || isNaN(i) || isNaN(n) ||
            n < 1 || i < 0 || i >= n || typeof s !== 'string') {
            return null;
        }

        const now = this._now();
        // Новый id, иной n или протухшая сборка — начать заново
        if (!this._cur || this._cur.id !== id || this._cur.n !== n ||
            (now - this._cur.at) > this._ttl) {
            this._cur = { id: id, n: n, parts: new Array(n).fill(null), count: 0, at: now };
        }
        this._cur.at = now;

        if (this._cur.parts[i] === null) this._cur.count++;
        this._cur.parts[i] = s;   // повтор затирает тем же значением

        if (this._cur.count < n) return null;

        const json = this._cur.parts.join('');
        this._cur = null;
        try {
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    reset() { this._cur = null; }
}

module.exports = { ConfigReassembler, DEFAULT_TTL_MS };
