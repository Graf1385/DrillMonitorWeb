// Constants and helpers live in indicatorHelpers.js (loaded before this file).
// Indicator type registry lives in indicatorTypes.js (loaded before this file).

function _isSidebarOpen() {
    var sb = document.querySelector('#sideBar');
    return sb && sb.classList.contains('open');
}

var _addModal      = document.querySelector('#newItemModal');
var _activeType    = 'digitalIndicator';
var _editingEl     = null;
var _fontsPromise  = null;

// Init combos for the 2 selects that are always in the DOM
['#ni_headerFont', '#ni_valueFont'].forEach(function (id) {
    initCombo(_addModal.querySelector(id));
});

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

function ctxAckAlarm() {
    _ctxMenu.classList.remove('visible');
    if (!_ctxTarget) return;
    var el = _ctxTarget;
    _ctxTarget = null;
    if (!el._alarmActive || el._alarmAcked) return;
    el._alarmAcked = true;
    el.classList.remove('alarm-active');
    el.classList.add('alarm-acked');
    _addAlarmLogEntry(el, el._currentValue, 'ack');
    if (!_hasUnackedAlarm()) { _stopAlarmSound(); }
}

// ── Font loading ──────────────────────────────────────────────────────────────

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
        ['#ni_headerFont', '#ni_valueFont'].forEach(function (selId) {
            var sel = _addModal.querySelector(selId);
            fonts.forEach(function (f) {
                var opt = document.createElement('option');
                opt.value       = f.id;
                opt.textContent = f.name;
                sel.appendChild(opt);
            });
        });
        ['#ah_headerFont', '#ah_contentFont'].forEach(function (selId) {
            var sel = document.querySelector(selId);
            if (!sel) return;
            fonts.forEach(function (f) {
                var opt = document.createElement('option');
                opt.value       = f.id;
                opt.textContent = f.name;
                sel.appendChild(opt);
            });
        });
    }, function () {
        showError('Ошибка загрузки шрифтов');
        _fontsPromise = null;
    });
    return _fontsPromise;
}

var _availableUnits  = [];
var _availableParams = [];

function _loadUnits() {
    return $.getJSON('/api/units').then(function (units) {
        _availableUnits = units;
    }, function () {
        showError('Ошибка загрузки единиц измерения');
    });
}

window.openParamDropdown = function(input) {
    var dropdown = _addModal.querySelector('#ni_paramDropdown');
    if (!dropdown) return;
    input.dataset.paramId = '';
    var q = input.value.toLowerCase();
    var filtered = _availableParams.filter(function (p) {
        return q === '' || p.name.toLowerCase().indexOf(q) !== -1;
    });
    if (filtered.length === 0) { dropdown.classList.remove('open'); return; }
    dropdown.innerHTML = filtered.map(function (p) {
        return '<div class="unitComboOption" onmousedown="_selectParam(' + p.id + ')">' + p.name + '</div>';
    }).join('');
    dropdown.classList.add('open');
};

window._selectParam = function(id) {
    var p = _availableParams.find(function(x) { return x.id === id; });
    if (!p) return;
    var input = _addModal.querySelector('#ni_paramId');
    input.value = p.name;
    input.dataset.paramId = String(p.id);
    _addModal.querySelector('#ni_paramDropdown').classList.remove('open');
    _toggleValueFields(true);
    _addModal.querySelector('#ni_headerText').value = p.name;
    _addModal.querySelector('#ni_format').value     = p.default_format || '';
    _addModal.querySelector('#ni_units').value      = p.units || '';
};

window.closeParamDropdown = function() {
    setTimeout(function () {
        var dropdown = _addModal.querySelector('#ni_paramDropdown');
        if (dropdown) dropdown.classList.remove('open');
    }, 150);
};

window.openUnitsDropdown = function(input) {
    var dropdown = _addModal.querySelector('#ni_unitsDropdown');
    if (!dropdown) return;
    var q = input.value.toLowerCase();
    var filtered = _availableUnits.filter(function (u) {
        return q === '' || u.symbol.toLowerCase().indexOf(q) !== -1 || u.name.toLowerCase().indexOf(q) !== -1;
    });
    if (filtered.length === 0) { dropdown.classList.remove('open'); return; }
    dropdown.innerHTML = filtered.map(function (u) {
        var sym = u.symbol.replace(/'/g, '\\\'');
        return '<div class="unitComboOption" onmousedown="selectUnit(\'' + sym + '\')">' +
               '<b>' + u.symbol + '</b> — ' + u.name + '</div>';
    }).join('');
    dropdown.classList.add('open');
};

