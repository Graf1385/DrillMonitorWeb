// Видеоиндикатор: поток с регистратора и его воспроизведение.
// Требует hls.min.js, загруженный раньше. _buildVideoElement вызывается из
// main.js при восстановлении раскладки, присланной BCS_DrillerMonitorLoader —
// на табло камера не настраивается.

// ── Построение элемента ──────────────────────────────────────────────────────

function _buildVideoElement(cfg) {
    var el = document.createElement('div');
    el.className = 'indicator videoIndicator';
    el.id        = 'item_' + Date.now() + '_' + (window._itemIdSeq = (window._itemIdSeq || 0) + 1);
    el.style.borderColor = '#38bdf8';
    el.style.setProperty('--value-color', '#38bdf8');
    el.style.width  = (cfg.width  || 320) + 'px';
    el.style.height = (cfg.height || 240) + 'px';
    el.dataset.width         = cfg.width         || 320;
    el.dataset.height        = cfg.height        || 240;
    el.dataset.headerText    = cfg.headerText    || 'Камера';
    el.dataset.headerColor   = cfg.headerColor   || '#c9d1d9';
    el.dataset.headerBg      = cfg.headerBg      || '#161b22';
    el.dataset.streamHost    = cfg.streamHost    || '';
    el.dataset.streamPort    = cfg.streamPort    || '554';
    el.dataset.streamUser    = cfg.streamUser    || '';
    el.dataset.streamPass    = cfg.streamPass    || '';
    el.dataset.streamChannel = cfg.streamChannel || '1';
    el.dataset.streamSub     = cfg.streamSub     || '0';

    var hdr = document.createElement('div');
    hdr.className   = 'indicatorHeader';
    hdr.textContent = cfg.headerText || 'Камера';
    hdr.style.color      = cfg.headerColor || '#c9d1d9';
    hdr.style.background = cfg.headerBg    || '#161b22';
    // Заголовок — единственное оформление, которое есть у видеоиндикатора:
    // шрифт и размер должны работать так же, как у остальных типов
    hdr.style.fontFamily = _getFontFamily(cfg.headerFont);
    if (cfg.headerSize) hdr.style.fontSize = _fontFromPct(cfg.headerSize);
    el.appendChild(hdr);

    var wrap = document.createElement('div');
    wrap.className = 'videoWrap';

    var video = document.createElement('video');
    video.autoplay    = true;
    video.muted       = true;
    video.playsInline = true;
    wrap.appendChild(video);

    var overlay = document.createElement('div');
    overlay.className   = 'videoOverlay';
    overlay.textContent = 'Нет сигнала';
    wrap.appendChild(overlay);

    el.appendChild(wrap);
    return el;
}

// ── Stream lifecycle ──────────────────────────────────────────────────────────

var _hlsInstances = {};
var _videoRetries = {};

// Сервер поднимает упавший ffmpeg сам, но плеер после фатальной ошибки уже не
// вернётся к потоку: на табло без доступа это «Ошибка потока» до перезагрузки
// страницы. Поэтому подключаемся заново, пока виджет на экране.
var VIDEO_RETRY_MS = 10000;

// Кодек камеры сам не поменяется, а каждая попытка заново поднимает ffmpeg.
// Переспрашиваем раз в минуту — на случай, если камеру перенастроили
var VIDEO_CODEC_RETRY_MS = 60000;

function _scheduleVideoRetry(el, delayMs) {
    var key = el.id;
    if (_videoRetries[key]) return;
    _videoRetries[key] = setTimeout(function () {
        delete _videoRetries[key];
        if (!document.body.contains(el)) return;
        _startVideoStream(el);
    }, delayMs || VIDEO_RETRY_MS);
}

