// Индикаторы табло: построение, показ значений, сигнализация.
//
// Константы и помощники — indicatorHelpers.js, реестр типов — indicatorTypes.js
// (загружаются раньше). Раскладку, параметры и сами индикаторы табло не
// редактирует: их готовит и присылает BCS_DrillerMonitorLoader. Здесь остаётся
// только показ и единственное действие оператора — квитирование тревоги.
//
// Тревоги решает сервер табла (server/alarm.js), а не эта страница: история
// должна переживать перезагрузку киоска, а реле оповещателя висит на USB
// сервера. Сюда приходит готовое состояние (SSE «alarm-state»): какие тревоги
// активны и квитированы, звучит ли динамик. Страница его только рисует.

var _fontsPromise = null;

// ── Alarm state ───────────────────────────────────────────────────────────────

var _alarmLog           = [];
var _alarmSoundTimeout  = null;
var _alarmAudio         = null;
var _alarmSoundPending  = false;
var _alarmAudioBanner   = null;
var _alarmState         = null;   // последнее состояние от сервера
var _speakerWanted      = false;  // сервер велит звучать динамику

window.getAlarmLog      = function() { return _alarmLog; };
window.stopAlarmSound   = function() { _stopAlarmSound(); };

function _getAudioBanner() {
    if (!_alarmAudioBanner) _alarmAudioBanner = document.getElementById('alarmAudioBanner');
    return _alarmAudioBanner;
}

function _showAudioBanner() {
    var b = _getAudioBanner();
    if (b) b.classList.add('visible');
}

function _hideAudioBanner() {
    var b = _getAudioBanner();
    if (b) b.classList.remove('visible');
}

function alarmAudioBannerClick() {
    _alarmSoundPending = false;
    _hideAudioBanner();
    if (_hasUnackedAlarm()) _playAlarmSound();
}

function _hasUnackedAlarm() {
    return _speakerWanted;
}

function _stopAlarmSound() {
    clearTimeout(_alarmSoundTimeout);
    _alarmSoundTimeout = null;
    _alarmSoundPending = false;
    _hideAudioBanner();
    if (_alarmAudio) {
        _alarmAudio.pause();
        _alarmAudio.currentTime = 0;
        _alarmAudio = null;
    }
}

function _playAlarmSound() {
    var cfg = window._getAlarmConfig ? window._getAlarmConfig() : {};
    if (!cfg.soundId) return;
    if (_alarmAudio && !_alarmAudio.paused) return;
    _alarmAudio = new Audio('/api/alarm-sounds/' + cfg.soundId + '/file');
    _alarmAudio.volume = Math.max(0, Math.min(1, (cfg.volume ?? 50) / 100));
    _alarmAudio.addEventListener('ended', function() {
        _alarmAudio = null;
        if (_hasUnackedAlarm()) {
            var delay = (parseFloat((window._getAlarmConfig ? window._getAlarmConfig() : {}).delay) || 2) * 1000;
            _alarmSoundTimeout = setTimeout(_playAlarmSound, delay);
        }
    });
    _alarmAudio.play().catch(function() {
        _alarmSoundPending = true;
        _alarmAudio = null;
        _showAudioBanner();
    });
}

/// Ключ тревоги индикатора — так же его строит сервер (alarm.keyOf):
/// параметр и пороги. Без включённой сигнализации ключа нет.
function _alarmKey(el) {
    var d = el.dataset;
    if (d.alarmEnabled !== '1' || d.paramId === '' || d.paramId === undefined) return null;
    return d.paramId + '|' + (d.alarmMin || '') + '|' + (d.alarmMax || '');
}

function _showAlarmNote(text) {
    var el = document.getElementById('alarmNote');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('visible', !!text);
}

/**
 * Нарисовать состояние тревог, присланное сервером. Вызывается на каждое
 * событие «alarm-state» и после перестройки раскладки — новые элементы
 * индикаторов о тревоге ещё не знают.
 */
