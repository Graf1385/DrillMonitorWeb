document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

// ── Toasts ────────────────────────────────────────────────────────────────────

(function () {
    function _makeToast(id) {
        var toast   = document.getElementById(id);
        var msgEl   = toast.querySelector('.toast-msg');
        var barEl   = toast.querySelector('.toast-bar');
        var closeEl = toast.querySelector('.toast-close');
        var timer   = null;

        var _supportsPopover = typeof toast.showPopover === 'function';

        function hide() {
            toast.classList.remove('visible');
            clearTimeout(timer);
            document.removeEventListener('mousedown', onDocClick);
            if (_supportsPopover) {
                setTimeout(function () {
                    try { toast.hidePopover(); } catch (e) {}
                }, 460);
            }
        }

        function onDocClick(e) {
            if (!toast.contains(e.target)) hide();
        }

        closeEl.addEventListener('click', function (e) {
            e.stopPropagation();
            hide();
        });

        return function show(msg) {
            msgEl.textContent = msg;
            barEl.style.animation = 'none';
            void barEl.offsetWidth;
            barEl.style.animation = '';
            if (_supportsPopover) {
                try {
                    if (toast.matches(':popover-open')) toast.hidePopover();
                    toast.showPopover();
                } catch (e) {}
            }
            toast.classList.add('visible');
            clearTimeout(timer);
            document.removeEventListener('mousedown', onDocClick);
            timer = setTimeout(hide, 5000);
            setTimeout(function () { document.addEventListener('mousedown', onDocClick); }, 0);
        };
    }

    window.showError   = _makeToast('errorToast');
    window.showSuccess = _makeToast('successToast');
})();

// ── Версия программы ──────────────────────────────────────────────────────────
//
// Проверять релизы на GitHub табло нечем: в интернет оно не ходит. Новая версия
// приезжает из BCS_DrillerMonitorLoader — по RS-485 или TCP/IP, и устройство
// перезагружается само. Версию показывают Loader и служебная страница /service;
// на экране бурильщика её нет, как нет и кнопок.

// ── Настройки табла ───────────────────────────────────────────────────────────
//
// Часовой пояс общий для всех профилей: часы на буровой одни, какой профиль ни
// покажи. Раньше он лежал в профиле, и переключение профиля переводило часы.

$.getJSON('/api/board-settings', function (s) {
    if (s && window.setBoardTimezone) window.setBoardTimezone(s.timezone);
}).fail(function () { showError('Настройки табла не прочитаны'); });