window.selectUnit = function(symbol) {
    _addModal.querySelector('#ni_units').value = symbol;
    _addModal.querySelector('#ni_unitsDropdown').classList.remove('open');
};

window.closeUnitsDropdown = function() {
    setTimeout(function () {
        var dropdown = _addModal.querySelector('#ni_unitsDropdown');
        if (dropdown) dropdown.classList.remove('open');
    }, 150);
};

// ── Context menu ──────────────────────────────────────────────────────────────

var _ctxMenu   = document.querySelector('#indicatorContextMenu');
var _ctxTarget = null;

function _showCtxMenu(indicator, x, y) {
    _ctxTarget = indicator;
    var isVideo   = indicator.classList.contains('videoIndicator');
    var isHistory = indicator.classList.contains('alarmHistoryIndicator');
    var ackBtn     = _ctxMenu.querySelector('#ctxAckBtn');
    var testBtn    = _ctxMenu.querySelector('#ctxTestBtn');
    var settingsBtn= _ctxMenu.querySelector('#ctxSettingsBtn');
    if (ackBtn)      ackBtn.style.display      = (!isVideo && !isHistory && indicator._alarmActive && !indicator._alarmAcked) ? '' : 'none';
    if (testBtn)     testBtn.style.display     = (isVideo || isHistory) ? 'none' : '';
    if (settingsBtn) settingsBtn.style.display = '';
    var menuW = _ctxMenu.offsetWidth  || 190;
    var menuH = _ctxMenu.offsetHeight || 80;
    if (x + menuW > window.innerWidth)  x = window.innerWidth  - menuW - 4;
    if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 4;
    _ctxMenu.style.left = x + 'px';
    _ctxMenu.style.top  = y + 'px';
    _ctxMenu.classList.add('visible');
}

window.showIndicatorCtxMenu = function(indicator, x, y) { _showCtxMenu(indicator, x, y); };

document.addEventListener('contextmenu', function (e) {
    var indicator = e.target.closest('.indicator');
    if (!indicator) return;
    if (!_isSidebarOpen()) return;
    e.preventDefault();
    _showCtxMenu(indicator, e.clientX, e.clientY);
});

document.addEventListener('mousedown', function (e) {
    if (!_ctxMenu.contains(e.target)) {
        _ctxMenu.classList.remove('visible');
        _ctxTarget = null;
    }
}, true);

document.addEventListener('scroll', function () {
    _ctxMenu.classList.remove('visible');
    _ctxTarget = null;
}, true);

function ctxOpenValueSettings() {
    _ctxMenu.classList.remove('visible');
    if (!_ctxTarget) return;
    var t = _ctxTarget;
    _ctxTarget = null;
    if (t.classList.contains('alarmHistoryIndicator')) {
        openAhSettings(t);
    } else {
        _openEditModal(t);
    }
}

var _deleteTarget = null;

// ── Alarm History Settings ────────────────────────────────────────────────────

var _ahModal  = null;
var _ahTarget = null;

function openAhSettings(indicator) {
    if (!_ahModal) _ahModal = document.querySelector('#ahSettingsModal');
    _ahTarget = indicator;
    var d = indicator.dataset;
    _loadFonts().then(function () {
        _ahModal.querySelector('#ah_headerFont').value  = parseInt(d.headerFont) || 0;
        _ahModal.querySelector('#ah_headerSize').value  = parseInt(d.headerSize) || 13;
        _ahModal.querySelector('#ah_contentFont').value = parseInt(d.valueFont)  || 0;
        _ahModal.querySelector('#ah_contentSize').value = parseInt(d.valueSize)  || 12;
        _ahModal.querySelector('#ah_showTrigger').checked = d.ahShowTrigger !== '0';
        _ahModal.querySelector('#ah_showClear').checked   = d.ahShowClear   !== '0';
        _ahModal.querySelector('#ah_showAck').checked     = d.ahShowAck     !== '0';
        _ahModal.showModal();
    });
}

