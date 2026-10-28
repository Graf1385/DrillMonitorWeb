// Индикаторы табло: построение, показ значений, сигнализация.
//
// Константы и помощники — indicatorHelpers.js, реестр типов — indicatorTypes.js
// (загружаются раньше). Раскладку, параметры и сами индикаторы табло не
// редактирует: их готовит и присылает BCS_DrillerMonitorLoader. Здесь остаётся
// только показ и единственное действие оператора — квитирование тревоги.

var _fontsPromise = null;

// ── Alarm state ───────────────────────────────────────────────────────────────

var _alarmLog           = [];
var _alarmSoundTimeout  = null;
var _alarmAudio         = null;
var _alarmSoundPending  = false;
var _alarmAudioBanner   = null;

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
    return !!document.querySelector('#workSpace .alarm-active');
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

function _addAlarmLogEntry(el, val, event) {
    var name  = el.dataset.headerText || 'Индикатор';
    var color = el.dataset.alarmColor || '#ff0000';
    _alarmLog.unshift({ ts: new Date(), name: name, value: val, event: event, color: color });
    if (_alarmLog.length > 200) _alarmLog.length = 200;

    var eventLabel = event === 'trigger' ? 'ТРЕВОГА' : (event === 'clear' ? 'СБРОС' : 'КВИТИРОВАНИЕ');
    var valStr     = typeof val === 'number' ? val.toFixed(2) : String(val);
    $.ajax({
        url:         '/api/logs',
        method:      'POST',
        contentType: 'application/json',
        global:      false, // фоновый запрос — не показывать полноэкранный лоадер
        data:        JSON.stringify({ message: '[Сигнализация] ' + eventLabel + ': ' + name + ' = ' + valStr })
    });
    document.dispatchEvent(new CustomEvent('alarmLogUpdate'));
}

function _checkAlarm(el, numericVal) {
    var d = el.dataset;
    if (d.alarmEnabled !== '1') {
        if (el._alarmActive) {
            el._alarmActive = false;
            el._alarmAcked  = false;
            el.classList.remove('alarm-active', 'alarm-acked');
            if (!_hasUnackedAlarm()) { _stopAlarmSound(); }
        }
        return;
    }
    var alarmMin = d.alarmMin !== '' && d.alarmMin !== undefined ? parseFloat(d.alarmMin) : null;
    var alarmMax = d.alarmMax !== '' && d.alarmMax !== undefined ? parseFloat(d.alarmMax) : null;
    if (alarmMin === null && alarmMax === null) return;

    var inAlarm = false;
    if (alarmMin !== null && !isNaN(alarmMin) && numericVal < alarmMin) inAlarm = true;
    if (alarmMax !== null && !isNaN(alarmMax) && numericVal > alarmMax) inAlarm = true;

    el.style.setProperty('--alarm-color', d.alarmColor || '#ff0000');

    var wasActive = !!el._alarmActive;
    if (inAlarm && !wasActive) {
        el._alarmActive = true;
        el._alarmAcked  = false;
        el.classList.add('alarm-active');
        el.classList.remove('alarm-acked');
        _addAlarmLogEntry(el, numericVal, 'trigger');
        _playAlarmSound();
    } else if (!inAlarm && wasActive) {
        el._alarmActive = false;
        el._alarmAcked  = false;
        el.classList.remove('alarm-active', 'alarm-acked');
        _addAlarmLogEntry(el, numericVal, 'clear');
        if (!_hasUnackedAlarm()) { _stopAlarmSound(); }
    }
}

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
    if (!el || !el._alarmActive || el._alarmAcked) return;
    el._alarmAcked = true;
    el.classList.remove('alarm-active');
    el.classList.add('alarm-acked');
    _addAlarmLogEntry(el, el._currentValue, 'ack');
    if (!_hasUnackedAlarm()) { _stopAlarmSound(); }
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
    // и не меняем состояние тревоги — иначе каждый обрыв связи давал
    // ложную сирену на индикаторах с alarmMin > rangeMin
    if (val == null || isNaN(+val)) {
        el._currentValue = null;
        if (typeDef.setValue) typeDef.setValue(el, null);
        return;
    }

    var r = _parseRange(el.dataset);
    el._currentValue = Math.max(r.min, Math.min(r.max, +val));
    var zc = _getZoneColor(el, el._currentValue);

    if (typeDef.setValue) typeDef.setValue(el, el._currentValue, zc);
    _checkAlarm(el, el._currentValue);
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