function applyAlarmState(s) {
    if (s) _alarmState = s;
    s = _alarmState;
    if (!s) return;

    var byKey = {};
    (s.alarms || []).forEach(function (a) { byKey[a.key] = a; });

    document.querySelectorAll('#workSpace .indicator').forEach(function (el) {
        var key = _alarmKey(el);
        var a   = key ? byKey[key] : null;
        el._alarmKey    = key;
        el._alarmActive = !!a;
        el._alarmAcked  = !!(a && a.acked);
        el.classList.toggle('alarm-active', !!a && !a.acked);
        el.classList.toggle('alarm-acked',  !!a && !!a.acked);
        el.classList.toggle('alarm-stale',  !!a && !!s.stale);
        if (a) el.style.setProperty('--alarm-color', el.dataset.alarmColor || a.color || '#ff0000');
    });

    _alarmLog = s.recent || [];
    document.dispatchEvent(new CustomEvent('alarmLogUpdate'));

    var note = '';
    if (s.stale && (s.alarms || []).length)
        note = 'Нет данных — состояние тревоги неизвестно, звук выключен';
    else if (s.fallback)
        note = 'Оповещатель не отвечает — звук тревоги через динамик';
    _showAlarmNote(note);

    var was = _speakerWanted;
    _speakerWanted = !!s.speaker;
    if (_speakerWanted && !was) _playAlarmSound();
    else if (!_speakerWanted)   _stopAlarmSound();
}
window.applyAlarmState = applyAlarmState;

// ── Квитирование ──────────────────────────────────────────────────────────────
//
// Единственное действие, которое оператор делает на самом табло: заглушить
// сирену по сработавшей тревоге. Настройки сюда не возвращаем — меню
// появляется только на индикаторе, который сейчас в тревоге.

var _ctxMenu   = document.querySelector('#indicatorContextMenu');
var _ctxTarget = null;

function _hideCtxMenu() {
    if (_ctxMenu) _ctxMenu.classList.remove('visible');
    _ctxTarget = null;
}

function _showCtxMenu(indicator, x, y) {
    if (!_ctxMenu) return;
    _ctxTarget = indicator;
    var menuW = _ctxMenu.offsetWidth  || 190;
    var menuH = _ctxMenu.offsetHeight || 40;
    if (x + menuW > window.innerWidth)  x = window.innerWidth  - menuW - 4;
    if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 4;
    _ctxMenu.style.left = x + 'px';
    _ctxMenu.style.top  = y + 'px';
    _ctxMenu.classList.add('visible');
}

function ctxAckAlarm() {
    var el = _ctxTarget;
    _hideCtxMenu();
    if (!el || !el._alarmActive || el._alarmAcked || !el._alarmKey) return;
    // Решает сервер: он запишет квитирование в историю и пришлёт новое
    // состояние всем экранам — этот перерисуется вместе с остальными
    $.ajax({
        url:         '/api/alarms/ack',
        method:      'POST',
        contentType: 'application/json',
        global:      false, // фоновый запрос — не показывать полноэкранный лоадер
        data:        JSON.stringify({ key: el._alarmKey })
    }).fail(function () { showError('Квитирование не дошло до сервера табла'); });
}

document.addEventListener('contextmenu', function (e) {
    var indicator = e.target.closest('.indicator');
    if (!indicator || !indicator._alarmActive || indicator._alarmAcked) return;
    e.preventDefault();
    _showCtxMenu(indicator, e.clientX, e.clientY);
});

document.addEventListener('mousedown', function (e) {
    if (_ctxMenu && !_ctxMenu.contains(e.target)) _hideCtxMenu();
}, true);

document.addEventListener('scroll', _hideCtxMenu, true);

// ── Шрифты ────────────────────────────────────────────────────────────────────