function submitAhSettings() {
    if (!_ahModal) return;
    var hFont       = parseInt(_ahModal.querySelector('#ah_headerFont').value) || 0;
    var hSize       = parseInt(_ahModal.querySelector('#ah_headerSize').value) || 13;
    var cFont       = parseInt(_ahModal.querySelector('#ah_contentFont').value) || 0;
    var cSize       = parseInt(_ahModal.querySelector('#ah_contentSize').value) || 12;
    var showTrigger = _ahModal.querySelector('#ah_showTrigger').checked;
    var showClear   = _ahModal.querySelector('#ah_showClear').checked;
    var showAck     = _ahModal.querySelector('#ah_showAck').checked;
    _ahModal.close();
    if (!_ahTarget) return;
    Object.assign(_ahTarget.dataset, {
        headerFont:   hFont,
        headerSize:   hSize,
        valueFont:    cFont,
        valueSize:    cSize,
        ahShowTrigger: showTrigger ? '1' : '0',
        ahShowClear:   showClear   ? '1' : '0',
        ahShowAck:     showAck     ? '1' : '0'
    });
    _indicatorTypes.alarmHistoryIndicator.applyEdit(_ahTarget, {
        headerFont: hFont, headerSize: hSize,
        valueFont:  cFont, valueSize:  cSize,
        showTrigger: showTrigger, showClear: showClear, showAck: showAck
    });
    _ahTarget = null;
    showSaveBtn();
}

function ctxDeleteIndicator() {
    _ctxMenu.classList.remove('visible');
    if (!_ctxTarget) return;
    _deleteTarget = _ctxTarget;
    _ctxTarget = null;
    document.querySelector('#deleteConfirmModal').showModal();
}

function confirmDeleteIndicator() {
    document.querySelector('#deleteConfirmModal').close();
    if (!_deleteTarget) return;
    if (_deleteTarget.classList.contains('videoIndicator')) _stopVideoStream(_deleteTarget);
    if (_deleteTarget._tickerObserver) _deleteTarget._tickerObserver.disconnect();
    if (_deleteTarget._alarmObserver)  _deleteTarget._alarmObserver.disconnect();
    if (_deleteTarget._alarmOverlay)   _deleteTarget._alarmOverlay.remove();
    _deleteTarget.remove();
    _deleteTarget = null;
    showSaveBtn();
}

var _testTarget = null;

function ctxTestIndicator() {
    _ctxMenu.classList.remove('visible');
    if (!_ctxTarget) return;
    _testTarget = _ctxTarget;
    _ctxTarget  = null;

    var r   = _parseRange(_testTarget.dataset);
    var min = r.min, max = r.max;
    var cur = _testTarget._currentValue !== undefined ? _testTarget._currentValue : min;

    var modal = document.querySelector('#testIndicatorModal');
    var range = modal.querySelector('#testRange');
    var num   = modal.querySelector('#testNum');

    range.min = min; range.max = max; range.step = (max - min) / 100;
    num.min   = min; num.max   = max;
    range.value = cur;
    num.value   = cur;

    modal.showModal();
}

function onTestRangeInput(val) {
    if (!_testTarget) return;
    document.querySelector('#testNum').value = parseFloat(val).toFixed(2);
    setIndicatorValue(_testTarget, parseFloat(val));
}

function onTestNumInput(val) {
    if (!_testTarget) return;
    document.querySelector('#testRange').value = val;
    setIndicatorValue(_testTarget, parseFloat(val));
}

function closeTestModal() {
    document.querySelector('#testIndicatorModal').close();
    _testTarget = null;
}

// ── Font helpers ──────────────────────────────────────────────────────────────

// ── Drag / resize ─────────────────────────────────────────────────────────────

var _drag   = { el: null, startX: 0, startY: 0, origLeft: 0, origTop: 0 };
var _resize = { el: null, initW: 0, initH: 0 };

document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (!_isSidebarOpen()) return;

    var header = e.target.closest('.indicatorHeader');
    if (header) {
        var indicator = header.closest('.indicator');
        if (!indicator) return;
        e.preventDefault();
        _drag.el       = indicator;
        _drag.startX   = e.clientX;
        _drag.startY   = e.clientY;
        _drag.origLeft = indicator.offsetLeft;
        _drag.origTop  = indicator.offsetTop;
        indicator.style.cursor = 'grabbing';
        return;
    }

    var indicator = e.target.closest('.indicator');
    if (indicator) {
        _resize.el    = indicator;
        _resize.initW = indicator.offsetWidth;
        _resize.initH = indicator.offsetHeight;
    }
});

