'use strict';

// ── Кадры BCS_DrillerMonitorLoader → DrillMonitorWeb по RS-485 ───────────────
//
//   STX(0x02) <payload: JSON в UTF-8> ETX(0x03) <CRC16: 4 hex> CR LF
//
// • payload — тот же объект, что тело POST /api/push/data:
//     {"recNo":1,"depth":1520.5,"time":1792600112,"params":{"0":12.3,...}}
//   или уведомление состояния, как POST /api/push/state:
//     {"state":{"running":false,"reason":"остановлено оператором"}}
//   или конфигурация монитора (профиль + индикаторы), как POST /api/push/config:
//     {"config":{"profile":{...},"indicators":[...]}}
//   или настройка самого устройства (применяет server/ingestAdmin.js) — то, что
//   на мониторе правится в веб-интерфейсе, а на буровой доступно только по линии:
//     {"refs":{"units":[...],"parameters":[...]}}        справочники
//     {"net":{"mode":"static","address":"10.10.10.250",...}}  сеть (с перезагрузкой)
//     {"serial":{"enabled":true,"port":"/dev/ttyCH343","baud":57600}}
//   длинная посылка режется на части (сборка — server/configReassembler.js),
//   поле k задаёт её вид ("config", если не указано):
//     {"cfgSeq":{"id":123,"i":0,"n":4,"s":"<кусок JSON>","k":"refs"}}
//   Loader повторяет кадры настройки несколько раз; применение идемпотентно.
// • CRC — CRC-16/MODBUS (init 0xFFFF, poly 0xA001 reflected) по байтам payload,
//   4 заглавных hex-символа. Контрольное значение: crc16("123456789") = 0x4B37.
// • Линия односторонняя (без подтверждений); разборщик самосинхронизируется:
//   мусор до STX отбрасывается, кадр длиннее MAX_PAYLOAD — ошибка и ресинк.
// • CR LF после CRC необязательны (парсер их пропускает), но Loader их шлёт —
//   так кадры читаемы в терминале.

const STX = 0x02;
const ETX = 0x03;
const MAX_PAYLOAD = 64 * 1024;

function crc16(buf) {
    let crc = 0xFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let b = 0; b < 8; b++) {
            crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
        }
    }
    return crc & 0xFFFF;
}

function hex4(n) {
    return n.toString(16).toUpperCase().padStart(4, '0');
}

// Объект → Buffer кадра (используется в тестах и может пригодиться для отладки).
function encode(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    return Buffer.concat([
        Buffer.from([STX]),
        payload,
        Buffer.from([ETX]),
        Buffer.from(hex4(crc16(payload)) + '\r\n', 'ascii'),
    ]);
}

// Потоковый разборщик. onFrame(obj) — на каждый валидный кадр,
// onError(code, detail) — 'crc' | 'json' | 'overflow'.
class FrameParser {
    constructor(onFrame, onError) {
        this._onFrame = onFrame;
        this._onError = onError || function () {};
        this._buf     = Buffer.alloc(0);
        this.frames   = 0;
        this.errors   = 0;
    }

    push(chunk) {
        this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : Buffer.from(chunk);
        for (;;) {
            const stx = this._buf.indexOf(STX);
            if (stx < 0) { this._buf = Buffer.alloc(0); return; }   // только мусор
            if (stx > 0) this._buf = this._buf.subarray(stx);        // мусор до STX

            const etx = this._buf.indexOf(ETX, 1);
            if (etx < 0) {
                if (this._buf.length > MAX_PAYLOAD + 1) {           // кадр не закрывается — ресинк
                    this._fail('overflow', this._buf.length);
                    this._buf = this._buf.subarray(1);
                    continue;
                }
                return;                                            // ждём продолжения
            }
            if (etx - 1 > MAX_PAYLOAD) {
                this._fail('overflow', etx - 1);
                this._buf = this._buf.subarray(etx + 1);
                continue;
            }
            if (this._buf.length < etx + 5) return;                // ждём 4 символа CRC

            const payload = this._buf.subarray(1, etx);
            const crcText = this._buf.subarray(etx + 1, etx + 5).toString('ascii');
            let consumed  = etx + 5;
            while (consumed < this._buf.length &&
                   (this._buf[consumed] === 0x0D || this._buf[consumed] === 0x0A)) consumed++;

            if (!/^[0-9A-Fa-f]{4}$/.test(crcText) || parseInt(crcText, 16) !== crc16(payload)) {
                this._fail('crc', crcText);
                // Возможно, CRC «съеден» мусором: ищем следующий STX уже внутри хвоста
                this._buf = this._buf.subarray(1);
                continue;
            }

            let obj;
            try { obj = JSON.parse(payload.toString('utf8')); }
            catch (e) { this._fail('json', e.message); this._buf = this._buf.subarray(consumed); continue; }

            this._buf = this._buf.subarray(consumed);
            this.frames++;
            this._onFrame(obj);
        }
    }

    _fail(code, detail) {
        this.errors++;
        this._onError(code, detail);
    }
}

module.exports = { STX, ETX, MAX_PAYLOAD, crc16, hex4, encode, FrameParser };