function _loadFonts() {
    if (_fontsPromise) return _fontsPromise;
    _fontsPromise = $.getJSON('/api/fonts').then(function (fonts) {
        var styleEl = document.createElement('style');
        fonts.forEach(function (f) {
            var family = 'font-id-' + f.id;
            _fontMap[f.id] = family;
            styleEl.textContent += '@font-face{font-family:"' + family + '";src:url("/api/fonts/' + f.id + '/file");}\n';
        });
        document.head.appendChild(styleEl);
    }, function () {
        showError('Ошибка загрузки шрифтов');
        _fontsPromise = null;
    });
    return _fontsPromise;
}

// ── Значение индикатора ───────────────────────────────────────────────────────

function setIndicatorValue(el, val) {
    var type    = _getIndicatorType(el);
    var typeDef = _indicatorTypes[type] || _indicatorTypes.digitalIndicator;

    if (!typeDef.isNumeric) {
        if (typeDef.setValue) typeDef.setValue(el, val);
        return;
    }

    // Обрыв данных (null) не превращаем в 0: показываем «нет данных»
    if (val == null || isNaN(+val)) {
        el._currentValue = null;
        if (typeDef.setValue) typeDef.setValue(el, null);
        return;
    }

    var r = _parseRange(el.dataset);
    el._currentValue = Math.max(r.min, Math.min(r.max, +val));
    var zc = _getZoneColor(el, el._currentValue);

    if (typeDef.setValue) typeDef.setValue(el, el._currentValue, zc);
    // Тревогу здесь не проверяем: её решает сервер по тому же значению
    // (server/alarm.js) и присылает состояние — см. applyAlarmState
}

// ── Построение индикатора ─────────────────────────────────────────────────────

function _getIndicatorType(el) {
    for (var type in _indicatorTypes) {
        if (el.classList.contains(type)) return type;
    }
    return 'digitalIndicator';
}

function _addIndicator(type, config, left, top) {
    var typeDef = _indicatorTypes[type] || _indicatorTypes.digitalIndicator;
    var cfg     = Object.assign({}, config);
    var def     = typeDef.defaultSize || {};
    if (!cfg.width)  cfg.width  = def.width  || null;
    if (!cfg.height) cfg.height = def.height || null;

    var el = document.createElement('div');
    el.className = 'indicator ' + type;
    // Date.now() один на все элементы, созданные в одну миллисекунду
    // (восстановление профиля) — добавляем сквозной счётчик
    el.id        = 'item_' + Date.now() + '_' + (window._itemIdSeq = (window._itemIdSeq || 0) + 1);
    el.style.left        = left + 'px';
    el.style.top         = top  + 'px';
    el.style.borderColor = cfg.valueColor;
    el.style.setProperty('--value-color', cfg.valueColor);
    _applySize(el, cfg);
    _storeConfig(el, cfg);
    // Только что построенный индикатор показаний ещё не знает. Ноль здесь был
    // полноценным значением: при alarmMin > 0 он поднимал тревогу с сиреной и
    // записью в историю — на каждое сохранение раскладки, смену профиля и
    // перезагрузку киоска, до того как придёт первая запись.
    el._currentValue = null;

    var header = document.createElement('div');
    header.className = 'indicatorHeader';
    _applyToHeader(header, cfg);
    el.appendChild(header);

    typeDef.create(el, cfg);
    // Не только числовым: часы иначе встают на «00:00:00», а это выглядит
    // показанием. У типов без setValue вызов ничего не делает.
    setIndicatorValue(el, null);
    return el;
}

// Полное удаление индикатора с освобождением ресурсов (видео-поток, обсерверы).
// Нужно при смене раскладки: без этого ffmpeg на сервере остаётся навсегда.
window.removeIndicatorElement = function (el) {
    if (!el) return;
    if (el.classList.contains('videoIndicator')) _stopVideoStream(el);
    if (el._tickerObserver) el._tickerObserver.disconnect();
    if (el._alarmObserver)  el._alarmObserver.disconnect();
    if (el._alarmOverlay)   el._alarmOverlay.remove();
    el.remove();
};