document.addEventListener('mousemove', function (e) {
    if (!_drag.el) return;
    var scale = window._wsScale  || 1;
    var ox    = window._wsOffsetX || 0;
    var oy    = window._wsOffsetY || 0;
    var ws    = _wsCanvas;
    var iw    = _drag.el.offsetWidth;
    var ih    = _drag.el.offsetHeight;
    // Clamp to the visible screen area within canvas coordinates
    var minX = Math.max(0, Math.ceil(-ox / scale));
    var minY = Math.max(0, Math.ceil(-oy / scale));
    var maxX = Math.min(ws.clientWidth  - iw, Math.floor((window.innerWidth  - ox) / scale) - iw);
    var maxY = Math.min(ws.clientHeight - ih, Math.floor((window.innerHeight - oy) / scale) - ih);
    var newX = Math.min(Math.max(minX, _drag.origLeft + (e.clientX - _drag.startX) / scale), maxX);
    var newY = Math.min(Math.max(minY, _drag.origTop  + (e.clientY - _drag.startY) / scale), maxY);
    _drag.el.style.left = newX + 'px';
    _drag.el.style.top  = newY + 'px';
});

document.addEventListener('mouseup', function () {
    var cellSize = _gridActive ? (parseInt(_wsCanvas.dataset.cellSize) || 20) : 0;

    if (_drag.el) {
        if (cellSize) {
            _drag.el.style.left = Math.round(_drag.el.offsetLeft / cellSize) * cellSize + 'px';
            _drag.el.style.top  = Math.round(_drag.el.offsetTop  / cellSize) * cellSize + 'px';
        }
        _drag.el.style.cursor = '';
        _drag.el = null;
        showSaveBtn();
    }

    if (_resize.el) {
        var sizeChanged = _resize.el.offsetWidth  !== _resize.initW ||
                          _resize.el.offsetHeight !== _resize.initH;
        if (sizeChanged) showSaveBtn();
        if (cellSize && sizeChanged) {
            var el     = _resize.el;
            var bW     = el.offsetWidth  - el.clientWidth;
            var bH     = el.offsetHeight - el.clientHeight;
            var left   = el.offsetLeft;
            var top    = el.offsetTop;
            var right  = left + el.offsetWidth;
            var bottom = top  + el.offsetHeight;
            el.style.width  = (Math.round(right  / cellSize) * cellSize - left - bW) + 'px';
            el.style.height = (Math.round(bottom / cellSize) * cellSize - top  - bH) + 'px';
        }
        _resize.el.dataset.width  = parseInt(_resize.el.style.width)  || _resize.el.offsetWidth;
        _resize.el.dataset.height = parseInt(_resize.el.style.height) || _resize.el.offsetHeight;
        _resize.el = null;
    }
});

document.addEventListener('dblclick', function (e) {
    var indicator = e.target.closest('.indicator');
    if (!indicator) return;
    if (!_isSidebarOpen()) return;
    _openEditModal(indicator);
});

// ── Modal: show / hide ────────────────────────────────────────────────────────

function _loadParameters(selectedId) {
    return $.getJSON('/api/parameters').then(function (params) {
        _availableParams = params;
        var input = _addModal.querySelector('#ni_paramId');
        input.value = '';
        input.dataset.paramId = '';
        if (selectedId !== undefined && selectedId !== null && selectedId !== '') {
            var found = params.find(function(p) { return p.id === parseInt(selectedId); });
            if (found) {
                input.value = found.name;
                input.dataset.paramId = String(found.id);
            }
        }
    }, function () {
        showError('Ошибка загрузки параметров');
    });
}

function _applyTypeToParamSelect(type) {
    var typeDef     = _indicatorTypes[type] || _indicatorTypes.digitalIndicator;
    var input       = _addModal.querySelector('#ni_paramId');
    var paramRow    = _addModal.querySelector('#ni_paramRow');
    var numericRows = _addModal.querySelectorAll('.numericOnlyRow');
    var zoneRows    = _addModal.querySelectorAll('.zoneColorRow');
    var tickerRows  = _addModal.querySelectorAll('.tickerOnlyRow');

    var zoneTypes   = { digitalIndicator: true, hProgressIndicator: true, vProgressIndicator: true };
    var headerInput = _addModal.querySelector('#ni_headerText');

    function _setParamInputDisabled(disabled) {
        input.disabled = disabled;
        if (disabled) {
            var drop = _addModal.querySelector('#ni_paramDropdown');
            if (drop) drop.classList.remove('open');
        }
    }

    function _setParamById(id) {
        var p = _availableParams.find(function(x) { return x.id === id; });
        if (p) { input.value = p.name; input.dataset.paramId = String(p.id); }
    }

    function _setParamByType(preferType) {
        var p = _availableParams.find(function(x) { return x.type_name === preferType; })
             || _availableParams.find(function(x) { return x.type_name === 'time'; });
        if (p) { input.value = p.name; input.dataset.paramId = String(p.id); }
    }

    if (typeDef.fixedParamId != null) {
        if (paramRow) paramRow.style.display = '';
        _setParamById(typeDef.fixedParamId);
        _setParamInputDisabled(true);
        numericRows.forEach(function (r) { r.style.display = 'none'; });
        if (headerInput && typeDef.fixedHeader) {
            headerInput.value    = typeDef.fixedHeader;
            headerInput.disabled = true;
        }
    } else if (typeDef.usesGlobalTime) {
        if (paramRow) paramRow.style.display = 'none';
        input.value = '';
        input.dataset.paramId = '';
        _setParamInputDisabled(true);
        if (headerInput) headerInput.disabled = false;
        numericRows.forEach(function (r) { r.style.display = 'none'; });
    } else if (!typeDef.isNumeric) {
        if (paramRow) paramRow.style.display = '';
        if (typeDef.lockParam !== false) {
            _setParamByType(typeDef.preferredParamType || 'time');
            _setParamInputDisabled(true);
        } else {
            _setParamInputDisabled(false);
        }
        if (headerInput) headerInput.disabled = false;
        numericRows.forEach(function (r) { r.style.display = 'none'; });
    } else {
        if (paramRow) paramRow.style.display = '';
        _setParamInputDisabled(false);
        if (headerInput) headerInput.disabled = false;
        numericRows.forEach(function (r) { r.style.display = ''; });
    }

    zoneRows.forEach(function (r) {
        r.style.display = zoneTypes[type] ? '' : 'none';
    });
    tickerRows.forEach(function (r) {
        r.style.display = type === 'tickerIndicator' ? '' : 'none';
    });
}

