// Video widget — stream lifecycle and HLS playback.
// Requires hls.min.js loaded before this file.
// _buildVideoElement is called from main.js when restoring saved indicators.

var _videoSettingsEl = null;

// ── Settings modal ────────────────────────────────────────────────────────────

function openVideoSettings(el) {
    _videoSettingsEl = el;
    var d = el.dataset;
    document.querySelector('#vs_title').value       = d.headerText    || 'Камера';
    document.querySelector('#vs_host').value        = d.streamHost    || '';
    document.querySelector('#vs_port').value        = d.streamPort    || '554';
    document.querySelector('#vs_username').value    = d.streamUser    || '';
    document.querySelector('#vs_password').value    = d.streamPass    || '';
    document.querySelector('#vs_channel').value     = d.streamChannel || '1';
    document.querySelector('#vs_substream').checked = d.streamSub === '1';
    document.querySelector('#vs_width').value       = d.width         || '320';
    document.querySelector('#vs_height').value      = d.height        || '240';
    document.querySelector('#videoSettingsModal').showModal();
}

function showNewVideoItem() {
    _videoSettingsEl = null;
    document.querySelector('#vs_title').value       = 'Камера';
    document.querySelector('#vs_host').value        = '';
    document.querySelector('#vs_port').value        = '554';
    document.querySelector('#vs_username').value    = '';
    document.querySelector('#vs_password').value    = '';
    document.querySelector('#vs_channel').value     = '1';
    document.querySelector('#vs_substream').checked = false;
    document.querySelector('#vs_width').value       = '320';
    document.querySelector('#vs_height').value      = '240';
    document.querySelector('#videoSettingsModal').showModal();
}

function submitVideoSettings() {
    var host = document.querySelector('#vs_host').value.trim();
    if (!host) { showError('Введите адрес камеры'); return; }

    var cfg = {
        headerText:    document.querySelector('#vs_title').value.trim() || 'Камера',
        streamHost:    host,
        streamPort:    document.querySelector('#vs_port').value.trim()    || '554',
        streamUser:    document.querySelector('#vs_username').value.trim(),
        streamPass:    document.querySelector('#vs_password').value,
        streamChannel: document.querySelector('#vs_channel').value.trim()  || '1',
        streamSub:     document.querySelector('#vs_substream').checked ? '1' : '0',
        width:         parseInt(document.querySelector('#vs_width').value)  || 320,
        height:        parseInt(document.querySelector('#vs_height').value) || 240
    };

    document.querySelector('#videoSettingsModal').close();

    if (_videoSettingsEl) {
        _applyVideoConfig(_videoSettingsEl, cfg);
        showSaveBtn();
    } else {
        var ws   = document.querySelector('#workSpace');
        var left = Math.max(20, Math.round(ws.clientWidth  / 2 - cfg.width  / 2));
        var top  = Math.max(20, Math.round(ws.clientHeight / 2 - cfg.height / 2));
        var el   = _buildVideoElement(cfg);
        el.style.left = left + 'px';
        el.style.top  = top  + 'px';
        ws.appendChild(el);
        _startVideoStream(el);
        showSaveBtn();
    }
    _videoSettingsEl = null;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _applyVideoConfig(el, cfg) {
    el.style.width  = cfg.width  + 'px';
    el.style.height = cfg.height + 'px';
    el.dataset.width         = cfg.width;
    el.dataset.height        = cfg.height;
    el.dataset.headerText    = cfg.headerText;
    el.dataset.streamHost    = cfg.streamHost;
    el.dataset.streamPort    = cfg.streamPort;
    el.dataset.streamUser    = cfg.streamUser;
    el.dataset.streamPass    = cfg.streamPass;
    el.dataset.streamChannel = cfg.streamChannel;
    el.dataset.streamSub     = cfg.streamSub;
    var hdr = el.querySelector('.indicatorHeader');
    if (hdr) hdr.textContent = cfg.headerText;
    _stopVideoStream(el);
    _startVideoStream(el);
}

function _buildVideoElement(cfg) {
    var el = document.createElement('div');
    el.className = 'indicator videoIndicator';
    el.id        = 'item_' + Date.now();
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

function _startVideoStream(el) {
    var key = el.id;
    var d   = el.dataset;
    if (!d.streamHost) return;

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
            setTimeout(function () { _attachHls(el, resp.hlsUrl); }, 2000);
        },
        error: function () {
            if (overlay) { overlay.style.display = ''; overlay.textContent = 'Ошибка подключения'; }
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
            if (data.fatal && overlay) {
                overlay.style.display = '';
                overlay.textContent   = 'Ошибка потока';
            }
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
    if (_hlsInstances[key]) { _hlsInstances[key].destroy(); delete _hlsInstances[key]; }
    var video = el.querySelector('video');
    if (video) { video.src = ''; video.load(); }
    $.ajax({
        url: '/api/streams/stop', method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ streamKey: key })
    });
}

window.addEventListener('beforeunload', function () {
    document.querySelectorAll('#workSpace .videoIndicator').forEach(_stopVideoStream);
});