// Поток дошёл, но проиграть его нечем: браузер табло не знает этого кодека.
// Так выглядит камера, настроенная на H.265, — MSE в Chromium под Linux его
// не поддерживает. Отдельное сообщение нужно потому, что «ошибка потока»
// одинаково выглядит и при обрыве связи, и здесь, а чинить надо разное.
function _isCodecError(data) {
    var details = data && data.details ? String(data.details) : '';
    if (/[Cc]odec/.test(details)) return true;
    var text = '';
    if (data) {
        if (data.reason) text += data.reason;
        if (data.mimeType) text += ' ' + data.mimeType;
        if (data.error && data.error.message) text += ' ' + data.error.message;
        if (data.err   && data.err.message)   text += ' ' + data.err.message;
    }
    return /codec|hvc1|hev1|hevc/i.test(text);
}

function _cancelVideoRetry(key) {
    if (_videoRetries[key]) { clearTimeout(_videoRetries[key]); delete _videoRetries[key]; }
}

function _startVideoStream(el) {
    var key = el.id;
    var d   = el.dataset;
    if (!d.streamHost) return;
    _cancelVideoRetry(key);

    var overlay = el.querySelector('.videoOverlay');
    if (overlay) { overlay.style.display = ''; overlay.textContent = 'Подключение…'; }

    $.ajax({
        url:         '/api/streams/start',
        method:      'POST',
        contentType: 'application/json',
        data: JSON.stringify({
            streamKey: key,
            host:      d.streamHost,
            port:      parseInt(d.streamPort)    || 554,
            username:  d.streamUser,
            password:  d.streamPass,
            channel:   parseInt(d.streamChannel) || 1,
            substream: d.streamSub === '1'
        }),
        success: function (resp) {
            setTimeout(function () {
                // Виджет могли удалить, пока ждали готовности потока
                if (!document.body.contains(el)) return;
                _attachHls(el, resp.hlsUrl);
            }, 2000);
        },
        error: function () {
            if (overlay) { overlay.style.display = ''; overlay.textContent = 'Ошибка подключения'; }
            _scheduleVideoRetry(el);
        }
    });
}

function _attachHls(el, hlsUrl) {
    var video   = el.querySelector('video');
    var overlay = el.querySelector('.videoOverlay');
    var key     = el.id;
    if (!video) return;

    if (_hlsInstances[key]) { _hlsInstances[key].destroy(); delete _hlsInstances[key]; }

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        var hls = new Hls({ liveSyncDurationCount: 2, maxLiveSyncPlaybackRate: 1.2, debug: false });
        _hlsInstances[key] = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play().catch(function () {});
            if (overlay) overlay.style.display = 'none';
        });
        hls.on(Hls.Events.ERROR, function (evt, data) {
            if (!data.fatal) return;
            var codec = _isCodecError(data);
            if (overlay) {
                overlay.style.display = '';
                overlay.textContent   = codec
                    ? 'Камера передаёт кодек, который табло не проигрывает — переключите её на H.264'
                    : 'Ошибка потока — переподключение';
            }
            hls.destroy();
            if (_hlsInstances[key] === hls) delete _hlsInstances[key];
            _scheduleVideoRetry(el, codec ? VIDEO_CODEC_RETRY_MS : VIDEO_RETRY_MS);
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsUrl;
        video.addEventListener('loadeddata', function () {
            if (overlay) overlay.style.display = 'none';
        });
        video.play().catch(function () {});
    }
}

function _stopVideoStream(el) {
    var key = el.id;
    _cancelVideoRetry(key);
    if (_hlsInstances[key]) { _hlsInstances[key].destroy(); delete _hlsInstances[key]; }
    var video = el.querySelector('video');
    if (video) { video.src = ''; video.load(); }
    $.ajax({
        url: '/api/streams/stop', method: 'POST',
        contentType: 'application/json',
        global: false,
        data: JSON.stringify({ streamKey: key })
    });
}

window.addEventListener('beforeunload', function () {
    // Обычный ajax браузер обрывает при выгрузке страницы — ffmpeg оставался
    // работать на сервере; sendBeacon гарантированно доставляет запрос
    document.querySelectorAll('#workSpace .videoIndicator').forEach(function (el) {
        var payload = JSON.stringify({ streamKey: el.id });
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/streams/stop', new Blob([payload], { type: 'application/json' }));
        } else {
            _stopVideoStream(el);
        }
    });
});