function showNewItems() {
    _editingEl = null;
    _addModal.querySelector('h1').textContent = 'Добавить элемент';
    _addModal.querySelector('.okBtn').textContent = 'Добавить';
    _addModal.querySelector('#itemTypeList').style.display = '';
    _addModal.querySelector('#ni_settingsBody').style.display = 'none';
    _resetModalDefaults();
    selectItemType(_activeType);
    $.when(_loadParameters(), _loadFonts(), _loadUnits()).then(function () {
        _applyTypeToParamSelect(_activeType);
        _addModal.showModal();
    });
}

window.openEditModal = function(indicator) { _openEditModal(indicator); };

function _openEditModal(indicator) {
    if (indicator.classList.contains('videoIndicator')) {
        openVideoSettings(indicator);
        return;
    }
    if (indicator.classList.contains('alarmHistoryIndicator')) { openAhSettings(indicator); return; }
    _editingEl = indicator;
    _addModal.querySelector('h1').textContent = 'Настройки индикатора';
    _addModal.querySelector('.okBtn').textContent = 'Применить';
    _addModal.querySelector('#itemTypeList').style.display = 'none';
    _addModal.querySelector('#ni_settingsBody').style.display = '';

    var indType = _getIndicatorType(indicator);
    var d = indicator.dataset;
    $.when(_loadParameters(d.paramId || ''), _loadFonts(), _loadUnits()).then(function () {
        _applyTypeToParamSelect(indType);
        _addModal.showModal();
    });
    _addModal.querySelector('#ni_width').value   = d.width  || indicator.offsetWidth  || '';
    _addModal.querySelector('#ni_height').value  = d.height || indicator.offsetHeight || '';
    _addModal.querySelector('#ni_headerText').value  = d.headerText  || '';
    _addModal.querySelector('#ni_headerColor').value = d.headerColor || '#c9d1d9';
    _addModal.querySelector('#ni_headerBg').value    = d.headerBg    || '#161b22';
    _addModal.querySelector('#ni_headerFont').value  = parseInt(d.headerFont) || 0;
    _addModal.querySelector('#ni_headerSize').value  = d.headerSize  || 14;
    _addModal.querySelector('#ni_format').value      = d.format      || '';
    _addModal.querySelector('#ni_valueFont').value   = parseInt(d.valueFont)  || 0;
    _addModal.querySelector('#ni_valueSize').value   = d.valueSize   || 48;
    _addModal.querySelector('#ni_valueColor').value  = d.valueColor  || '#38bdf8';
    _addModal.querySelector('#ni_valueBg').value     = d.valueBg     || '#0d1117';
    _addModal.querySelector('#ni_rangeMin').value       = d.rangeMin    || '';
    _addModal.querySelector('#ni_rangeMax').value       = d.rangeMax    || '';
    var alarmOn = d.alarmEnabled === '1';
    _addModal.querySelector('#ni_alarmEnabled').checked = alarmOn;
    _addModal.querySelector('#ni_alarmMin').value       = d.alarmMin   || '';
    _addModal.querySelector('#ni_alarmMax').value       = d.alarmMax   || '';
    _addModal.querySelector('#ni_alarmColor').value     = d.alarmColor || '#ff0000';
    _addModal.querySelector('#ni_units').value          = d.units || '';
    _addModal.querySelector('#ni_zoneColors').checked   = d.zoneColors === '1';
    _addModal.querySelector('#ni_tickerSpeed').value    = d.tickerSpeed || 12;
    var opVal = parseFloat(d.valueBgOpacity);
    if (isNaN(opVal)) opVal = 0;
    _addModal.querySelector('#ni_valueBgOpacity').value = opVal;
    _addModal.querySelector('#ni_opacityVal').textContent = Math.round(opVal * 100) + '%';
    _toggleValueFields(!!(d.paramId));
}


