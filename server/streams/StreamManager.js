const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// Камера на буровой перезагружается, теряет питание, отваливается по сети — и
// ffmpeg на этом завершается. Доступа к табло нет, перезапустить вручную
// некому, поэтому поток поднимаем сами, пока его не остановили явно.
// Паузы растут: мигающую камеру незачем дёргать каждые две секунды.
const RESTART_DELAYS = [2000, 5000, 10000, 30000];
/// Прожил дольше — считаем, что поток наладился, и начинаем отсчёт заново
const STABLE_MS = 60000;

class StreamManager {
    constructor() {
        this._streams = new Map();
        this._hlsBase = path.join(os.tmpdir(), 'drillmonitor_hls');
        this._log = null;
        try { fs.mkdirSync(this._hlsBase, { recursive: true }); } catch {}
    }

    /// Логгер подключается лениво: он открывает БД, а в тестах она не нужна
    _note(msg) {
        try {
            if (!this._log) this._log = require('../logger').log;
            this._log(msg);
        } catch {}
        console.log('[streams] ' + msg);
    }

    buildRtspUrl({ rtspUrl, host, port, username, password, channel, substream }) {
        if (rtspUrl) return rtspUrl;
        const u    = encodeURIComponent(username || '');
        const p    = encodeURIComponent(password || '');
        const auth = u ? `${u}:${p}@` : '';
        const ch   = channel   || 1;
        const sub  = substream ? 1 : 0;
        return `rtsp://${auth}${host || 'localhost'}:${port || 554}/cam/realmonitor?channel=${ch}&subtype=${sub}`;
    }

    start(streamKey, rtspUrl) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(streamKey)) throw new Error('Invalid streamKey');

        // Плеер табло переспрашивает поток целиком, а не только ffmpeg: при
        // недоступной камере start() прилетает раз в десять секунд. Время
        // начала переносим на новую запись, иначе выдержка на первый сегмент
        // обнуляется каждый раз и самодиагностика считает поток исправным.
        // Сменился адрес камеры — это уже другой поток, отсчёт заново.
        const prev     = this._streams.get(streamKey);
        const openedAt = prev && prev.url === rtspUrl ? prev.openedAt : Date.now();

        this.stop(streamKey);

        const hlsDir = path.join(this._hlsBase, streamKey);
        try { fs.mkdirSync(hlsDir, { recursive: true }); } catch {}

        const entry = {
            process: null, hlsDir, url: rtspUrl,
            attempt: 0,          // подряд идущие неудачи — по ним выбираем паузу
            restarts: 0,         // всего перезапусков с момента start()
            openedAt,            // когда поток попросили впервые — переживает повторы
            startedAt: 0, lastExitAt: null, lastError: null,
            retryTimer: null, stableTimer: null,
        };
        this._streams.set(streamKey, entry);
        this._spawn(streamKey, entry);
        return hlsDir;
    }

    _spawn(streamKey, entry) {
        const proc = spawn('ffmpeg', [
            '-loglevel',    'error',
            '-rtsp_transport', 'tcp',
            '-i',           entry.url,
            '-c:v',         'copy',
            '-an',
            '-f',           'hls',
            '-hls_time',    '1',
            '-hls_list_size', '3',
            '-hls_flags',   'delete_segments+omit_endlist',
            path.join(entry.hlsDir, 'index.m3u8')
        ], { stdio: ['ignore', 'ignore', 'pipe'] });

        entry.process   = proc;
        entry.startedAt = Date.now();

        proc.stderr.on('data', d => {
            entry.lastError = String(d).trim().slice(0, 200);
            process.stderr.write(`[Stream ${streamKey}] ${d}`);
        });
        proc.on('exit', (code, signal) => this._onExit(streamKey, entry, proc, code, signal));
        // Без обработчика 'error' отсутствие ffmpeg роняет весь процесс
        proc.on('error', err => {
            entry.lastError = err.message;
            this._onExit(streamKey, entry, proc, null, null);
        });

        // Поток, проживший STABLE_MS, считаем восстановленным: сообщаем об этом
        // один раз, если до того были падения
        clearTimeout(entry.stableTimer);
        entry.stableTimer = setTimeout(() => {
            if (entry.process !== proc) return;
            if (entry.attempt > 0) this._note('Видеопоток "' + streamKey + '" восстановлен');
            entry.attempt = 0;
        }, STABLE_MS);
        entry.stableTimer.unref?.();
    }

    _onExit(streamKey, entry, proc, code, signal) {
        // Запись уже принадлежит другому процессу (успели перезапустить) или
        // поток остановили явно — восстанавливать нечего
        if (entry.process !== proc) return;
        if (this._streams.get(streamKey) !== entry) return;

        entry.process    = null;
        entry.lastExitAt = Date.now();
        clearTimeout(entry.stableTimer);

        const lived = Date.now() - entry.startedAt;
        if (lived > STABLE_MS) entry.attempt = 0;
        const delay = RESTART_DELAYS[Math.min(entry.attempt, RESTART_DELAYS.length - 1)];
        entry.attempt++;
        entry.restarts++;

        // В журнал — только первое падение подряд: иначе недоступная камера
        // забьёт логи сообщением раз в тридцать секунд
        if (entry.attempt === 1)
            this._note('Видеопоток "' + streamKey + '" прервался' +
                       (entry.lastError ? ': ' + entry.lastError : '') + ' — перезапускаю');

        clearTimeout(entry.retryTimer);
        entry.retryTimer = setTimeout(() => {
            if (this._streams.get(streamKey) !== entry) return;
            this._spawn(streamKey, entry);
        }, delay);
        entry.retryTimer.unref?.();
    }

    stop(streamKey) {
        const s = this._streams.get(streamKey);
        if (!s) return;
        this._streams.delete(streamKey);          // снимает намерение: перезапусков больше нет
        clearTimeout(s.retryTimer);
        clearTimeout(s.stableTimer);
        if (s.process) { try { s.process.kill('SIGTERM'); } catch {} }
        setTimeout(() => {
            // Стрим успели перезапустить — каталог снова используется
            if (this._streams.has(streamKey)) return;
            try { fs.rmSync(s.hlsDir, { recursive: true, force: true }); } catch {}
        }, 5000).unref?.();
    }

    stopAll() {
        for (const key of [...this._streams.keys()]) this.stop(key);
    }

    getHlsDir(streamKey) {
        const s = this._streams.get(streamKey);
        return s ? s.hlsDir : null;
    }

    isActive(streamKey) {
        return this._streams.has(streamKey);
    }

    count() {
        return this._streams.size;
    }

    hlsBase() { return this._hlsBase; }

    activeKeys() { return [...this._streams.keys()]; }

    /// Сводка для самодиагностики (server/selfCheck.js)
    diag() {
        return [...this._streams.entries()].map(([key, s]) => ({
            key,
            running:    !!s.process,
            restarts:   s.restarts,
            lastExitAt: s.lastExitAt,
            lastError:  s.lastError,
            startedAt:  s.startedAt,
            // Недоступная камера роняет ffmpeg каждые несколько секунд, и
            // startedAt всё время свежий. Выдержку на первый сегмент надо
            // отсчитывать от начала потока, а не от последней попытки
            openedAt:   s.openedAt,
            // Живой ffmpeg — ещё не идущее видео: с недоступной камерой он
            // висит и не пишет ни одного сегмента. Правду знает плейлист.
            playlistAt: _mtimeMs(path.join(s.hlsDir, 'index.m3u8')),
        }));
    }
}

function _mtimeMs(file) {
    try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

module.exports = new StreamManager();
