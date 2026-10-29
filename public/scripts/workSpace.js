// Рабочее поле табло: фон, разрешение, масштаб под экран, параметры
// сигнализации активного профиля.
//
// Табло ничего из этого не редактирует — профиль приходит из
// BCS_DrillerMonitorLoader (POST /api/push/config или кадр RS-485) и прилетает
// сюда событием SSE. Здесь только применение присланного.

var _workSpace = document.querySelector('#workSpace');
var _wsCanvas  = document.querySelector('#wsCanvas');

let _activeProfileId = null;
let _alarmSoundId    = '';
let _alarmVolume     = 50;
let _alarmDelay      = 2;
let _wsWidth         = 0;
let _wsHeight        = 0;

let _settings = {
    get background() { return getComputedStyle(_workSpace).getPropertyValue('--workSpace-color').trim(); },
    set background(value) { _workSpace.style.setProperty('--workSpace-color', value); },

    get cellSize() { return parseInt(_wsCanvas.dataset['cellSize']) || 20; },
    set cellSize(value) { _wsCanvas.dataset['cellSize'] = value; },

    timezone: ''
};

// ── Разрешение и масштаб ─────────────────────────────────────────────────────

function _applyResolution(w, h) {
    _wsWidth  = w || 0;
    _wsHeight = h || 0;
    window._wsWidth  = _wsWidth;
    window._wsHeight = _wsHeight;
    if (_wsWidth > 0 && _wsHeight > 0) {
        _wsCanvas.style.width  = _wsWidth  + 'px';
        _wsCanvas.style.height = _wsHeight + 'px';
    } else {
        _wsCanvas.style.width  = '';
        _wsCanvas.style.height = '';
        _wsCanvas.style.transform = '';
        window._wsScale   = 1;
        window._wsOffsetX = 0;
        window._wsOffsetY = 0;
    }
    _updateWsScale();
}

/// Раскладка задана в пикселях пульта — вписываем её в реальный экран табло.
function _updateWsScale() {
    if (!(_wsWidth > 0 && _wsHeight > 0)) {
        window._wsScale   = 1;
        window._wsOffsetX = 0;
        window._wsOffsetY = 0;
        return;
    }
    var vw    = window.innerWidth;
    var vh    = window.innerHeight;
    var scale = Math.max(vw / _wsWidth, vh / _wsHeight);
    scale = Math.round(scale * 10000) / 10000;
    var ox = Math.round((vw - _wsWidth  * scale) / 2);
    var oy = Math.round((vh - _wsHeight * scale) / 2);
    _wsCanvas.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + scale + ')';
    window._wsScale   = scale;
    window._wsOffsetX = ox;
    window._wsOffsetY = oy;
}

window.addEventListener('resize', _updateWsScale);

function _refreshTimeIndicators() {
    document.querySelectorAll('#wsCanvas .timeIndicator, #wsCanvas .dateIndicator').forEach(function (el) {
        if (el._lastEpoch !== undefined) setIndicatorValue(el, el._lastEpoch);
    });
}

// ── Применение профиля ───────────────────────────────────────────────────────

function applyProfileFromSSE(profile) {
    _activeProfileId = profile.id;
    _alarmSoundId    = profile.alarm_sound_id || '';
    _alarmVolume     = profile.alarm_volume    != null ? parseInt(profile.alarm_volume)    : 50;
    _alarmDelay      = profile.alarm_delay     != null ? parseFloat(profile.alarm_delay)   : 2;
    // Часового пояса здесь нет: он общий для всех профилей и приходит
    // настройками табла (setBoardTimezone). Иначе смена профиля переводила бы
    // часы, хотя часы на буровой одни.
    // Фон и шаг сетки применяем здесь же: иначе новый профиль из Loader менял
    // раскладку, но оставлял прежний фон до перезагрузки страницы
    if (profile.background) _settings.background = profile.background;
    if (profile.cell_size)  _settings.cellSize   = profile.cell_size;
    _refreshTimeIndicators();
    _applyResolution(profile.ws_width || 0, profile.ws_height || 0);
}

/// Часовой пояс табла: при загрузке и по событию board-settings.
window.setBoardTimezone = function (tz) {
    _settings.timezone = (tz === undefined || tz === null || tz === '') ? '0' : String(tz);
    _refreshTimeIndicators();
};

window._getAlarmConfig = function() {
    return { soundId: _alarmSoundId, volume: _alarmVolume, delay: _alarmDelay };
};