function _toggleValueFields(enabled) {
    ['#ni_format', '#ni_rangeMin', '#ni_rangeMax',
     '#ni_valueFont', '#ni_valueSize', '#ni_valueColor', '#ni_valueBg',
     '#ni_alarmEnabled', '#ni_alarmColor'].forEach(function (id) {
        var el = _addModal.querySelector(id);
        if (el) el.disabled = !enabled;
    });
    if (!enabled) {
        toggleAlarmFields(false);
    } else {
        toggleAlarmFields(_addModal.querySelector('#ni_alarmEnabled').checked);
    }
}

function toggleAlarmFields(enabled) {
    _addModal.querySelector('#ni_alarmMin').disabled   = !enabled;
    _addModal.querySelector('#ni_alarmMax').disabled   = !enabled;
    _addModal.querySelector('#ni_alarmColor').disabled = !enabled;
}

function closeAddItemModal() {
    _addModal.close();
    _editingEl = null;
}

function _refreshIndicatorListIfOpen() {
    var ilModal = document.querySelector('#indicatorListModal');
    if (ilModal && ilModal.open && typeof showIndicatorList === 'function') showIndicatorList();
}

function _resetModalDefaults() {
    _addModal.querySelector('#ni_width').value       = '';
    _addModal.querySelector('#ni_height').value      = '';
    _addModal.querySelector('#ni_headerText').value  = 'Заголовок';
    _addModal.querySelector('#ni_headerColor').value = '#c9d1d9';
    _addModal.querySelector('#ni_headerBg').value    = '#161b22';
    _addModal.querySelector('#ni_headerFont').value  = 0;
    _addModal.querySelector('#ni_headerSize').value  = 17;
    _addModal.querySelector('#ni_format').value      = '';
    _addModal.querySelector('#ni_valueFont').value   = 0;
    _addModal.querySelector('#ni_valueSize').value   = 25;
    _addModal.querySelector('#ni_valueColor').value  = '#38bdf8';
    _addModal.querySelector('#ni_valueBg').value     = '#0d1117';
    _addModal.querySelector('#ni_rangeMin').value      = 0;
    _addModal.querySelector('#ni_rangeMax').value      = 100;
    _addModal.querySelector('#ni_alarmEnabled').checked = false;
    _addModal.querySelector('#ni_alarmMin').value       = '';
    _addModal.querySelector('#ni_alarmMax').value       = '';
    _addModal.querySelector('#ni_alarmColor').value     = '#ff0000';
    _addModal.querySelector('#ni_units').value          = '';
    _addModal.querySelector('#ni_zoneColors').checked   = false;
    _addModal.querySelector('#ni_tickerSpeed').value    = 12;
    _addModal.querySelector('#ni_valueBgOpacity').value = 0;
    _addModal.querySelector('#ni_opacityVal').textContent = '0%';
    _toggleValueFields(false);
}

function selectItemType(type) {
    _activeType = type;
    _addModal.querySelectorAll('.itemTypeCard').forEach(function (c) {
        c.classList.remove('selected');
    });
    var typeDef = _indicatorTypes[type];
    if (typeDef && typeDef.cardId) document.querySelector(typeDef.cardId).classList.add('selected');
    _applyTypeToParamSelect(type);
    if (typeDef) {
        var def = typeDef.defaultSize || {};
        if (def.width)  _addModal.querySelector('#ni_width').value  = def.width;
        if (def.height) _addModal.querySelector('#ni_height').value = def.height;
        if (!def.width)  _addModal.querySelector('#ni_width').value  = '';
        if (!def.height) _addModal.querySelector('#ni_height').value = '';
        _addModal.querySelector('#ni_valueSize').value = typeDef.defaultValueSize || 25;
    }
}

// ── Config read ───────────────────────────────────────────────────────────────