function _restoreIndicators(indicators) {
    var ws  = document.querySelector('#wsCanvas');
    ws.querySelectorAll('.videoIndicator').forEach(function(el) { _stopVideoStream(el); });
    ws.querySelectorAll('.tickerIndicator').forEach(function(el) {
        if (el._tickerObserver) el._tickerObserver.disconnect();
    });
    ws.querySelectorAll('.indicator').forEach(function(el) { el.remove(); });

    // Размер поля берём у пустой канвы: проценты раскладки должны считаться
    // от экрана, а не от того, что на нём осталось от прежней раскладки
    var wsW = (_wsWidth  > 0) ? _wsWidth  : ws.clientWidth;
    var wsH = (_wsHeight > 0) ? _wsHeight : ws.clientHeight;
    indicators.forEach(function(ind) {
        var left = Math.round((ind.pos_left || 0) * wsW / 100);
        var top  = Math.round((ind.pos_top  || 0) * wsH / 100);
        var el;

        if (ind.type === 'videoIndicator') {
            var extra = {};
            try { extra = JSON.parse(ind.extra_data || '{}'); } catch (e) { console.warn('extra_data parse error', e); }
            el = _buildVideoElement({
                headerText:    ind.header_text  || 'Камера',
                headerColor:   ind.header_color || '#c9d1d9',
                headerBg:      ind.header_bg    || '#161b22',
                headerFont:    ind.header_font,
                headerSize:    ind.header_size,
                streamHost:    extra.streamHost    || '',
                streamPort:    extra.streamPort    || '554',
                streamUser:    extra.streamUser    || '',
                streamPass:    extra.streamPass    || '',
                streamChannel: extra.streamChannel || '1',
                streamSub:     extra.streamSub     || '0',
                width:  ind.width  != null ? Math.round(ind.width  * wsW / 100) : 320,
                height: ind.height != null ? Math.round(ind.height * wsH / 100) : 240
            });
            el.style.left = left + 'px';
            el.style.top  = top  + 'px';
            ws.appendChild(el);
            if (extra.streamHost) _startVideoStream(el);
        } else {
            var ahExtra = {};
            if (ind.type === 'alarmHistoryIndicator') {
                try { ahExtra = JSON.parse(ind.extra_data || '{}'); } catch (e) { console.warn('extra_data parse error', e); }
            }
            var config = {
                paramId:     ind.param_id,
                paramName:   ind.param_name || '',
                width:       ind.width  != null ? Math.round(ind.width  * wsW / 100) : null,
                height:      ind.height != null ? Math.round(ind.height * wsH / 100) : null,
                headerText:  ind.header_text,
                headerColor: ind.header_color,
                headerBg:    ind.header_bg,
                headerFont:  ind.header_font,
                headerSize:  ind.header_size,
                format:      ind.format,
                valueColor:  ind.value_color,
                valueBg:     ind.value_bg,
                valueFont:   ind.value_font,
                valueSize:   ind.value_size,
                rangeMin:    ind.range_min,
                rangeMax:    ind.range_max,
                alarmMin:    ind.alarm_min,
                alarmMax:    ind.alarm_max,
                alarmEnabled: ind.alarm_enabled ? true : false,
                alarmColor:   ind.alarm_color  || '#ff0000',
                units:          ind.units          || '',
                zoneColors:     ind.zone_colors    ? true : false,
                tickerSpeed:    ind.ticker_speed   != null ? ind.ticker_speed   : 12,
                valueBgOpacity: ind.value_bg_opacity != null ? ind.value_bg_opacity : 0,
                showTrigger: ahExtra.showTrigger !== false,
                showClear:   ahExtra.showClear   !== false,
                showAck:     ahExtra.showAck     !== false
            };
            el = _addIndicator(ind.type || 'digitalIndicator', config, left, top);
            ws.appendChild(el);
        }

        // Clamp position to visible canvas area (fixes cross-resolution overflow)
        var scale = window._wsScale  || 1;
        var ox    = window._wsOffsetX || 0;
        var oy    = window._wsOffsetY || 0;
        var iw    = el.offsetWidth;
        var ih    = el.offsetHeight;
        var minX  = Math.max(0, Math.ceil(-ox / scale));
        var minY  = Math.max(0, Math.ceil(-oy / scale));
        var maxX  = Math.min(ws.clientWidth  - iw, Math.floor((window.innerWidth  - ox) / scale) - iw);
        var maxY  = Math.min(ws.clientHeight - ih, Math.floor((window.innerHeight - oy) / scale) - ih);
        el.style.left = Math.min(Math.max(left, minX), maxX) + 'px';
        el.style.top  = Math.min(Math.max(top,  minY), maxY) + 'px';
    });
}

/// Индикатор показывает время самой записи, а не значение параметра
function _usesGlobalTime(el) {
    var def = _indicatorTypes[_getIndicatorType(el)];
    return !!(def && def.usesGlobalTime);
}

var _loadSeq = 0;

function _loadIndicatorsForProfile(profileId) {
    // Токен против гонки: при быстром переключении профилей поздний ответ
    // старого профиля не должен затирать индикаторы нового
    var seq = ++_loadSeq;
    $.when(
        $.getJSON('/api/profiles/' + profileId + '/indicators'),
        _loadFonts()
    ).then(function(indicatorsResp) {
        if (seq !== _loadSeq) return;
        _restoreIndicators(indicatorsResp[0]);
    }).fail(function () {
        if (seq !== _loadSeq) return;
        showError('Ошибка загрузки индикаторов');
    });
}

// Активный профиль при загрузке страницы: раскладку задаёт Loader, табло её
// только применяет
$.getJSON('/api/profiles/active', function (profile) {
    if (!profile) return;
    applyProfileFromSSE(profile);
    _loadIndicatorsForProfile(profile.id);
}).fail(function () { showError('Ошибка загрузки профиля'); });

// ── Data loss banner ──────────────────────────────────────────────────────────

function _showDataBanner(msg) {
    var el  = document.getElementById('dataBanner');
    var txt = document.getElementById('dataBannerText');
    if (!el || !txt) return;
    txt.textContent = msg;
    el.classList.add('visible');
}

