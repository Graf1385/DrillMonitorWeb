'use strict';

// ── Сборка длинных посылок из кадров RS-485 ───────────────────────────────────
//
// То, что не влезает в один кадр (конфиг профиля с индикаторами, справочник
// параметров), Loader режет на части и шлёт кадрами {"cfgSeq":{id,i,n,s,k}}:
// id — номер посылки, n — всего частей, i — индекс части (0..n-1), s — кусок
// JSON-строки, k — что это за посылка ("config" по умолчанию, также
// "net", "serial"). Линия односторонняя, без подтверждений, поэтому Loader
// повторяет каждый кадр несколько раз — повтор затирает ту же ячейку
// (идемпотентно). Когда собраны все n частей одного id, строки склеиваются по
// порядку, парсятся и возвращаются как { kind, data }.
//
// В полёте держим только одну посылку (оператор шлёт одну за раз): новый id,
// иной n или k, протухание по таймауту — начинают сборку заново.

const DEFAULT_TTL_MS = 15000;
const mono = require('./monotonic');

class ConfigReassembler {
    constructor(opts) {
        opts = opts || {};
        this._ttl = opts.ttlMs || DEFAULT_TTL_MS;
        // Монотонные часы: перевод системных (timeSync) посреди длинной
        // посылки не должен выбрасывать уже собранные части — пакет
        // обновления идёт минутами. Инъекция — для тестов.
        this._now = opts.now || mono.now;
        this._cur = null;                   // { id, n, parts:[], count, at }
    }

    // Принять кадр {id, i, n, s, k}. Возвращает { kind, data }, когда все части
    // на месте и JSON валиден; иначе null (ждём остальные части / мусор).
    push(chunk) {
        if (!chunk || typeof chunk !== 'object') return null;
        const id   = parseInt(chunk.id, 10);
        const i    = parseInt(chunk.i, 10);
        const n    = parseInt(chunk.n, 10);
        const s    = chunk.s;
        const kind = chunk.k === undefined || chunk.k === null ? 'config' : String(chunk.k);
        if (isNaN(id) || isNaN(i) || isNaN(n) ||
            n < 1 || i < 0 || i >= n || typeof s !== 'string') {
            return null;
        }

        const now = this._now();
        // Новый id, иной n или kind, протухшая сборка — начать заново
        if (!this._cur || this._cur.id !== id || this._cur.n !== n || this._cur.kind !== kind ||
            (now - this._cur.at) > this._ttl) {
            this._cur = { id: id, n: n, kind: kind, parts: new Array(n).fill(null), count: 0, at: now };
        }
        this._cur.at = now;

        if (this._cur.parts[i] === null) this._cur.count++;
        this._cur.parts[i] = s;   // повтор затирает тем же значением

        if (this._cur.count < n) return null;

        const json = this._cur.parts.join('');
        this._cur = null;
        try {
            return { kind: kind, data: JSON.parse(json) };
        } catch (e) {
            return null;
        }
    }

    /// Сколько частей уже собрано и сколько всего — для показа хода приёма.
    received() { return this._cur ? this._cur.count : 0; }
    total()    { return this._cur ? this._cur.n : 0; }

    reset() { this._cur = null; }
}

module.exports = { ConfigReassembler, DEFAULT_TTL_MS };