function _readConfig() {
    function clamp(val, min, max) { return Math.min(max, Math.max(min, parseInt(val) || min)); }
    function nullable(val) { var n = parseFloat(val); return isNaN(n) ? null : n; }
    var wRaw = parseInt(_addModal.querySelector('#ni_width').value);
    var hRaw = parseInt(_addModal.querySelector('#ni_height').value);
    var paramInput = _addModal.querySelector('#ni_paramId');
    var paramRaw   = paramInput.dataset.paramId || '';
    return {
        paramId:     paramRaw !== '' ? parseInt(paramRaw) : null,
        paramName:   paramRaw !== '' ? paramInput.value.trim() : '',
        width:       isNaN(wRaw) ? null : Math.min(2000, Math.max(40, wRaw)),
        height:      isNaN(hRaw) ? null : Math.min(2000, Math.max(40, hRaw)),
        headerText:  _addModal.querySelector('#ni_headerText').value || 'Заголовок',
        headerColor: _addModal.querySelector('#ni_headerColor').value,
        headerBg:    _addModal.querySelector('#ni_headerBg').value,
        headerFont:  parseInt(_addModal.querySelector('#ni_headerFont').value) || 0,
        headerSize:  clamp(_addModal.querySelector('#ni_headerSize').value, 1, 200),
        format:      _addModal.querySelector('#ni_format').value,
        valueFont:   parseInt(_addModal.querySelector('#ni_valueFont').value) || 0,
        valueSize:   clamp(_addModal.querySelector('#ni_valueSize').value, 1, 400),
        valueColor:  _addModal.querySelector('#ni_valueColor').value,
        valueBg:     _addModal.querySelector('#ni_valueBg').value,
        rangeMin:     nullable(_addModal.querySelector('#ni_rangeMin').value),
        rangeMax:     nullable(_addModal.querySelector('#ni_rangeMax').value),
        alarmEnabled: _addModal.querySelector('#ni_alarmEnabled').checked,
        alarmMin:     nullable(_addModal.querySelector('#ni_alarmMin').value),
        alarmMax:     nullable(_addModal.querySelector('#ni_alarmMax').value),
        alarmColor:   _addModal.querySelector('#ni_alarmColor').value,
        units:          _addModal.querySelector('#ni_units').value.trim(),
        zoneColors:     _addModal.querySelector('#ni_zoneColors').checked,
        tickerSpeed:    parseFloat(_addModal.querySelector('#ni_tickerSpeed').value) || 12,
        valueBgOpacity: parseFloat(_addModal.querySelector('#ni_valueBgOpacity').value)
    };
}

// ── setIndicatorValue ─────────────────────────────────────────────────────────

function setIndicatorValue(el, val) {
    var type    = _getIndicatorType(el);
    var typeDef = _indicatorTypes[type] || _indicatorTypes.digitalIndicator;

    if (!typeDef.isNumeric) {
        if (typeDef.setValue) typeDef.setValue(el, val);
        return;
    }

    var r = _parseRange(el.dataset);
    el._currentValue = Math.max(r.min, Math.min(r.max, isNaN(+val) ? r.min : +val));
    var zc = _getZoneColor(el, el._currentValue);

    if (typeDef.setValue) typeDef.setValue(el, el._currentValue, zc);
    _checkAlarm(el, el._currentValue);
}

// ── Indicator factory ─────────────────────────────────────────────────────────

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
    el.id        = 'item_' + Date.now();
    el.style.left        = left + 'px';
    el.style.top         = top  + 'px';
    el.style.borderColor = cfg.valueColor;
    el.style.setProperty('--value-color', cfg.valueColor);
    _applySize(el, cfg);
    _storeConfig(el, cfg);
    el._currentValue = 0;

    var header = document.createElement('div');
    header.className = 'indicatorHeader';
    _applyToHeader(header, cfg);
    el.appendChild(header);

    typeDef.create(el, cfg);
    if (typeDef.isNumeric) setIndicatorValue(el, 0);
    return el;
}

// ── Add / apply ───────────────────────────────────────────────────────────────