function _hideDataBanner() {
    var el = document.getElementById('dataBanner');
    if (el) el.classList.remove('visible');
}

// ── Заставка обновления ───────────────────────────────────────────────────────
//
// Пакет новой версии по линии RS-485 едет минутами. Без заставки это выглядит
// как обрыв связи: показания замерли, баннер говорит «нет данных». Пока она
// поднята, показания не трогаем — их и не присылают.

var _updateActive = false;

function _applyUpdateState(s) {
    var el = document.getElementById('updateOverlay');
    if (!el) return;

    _updateActive = !!(s && s.active);
    if (!_updateActive) {
        el.classList.remove('visible', 'unpacking');
        return;
    }

    var unpacking = s.phase === 'unpacking';
    el.classList.add('visible');
    el.classList.toggle('unpacking', unpacking);

    document.getElementById('updVersion').textContent =
        s.version ? 'версия ' + s.version : (s.name || '');
    document.getElementById('updPhase').textContent =
        unpacking ? 'распаковка и перезагрузка' : 'приём пакета';

    var fill = document.getElementById('updFill');
    if (!unpacking) fill.style.width = (s.percent || 0) + '%';

    var count = document.getElementById('updCount');
    count.textContent = unpacking ? ''
        : (s.percent || 0) + '%' + (s.size ? ' · ' + Math.round(s.size / 1024) + ' КБ' : '');

    // Поверх заставки баннер «нет данных» не нужен: данных и не должно быть
    _hideDataBanner();
}

// Listen for profile activation from other clients
(function () {
    var evtSource = new EventSource('/api/events');

    evtSource.addEventListener('workspace-saved', function (e) {
        var profile = JSON.parse(e.data);
        applyProfileFromSSE(profile);
        _loadIndicatorsForProfile(profile.id);
    });

    evtSource.addEventListener('board-settings', function (e) {
        var s = JSON.parse(e.data);
        if (window.setBoardTimezone) window.setBoardTimezone(s.timezone);
    });

    evtSource.addEventListener('profile-selected', function (e) {
        var profile = JSON.parse(e.data);
        applyProfileFromSSE(profile);
        _loadIndicatorsForProfile(profile.id);
    });

    evtSource.addEventListener('update-state', function (e) {
        _applyUpdateState(JSON.parse(e.data));
    });

    evtSource.addEventListener('run-state', function (e) {
        var data = JSON.parse(e.data);
        // Идёт обновление — поток и должен стоять, объяснять это баннером незачем
        if (_updateActive) return;
        if (!data.running) {
            document.querySelectorAll('.indicator').forEach(function (el) {
                if (window.setIndicatorValue) setIndicatorValue(el, null);
            });
            // Баннер поднимаем всегда: причина приходит не в каждом состоянии
            // (табло ещё ни разу не получало данных — её просто нет), а экран
            // в прочерках без единого слова объяснения хуже неточного текста.
            // 'network' — сервер не получает пакеты от Loader (TCP/IP или RS-485);
            // любая другая причина приходит текстом от самого Loader
            var msg = (!data.reason || data.reason === 'network')
                ? 'Нет данных от BCS_DrillerMonitorLoader'
                : 'Передача остановлена: ' + data.reason;
            _showDataBanner(msg);
        } else {
            _hideDataBanner();
        }
    });

    evtSource.addEventListener('drill-data', function (e) {
        var record = JSON.parse(e.data);
        var params = record.params;
        Object.keys(params).forEach(function (id) {
            document.querySelectorAll('.indicator[data-param-id="' + id + '"]')
                .forEach(function (el) {
                    // Часы и дата идут от времени записи, а не от параметра:
                    // источник может писать в свой «временной» слот что угодно
                    if (_usesGlobalTime(el)) return;
                    setIndicatorValue(el, params[id]);
                });
        });
        if (record.time) {
            document.querySelectorAll('.timeIndicator, .dateIndicator')
                .forEach(function (el) { setIndicatorValue(el, record.time); });
        }
    });

    evtSource.onerror = function () {
        evtSource.close();
        document.querySelectorAll('.indicator').forEach(function (el) {
            if (window.setIndicatorValue) setIndicatorValue(el, null);
        });
        // Обновление перезагружает устройство — киоск поднимется этим же циклом
        setTimeout(function () { window.location.reload(); }, 3000);
    };
})();