function addNewItem() {
    if (!_editingEl && _activeType === 'videoIndicator') {
        _addModal.close();
        showNewVideoItem();
        return;
    }

    var config;
    try { config = _readConfig(); } catch(err) { showError('Ошибка чтения настроек: ' + err.message); return; }

    if (_editingEl) {
        var typeDef = _indicatorTypes[_getIndicatorType(_editingEl)] || _indicatorTypes.digitalIndicator;
        _editingEl.style.borderColor = config.valueColor;
        _editingEl.style.setProperty('--value-color', config.valueColor);
        _applySize(_editingEl, config);
        _storeConfig(_editingEl, config);
        _applyToHeader(_editingEl.querySelector('.indicatorHeader'), config);
        typeDef.applyEdit(_editingEl, config);
        showSaveBtn();
        _refreshIndicatorListIfOpen();

    } else {
        var ws   = document.querySelector('#wsCanvas');
        var left = Math.max(20, Math.round(ws.clientWidth  / 2 - 80));
        var top  = Math.max(20, Math.round(ws.clientHeight / 2 - 60));
        ws.appendChild(_addIndicator(_activeType, config, left, top));
        showSaveBtn();
    }

    _addModal.close();
    _editingEl = null;
}

function removeItem() {
    var ws   = document.querySelector('#workSpace');
    var last = ws.querySelector('.indicator:last-child');
    if (last) {
        if (last._tickerObserver) last._tickerObserver.disconnect();
        if (last.classList.contains('videoIndicator')) _stopVideoStream(last);
        if (last._alarmObserver)  last._alarmObserver.disconnect();
        if (last._alarmOverlay)   last._alarmOverlay.remove();
        last.remove();
        showSaveBtn();
    }
}

function _collectIndicators() {
    var ws  = document.querySelector('#wsCanvas');
    var wsW = (_wsWidth  > 0) ? _wsWidth  : ws.clientWidth;
    var wsH = (_wsHeight > 0) ? _wsHeight : ws.clientHeight;
    var indicators = [];
    document.querySelectorAll('#wsCanvas .indicator').forEach(function(el) {
        var d    = el.dataset;
        var type = _getIndicatorType(el);
        var rawW = parseInt(el.style.width)  || (d.width  ? parseInt(d.width)  : null);
        var rawH = parseInt(el.style.height) || (d.height ? parseInt(d.height) : null);
        var extraData = null;
        if (type === 'videoIndicator') {
            extraData = JSON.stringify({
                streamHost:    d.streamHost    || '',
                streamPort:    d.streamPort    || '554',
                streamUser:    d.streamUser    || '',
                streamPass:    d.streamPass    || '',
                streamChannel: d.streamChannel || '1',
                streamSub:     d.streamSub     || '0'
            });
        } else if (type === 'alarmHistoryIndicator') {
            extraData = JSON.stringify({
                showTrigger: d.ahShowTrigger !== '0',
                showClear:   d.ahShowClear   !== '0',
                showAck:     d.ahShowAck     !== '0'
            });
        }
        indicators.push({
            type:         type,
            param_id:     type === 'videoIndicator' ? null : (d.paramId !== undefined && d.paramId !== '' ? parseInt(d.paramId) : null),
            pos_left:     (parseInt(el.style.left) || 0) / wsW * 100,
            pos_top:      (parseInt(el.style.top)  || 0) / wsH * 100,
            width:        rawW != null ? rawW / wsW * 100 : null,
            height:       rawH != null ? rawH / wsH * 100 : null,
            header_text:  d.headerText  || '',
            header_color: d.headerColor || '#c9d1d9',
            header_bg:    d.headerBg    || '#161b22',
            header_font:  parseInt(d.headerFont) || 0,
            header_size:  parseInt(d.headerSize) || 14,
            format:       d.format || '',
            value_color:  d.valueColor  || '#38bdf8',
            value_bg:     d.valueBg     || '#0d1117',
            value_font:   parseInt(d.valueFont)  || 0,
            value_size:   parseInt(d.valueSize)  || 48,
            range_min:    d.rangeMin !== '' && d.rangeMin !== undefined ? parseFloat(d.rangeMin) : null,
            range_max:    d.rangeMax !== '' && d.rangeMax !== undefined ? parseFloat(d.rangeMax) : null,
            alarm_enabled: d.alarmEnabled === '1' ? 1 : 0,
            alarm_min:     d.alarmMin !== '' && d.alarmMin !== undefined ? parseFloat(d.alarmMin) : null,
            alarm_max:     d.alarmMax !== '' && d.alarmMax !== undefined ? parseFloat(d.alarmMax) : null,
            alarm_color:   d.alarmColor || '#ff0000',
            units:            d.units || '',
            zone_colors:      d.zoneColors === '1' ? 1 : 0,
            ticker_speed:     parseFloat(d.tickerSpeed) || 12,
            value_bg_opacity: d.valueBgOpacity !== undefined && d.valueBgOpacity !== '' ? parseFloat(d.valueBgOpacity) : 0,
            extra_data: extraData
        });
    });
    return indicators;
}
