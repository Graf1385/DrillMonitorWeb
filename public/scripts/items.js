var _addModal      = document.querySelector('#newItemModal');
var _errorModal    = document.querySelector('#addItemErrorModal');
var _activeType    = 'digitalIndicator';
var _editingEl     = null;

var _fontMap     = {};
var _fontsPromise = null;

var _GAUGE_R   = 78;
var _GAUGE_L   = 245.04;   // Math.PI * 78
var _GAUGE_G   = 147.02;   // 0.6 * L  — end of green zone
var _GAUGE_GY  = 196.03;   // 0.8 * L  — end of yellow zone
var _GAUGE_ARC = 'M 22 100 A 78 78 0 0 1 178 100';

var _TANK_X    = 22;
var _TANK_Y    = 7;
var _TANK_W    = 56;
var _TANK_H    = 96;
var _TANK_BOT  = 103;   // _TANK_Y + _TANK_H
var _TANK_GY_Y = 45.4;  // _TANK_BOT - 0.6 * _TANK_H
var _TANK_R_Y  = 26.2;  // _TANK_BOT - 0.8 * _TANK_H

function _getFontFamily(fontId) {
    var id = parseInt(fontId) || 0;
    return id && _fontMap[id] ? _fontMap[id] : 'monospace';
}

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
    });
    return _fontsPromise;
}

// ── Context menu ──────────────────────────────────────────────────────────────

var _ctxMenu   = document.querySelector('#indicatorContextMenu');
var _ctxTarget = null;

document.addEventListener('contextmenu', function (e) {
    var indicator = e.target.closest('.indicator');
    if (!indicator) return;
    e.preventDefault();
    _ctxTarget = indicator;
    _ctxMenu.style.display = 'block';
    var x = e.clientX, y = e.clientY;
    var menuW = _ctxMenu.offsetWidth  || 190;
    var menuH = _ctxMenu.offsetHeight || 80;
    if (x + menuW > window.innerWidth)  x = window.innerWidth  - menuW - 4;
    if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 4;
    _ctxMenu.style.left = x + 'px';
    _ctxMenu.style.top  = y + 'px';
});

document.addEventListener('mousedown', function (e) {
    if (!_ctxMenu.contains(e.target)) {
        _ctxMenu.style.display = 'none';
        _ctxTarget = null;
    }
}, true);

document.addEventListener('scroll', function () {
    _ctxMenu.style.display = 'none';
    _ctxTarget = null;
}, true);

function ctxOpenValueSettings() {
    _ctxMenu.style.display = 'none';
    if (_ctxTarget) _openEditModal(_ctxTarget);
    _ctxTarget = null;
}


var _deleteTarget = null;

function ctxDeleteIndicator() {
    _ctxMenu.style.display = 'none';
    if (!_ctxTarget) return;
    _deleteTarget = _ctxTarget;
    _ctxTarget = null;
    document.querySelector('#deleteConfirmModal').showModal();
}

function confirmDeleteIndicator() {
    document.querySelector('#deleteConfirmModal').close();
    if (!_deleteTarget) return;
    _deleteTarget.remove();
    _deleteTarget = null;
    showSaveBtn();
}

var _testTarget = null;

function ctxTestIndicator() {
    _ctxMenu.style.display = 'none';
    if (!_ctxTarget) return;
    _testTarget = _ctxTarget;
    _ctxTarget  = null;

    var d   = _testTarget.dataset;
    var min = parseFloat(d.rangeMin);
    var max = parseFloat(d.rangeMax);
    if (isNaN(min)) min = 0;
    if (isNaN(max) || max <= min) max = min + 100;
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

// ── Drag ──────────────────────────────────────────────────────────────────────

var _drag   = { el: null, startX: 0, startY: 0, origLeft: 0, origTop: 0 };
var _resize = { el: null, initW: 0, initH: 0 };

document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;

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
    _drag.el.style.left = (_drag.origLeft + e.clientX - _drag.startX) + 'px';
    _drag.el.style.top  = (_drag.origTop  + e.clientY - _drag.startY) + 'px';
});

document.addEventListener('mouseup', function () {
    var cellSize = _gridActive ? (parseInt(_workSpace.dataset.cellSize) || 20) : 0;

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

// ── Double-click → edit ───────────────────────────────────────────────────────

document.addEventListener('dblclick', function (e) {
    var indicator = e.target.closest('.indicator');
    if (!indicator) return;
    _openEditModal(indicator);
});

// ── Modal: show / hide ────────────────────────────────────────────────────────

function _loadParameters(selectedId) {
    return $.getJSON('/api/parameters').then(function (params) {
        var select = _addModal.querySelector('#ni_paramId');
        select.innerHTML = '<option value="">— не выбран —</option>';
        params.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value        = p.id;
            opt.textContent  = p.name;
            opt.dataset.type          = p.type_name;
            opt.dataset.defaultFormat = p.default_format || '';
            select.appendChild(opt);
        });
        if (selectedId !== undefined && selectedId !== null && selectedId !== '') {
            select.value = selectedId;
        }
    });
}

function _applyTypeToParamSelect(type) {
    var typeDef     = _indicatorTypes[type] || _indicatorTypes.digitalIndicator;
    var select      = _addModal.querySelector('#ni_paramId');
    var numericRows = _addModal.querySelectorAll('.numericOnlyRow');

    if (!typeDef.isNumeric) {
        var dtOpt = Array.from(select.options).find(function (o) {
            return o.dataset.type === 'time';
        });
        if (dtOpt) select.value = dtOpt.value;
        select.disabled = true;
        numericRows.forEach(function (r) { r.style.display = 'none'; });
    } else {
        select.disabled = false;
        numericRows.forEach(function (r) { r.style.display = ''; });
    }
}

function showNewItems() {
    _editingEl = null;
    _addModal.querySelector('h1').textContent = 'Добавить элемент';
    _addModal.querySelector('.okBtn').textContent = 'Добавить';
    _addModal.querySelector('#itemTypeList').style.display = '';
    _addModal.querySelector('#ni_settingsBody').style.display = 'none';
    _resetModalDefaults();
    $.when(_loadParameters(), _loadFonts()).then(function () {
        _applyTypeToParamSelect(_activeType);
        _addModal.showModal();
    });
}

function _openEditModal(indicator) {
    _editingEl = indicator;
    _addModal.querySelector('h1').textContent = 'Настройки индикатора';
    _addModal.querySelector('.okBtn').textContent = 'Применить';
    _addModal.querySelector('#itemTypeList').style.display = 'none';
    _addModal.querySelector('#ni_settingsBody').style.display = '';

    var indType = _getIndicatorType(indicator);
    var d = indicator.dataset;
    $.when(_loadParameters(d.paramId || ''), _loadFonts()).then(function () {
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
    _toggleValueFields(!!(d.paramId));
}

function onParamChange(selectEl) {
    var hasParam = !!(selectEl.value);
    _toggleValueFields(hasParam);
    if (!hasParam) return;
    var opt = selectEl.options[selectEl.selectedIndex];
    _addModal.querySelector('#ni_headerText').value = opt.textContent;
    _addModal.querySelector('#ni_format').value     = opt.dataset.defaultFormat || '';
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

function _resetModalDefaults() {
    _addModal.querySelector('#ni_width').value       = '';
    _addModal.querySelector('#ni_height').value      = '';
    _addModal.querySelector('#ni_headerText').value  = 'Заголовок';
    _addModal.querySelector('#ni_headerColor').value = '#c9d1d9';
    _addModal.querySelector('#ni_headerBg').value    = '#161b22';
    _addModal.querySelector('#ni_headerFont').value  = 0;
    _addModal.querySelector('#ni_headerSize').value  = 14;
    _addModal.querySelector('#ni_format').value      = '';
    _addModal.querySelector('#ni_valueFont').value   = 0;
    _addModal.querySelector('#ni_valueSize').value   = 48;
    _addModal.querySelector('#ni_valueColor').value  = '#38bdf8';
    _addModal.querySelector('#ni_valueBg').value     = '#0d1117';
    _addModal.querySelector('#ni_rangeMin').value      = 0;
    _addModal.querySelector('#ni_rangeMax').value      = 100;
    _addModal.querySelector('#ni_alarmEnabled').checked = false;
    _addModal.querySelector('#ni_alarmMin').value       = '';
    _addModal.querySelector('#ni_alarmMax').value       = '';
    _addModal.querySelector('#ni_alarmColor').value     = '#ff0000';
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
}

// ── Config read ───────────────────────────────────────────────────────────────

function _readConfig() {
    function clamp(val, min, max) { return Math.min(max, Math.max(min, parseInt(val) || min)); }
    function nullable(val) { var n = parseFloat(val); return isNaN(n) ? null : n; }
    var wRaw = parseInt(_addModal.querySelector('#ni_width').value);
    var hRaw = parseInt(_addModal.querySelector('#ni_height').value);
    var paramRaw = _addModal.querySelector('#ni_paramId').value;
    return {
        paramId:     paramRaw !== '' ? parseInt(paramRaw) : null,
        width:       isNaN(wRaw) ? null : Math.min(2000, Math.max(40, wRaw)),
        height:      isNaN(hRaw) ? null : Math.min(2000, Math.max(40, hRaw)),
        headerText:  _addModal.querySelector('#ni_headerText').value || 'Заголовок',
        headerColor: _addModal.querySelector('#ni_headerColor').value,
        headerBg:    _addModal.querySelector('#ni_headerBg').value,
        headerFont:  parseInt(_addModal.querySelector('#ni_headerFont').value) || 0,
        headerSize:  clamp(_addModal.querySelector('#ni_headerSize').value, 8, 72),
        format:      _addModal.querySelector('#ni_format').value,
        valueFont:   parseInt(_addModal.querySelector('#ni_valueFont').value) || 0,
        valueSize:   clamp(_addModal.querySelector('#ni_valueSize').value, 12, 120),
        valueColor:  _addModal.querySelector('#ni_valueColor').value,
        valueBg:     _addModal.querySelector('#ni_valueBg').value,
        rangeMin:     nullable(_addModal.querySelector('#ni_rangeMin').value),
        rangeMax:     nullable(_addModal.querySelector('#ni_rangeMax').value),
        alarmEnabled: _addModal.querySelector('#ni_alarmEnabled').checked,
        alarmMin:     nullable(_addModal.querySelector('#ni_alarmMin').value),
        alarmMax:     nullable(_addModal.querySelector('#ni_alarmMax').value),
        alarmColor:   _addModal.querySelector('#ni_alarmColor').value
    };
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _applyToHeader(headerEl, config) {
    headerEl.style.color           = config.headerColor;
    headerEl.style.backgroundColor = config.headerBg;
    headerEl.style.fontFamily      = _getFontFamily(config.headerFont);
    headerEl.style.fontSize        = config.headerSize + 'px';
    headerEl.textContent           = config.headerText;
}

function _applyFormat(num, fmt) {
    if (!fmt) return String(num);
    var dotIdx = fmt.indexOf('.');
    if (dotIdx === -1) {
        var intLen = fmt.length;
        return String(Math.round(num)).padStart(intLen, '0');
    }
    var decLen = fmt.length - dotIdx - 1;
    var fixed  = num.toFixed(decLen);
    var parts  = fixed.split('.');
    return parts[0].padStart(dotIdx, '0') + '.' + parts[1];
}

function _updateGaugeSvg(el, numericVal) {
    var d = el.dataset;
    var min = parseFloat(d.rangeMin);
    var max = parseFloat(d.rangeMax);
    if (isNaN(min)) min = 0;
    if (isNaN(max) || max <= min) max = min + 100;

    var minLbl = el.querySelector('.gaugeMinLabel');
    var maxLbl = el.querySelector('.gaugeMaxLabel');
    if (minLbl) minLbl.textContent = min;
    if (maxLbl) maxLbl.textContent = max;

    var pct  = Math.max(0, Math.min(1, (numericVal - min) / (max - min)));
    var gPrg = Math.min(pct, 0.6)                     * _GAUGE_L;
    var yPrg = Math.max(0, Math.min(pct, 0.8) - 0.6)  * _GAUGE_L;
    var rPrg = Math.max(0, pct - 0.8)                 * _GAUGE_L;

    var gEl = el.querySelector('.gaugeGreenProg');
    var yEl = el.querySelector('.gaugeYellowProg');
    var rEl = el.querySelector('.gaugeRedProg');
    if (gEl) gEl.setAttribute('stroke-dasharray', gPrg.toFixed(2) + ' ' + _GAUGE_L);
    if (yEl) yEl.setAttribute('stroke-dasharray', yPrg.toFixed(2) + ' ' + _GAUGE_L);
    if (rEl) rEl.setAttribute('stroke-dasharray', rPrg.toFixed(2) + ' ' + _GAUGE_L);
}

function _makeTankWavePath(waterY) {
    var amp = 1.2;
    var W   = _TANK_W;
    var x0  = _TANK_X - W;
    var x1  = _TANK_X + W * 3;
    var bot = _TANK_BOT + 2;
    if (waterY >= _TANK_BOT - amp) {
        return 'M ' + x0 + ',' + bot + ' L ' + x1 + ',' + bot + ' Z';
    }
    var d = 'M ' + x0 + ',' + bot + ' L ' + x0 + ',' + waterY.toFixed(2);
    for (var x = x0; x < x1; x += W) {
        d += ' Q ' + (x + W * 0.25).toFixed(2) + ',' + (waterY - amp * 2).toFixed(2)
           + ' ' + (x + W * 0.5).toFixed(2)   + ',' + waterY.toFixed(2);
        d += ' Q ' + (x + W * 0.75).toFixed(2) + ',' + (waterY + amp * 2).toFixed(2)
           + ' ' + (x + W).toFixed(2)          + ',' + waterY.toFixed(2);
    }
    d += ' L ' + x1 + ',' + bot + ' Z';
    return d;
}

function _tankTextShadow(bg) {
    var c = bg || '#1a2233';
    return '-1px -1px 0 ' + c + ',1px -1px 0 ' + c + ',-1px 1px 0 ' + c + ',1px 1px 0 ' + c + ',0 0 6px ' + c;
}

function _updateTankSvg(el, numericVal) {
    var d   = el.dataset;
    var min = parseFloat(d.rangeMin);
    var max = parseFloat(d.rangeMax);
    if (isNaN(min)) min = 0;
    if (isNaN(max) || max <= min) max = min + 100;

    var pct  = Math.max(0, Math.min(1, (numericVal - min) / (max - min)));
    var prog = el.querySelector('.tankProg');
    if (prog) {
        prog.setAttribute('d', _makeTankWavePath(_TANK_BOT - pct * _TANK_H));
    }
}

function setIndicatorValue(el, val) {
    var d   = el.dataset;
    var min = parseFloat(d.rangeMin);
    var max = parseFloat(d.rangeMax);
    if (isNaN(min)) min = 0;
    if (isNaN(max) || max <= min) max = min + 100;
    el._currentValue = Math.max(min, Math.min(max, isNaN(+val) ? min : +val));

    var type = _getIndicatorType(el);
    if (type === 'digitalIndicator') {
        var v = el.querySelector('.indicatorValue');
        if (v) v.textContent = _applyFormat(el._currentValue, d.format || '');
    } else if (type === 'gaugeIndicator') {
        var gt = el.querySelector('.gaugeValueText');
        if (gt) gt.textContent = _applyFormat(el._currentValue, d.format || '');
        _updateGaugeSvg(el, el._currentValue);
    } else if (type === 'tankIndicator') {
        var tt = el.querySelector('.tankValueText');
        if (tt) tt.textContent = _applyFormat(el._currentValue, d.format || '');
        _updateTankSvg(el, el._currentValue);
    }
}

function _applyToValue(valueEl, config, numericVal) {
    valueEl.style.color           = config.valueColor;
    valueEl.style.backgroundColor = config.valueBg;
    valueEl.style.fontFamily      = _getFontFamily(config.valueFont);
    valueEl.style.fontSize        = config.valueSize + 'px';
    valueEl.style.textShadow      = '0 0 10px ' + config.valueColor;
    valueEl.textContent           = _applyFormat(numericVal, config.format);
}

function _storeConfig(el, config) {
    function n(v) { return v !== null && v !== undefined ? v : ''; }
    Object.assign(el.dataset, {
        paramId:     n(config.paramId),
        width:       n(config.width),
        height:      n(config.height),
        headerText:  config.headerText,
        headerColor: config.headerColor,
        headerBg:    config.headerBg,
        headerFont:  config.headerFont,
        headerSize:  config.headerSize,
        format:      config.format,
        valueFont:   config.valueFont,
        valueSize:   config.valueSize,
        valueColor:  config.valueColor,
        valueBg:     config.valueBg,
        rangeMin:    n(config.rangeMin),
        rangeMax:    n(config.rangeMax),
        alarmEnabled: config.alarmEnabled ? '1' : '0',
        alarmMin:     n(config.alarmMin),
        alarmMax:     n(config.alarmMax),
        alarmColor:   config.alarmColor || '#ff0000'
    });
}

function _applySize(el, config) {
    el.style.width  = config.width  ? config.width  + 'px' : '';
    el.style.height = config.height ? config.height + 'px' : '';
}

// ── Indicator type registry ───────────────────────────────────────────────────

var _indicatorTypes = {

    digitalIndicator: {
        cardId: '#typeDigital',
        isNumeric: true,
        defaultSize: {},
        create: function (el, cfg) {
            var v = document.createElement('div');
            v.className = 'indicatorValue';
            _applyToValue(v, cfg, 0);
            el.appendChild(v);
        },
        applyEdit: function (el, cfg) {
            var v = el.querySelector('.indicatorValue');
            if (!v) return;
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = cfg.valueBg;
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = cfg.valueSize + 'px';
            v.style.textShadow      = '0 0 10px ' + cfg.valueColor;
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    timeIndicator: {
        cardId: '#typeTime',
        isNumeric: false,
        defaultSize: {},
        create: function (el, cfg) {
            var v = document.createElement('div');
            v.className = 'indicatorValue';
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = cfg.valueBg;
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = cfg.valueSize + 'px';
            v.style.textShadow      = '0 0 10px ' + cfg.valueColor;
            v.textContent           = '00:00:00';
            el.appendChild(v);
        },
        applyEdit: function (el, cfg) {
            var v = el.querySelector('.indicatorValue');
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = cfg.valueBg;
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = cfg.valueSize + 'px';
            v.style.textShadow      = '0 0 10px ' + cfg.valueColor;
        }
    },

    dateIndicator: {
        cardId: '#typeDate',
        isNumeric: false,
        defaultSize: {},
        create: function (el, cfg) {
            var v = document.createElement('div');
            v.className = 'indicatorValue';
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = cfg.valueBg;
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = cfg.valueSize + 'px';
            v.style.textShadow      = '0 0 10px ' + cfg.valueColor;
            v.textContent           = 'дд.мм.гг';
            el.appendChild(v);
        },
        applyEdit: function (el, cfg) {
            var v = el.querySelector('.indicatorValue');
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = cfg.valueBg;
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = cfg.valueSize + 'px';
            v.style.textShadow      = '0 0 10px ' + cfg.valueColor;
        }
    },

    gaugeIndicator: {
        cardId: '#typeGauge',
        isNumeric: true,
        defaultSize: { width: 200, height: 160 },
        create: function (el, cfg) {
            var NS  = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', '0 0 200 115');
            svg.setAttribute('class', 'gaugeSvg');
            svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
            svg.style.backgroundColor = cfg.valueBg;

            function mkArc(cls, stroke, dashArray, dashOffset) {
                var p = document.createElementNS(NS, 'path');
                p.setAttribute('d', _GAUGE_ARC);
                p.setAttribute('fill', 'none');
                p.setAttribute('stroke', stroke);
                p.setAttribute('stroke-width', '22');
                p.setAttribute('stroke-linecap', 'butt');
                p.setAttribute('class', cls);
                p.setAttribute('stroke-dasharray', dashArray);
                if (dashOffset !== 0) p.setAttribute('stroke-dashoffset', String(dashOffset));
                return p;
            }

            svg.appendChild(mkArc('gaugeTrack',      '#2d333b', _GAUGE_L + ' ' + _GAUGE_L, 0));
            svg.appendChild(mkArc('gaugeGreenDim',   '#1a3a1a', '147.02 ' + _GAUGE_L,      0));
            svg.appendChild(mkArc('gaugeYellowDim',  '#3a3000', '49.01 '  + _GAUGE_L,      -147.02));
            svg.appendChild(mkArc('gaugeRedDim',     '#3a0a0a', '49.01 '  + _GAUGE_L,      -196.03));
            svg.appendChild(mkArc('gaugeGreenProg',  '#3fb950', '0 '      + _GAUGE_L,      0));
            svg.appendChild(mkArc('gaugeYellowProg', '#d29922', '0 '      + _GAUGE_L,      -147.02));
            svg.appendChild(mkArc('gaugeRedProg',    '#f85149', '0 '      + _GAUGE_L,      -196.03));

            // Segmentation mask: 9 dividers at 10%–90%, none at 0% or 100%.
            // Pattern: 0-dash, first-half-segment gap, then 9 dividers with inner gaps,
            // last gap = first-half-segment (symmetric, so endpoints stay clean).
            var _segGap    = 3;
            var _segPeriod = _GAUGE_L / 10;
            var _segInner  = (_segPeriod - _segGap).toFixed(3);
            var _segFirst  = (_segPeriod - _segGap / 2).toFixed(3);
            var _dashArr   = '0 ' + _segFirst;
            for (var si = 0; si < 8; si++) _dashArr += ' ' + _segGap + ' ' + _segInner;
            _dashArr += ' ' + _segGap + ' ' + _segFirst;
            var seg = document.createElementNS(NS, 'path');
            seg.setAttribute('d', _GAUGE_ARC);
            seg.setAttribute('fill', 'none');
            seg.setAttribute('stroke', cfg.valueBg);
            seg.setAttribute('stroke-width', '24');
            seg.setAttribute('stroke-linecap', 'butt');
            seg.setAttribute('class', 'gaugeSeg');
            seg.setAttribute('stroke-dasharray', _dashArr);
            svg.appendChild(seg);

            function mkText(cls, x, y, fontSize, fill, content) {
                var t = document.createElementNS(NS, 'text');
                t.setAttribute('class', cls);
                t.setAttribute('x', String(x));
                t.setAttribute('y', String(y));
                t.setAttribute('text-anchor', 'middle');
                t.setAttribute('dominant-baseline', 'middle');
                t.setAttribute('fill', fill);
                t.setAttribute('font-size', String(fontSize));
                t.setAttribute('font-weight', 'bold');
                t.textContent = content;
                return t;
            }

            var fontSize = Math.max(6, Math.round(cfg.valueSize / 2));
            var valText  = mkText('gaugeValueText', 100, 83, fontSize, cfg.valueColor, _applyFormat(0, cfg.format));
            valText.setAttribute('font-family', _getFontFamily(cfg.valueFont));
            svg.appendChild(valText);
            svg.appendChild(mkText('gaugeMinLabel',  16,  109, 9, '#6e7681', cfg.rangeMin !== null ? cfg.rangeMin : 0));
            svg.appendChild(mkText('gaugeMaxLabel', 184,  109, 9, '#6e7681', cfg.rangeMax !== null ? cfg.rangeMax : 100));

            el.appendChild(svg);
            _updateGaugeSvg(el, 0);
        },
        applyEdit: function (el, cfg) {
            var t = el.querySelector('.gaugeValueText');
            if (!t) return;
            t.setAttribute('fill', cfg.valueColor);
            t.setAttribute('font-family', _getFontFamily(cfg.valueFont));
            t.setAttribute('font-size', String(Math.max(6, Math.round(cfg.valueSize / 2))));
            var svg = el.querySelector('.gaugeSvg');
            if (svg) svg.style.backgroundColor = cfg.valueBg;
            var seg = el.querySelector('.gaugeSeg');
            if (seg) seg.setAttribute('stroke', cfg.valueBg);
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    tankIndicator: {
        cardId: '#typeTank',
        isNumeric: true,
        defaultSize: { width: 120, height: 200 },
        create: function (el, cfg) {
            var NS  = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', '18 3 66 104');
            svg.setAttribute('class', 'tankSvg');
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.style.backgroundColor = cfg.valueBg;

            var clipId   = 'tc_' + el.id;
            var defs     = document.createElementNS(NS, 'defs');
            var clip     = document.createElementNS(NS, 'clipPath');
            clip.setAttribute('id', clipId);
            var clipRect = document.createElementNS(NS, 'rect');
            clipRect.setAttribute('x', '20'); clipRect.setAttribute('y', '5');
            clipRect.setAttribute('width', '60'); clipRect.setAttribute('height', '100');
            clipRect.setAttribute('rx', '4');
            clip.appendChild(clipRect);
            defs.appendChild(clip);
            svg.appendChild(defs);

            function mkRect(cls, x, y, w, h, fill) {
                var r = document.createElementNS(NS, 'rect');
                if (cls) r.setAttribute('class', cls);
                r.setAttribute('x', String(x)); r.setAttribute('y', String(y));
                r.setAttribute('width', String(w)); r.setAttribute('height', String(h));
                r.setAttribute('fill', fill);
                return r;
            }

            var fills = document.createElementNS(NS, 'g');
            fills.setAttribute('clip-path', 'url(#' + clipId + ')');
            fills.appendChild(mkRect('tankDimBg', _TANK_X, _TANK_Y, _TANK_W, _TANK_H, '#1a2233'));

            var waveGroup = document.createElementNS(NS, 'g');
            var anim = document.createElementNS(NS, 'animateTransform');
            anim.setAttribute('attributeName', 'transform');
            anim.setAttribute('type', 'translate');
            anim.setAttribute('from', '0,0');
            anim.setAttribute('to', (-_TANK_W) + ',0');
            anim.setAttribute('dur', '3s');
            anim.setAttribute('repeatCount', 'indefinite');
            waveGroup.appendChild(anim);
            var wavePath = document.createElementNS(NS, 'path');
            wavePath.setAttribute('class', 'tankProg');
            wavePath.setAttribute('fill', cfg.valueColor);
            wavePath.setAttribute('d', _makeTankWavePath(_TANK_BOT));
            waveGroup.appendChild(wavePath);
            fills.appendChild(waveGroup);

            svg.appendChild(fills);

            var border = document.createElementNS(NS, 'rect');
            border.setAttribute('class', 'tankBorder');
            border.setAttribute('x', '20'); border.setAttribute('y', '5');
            border.setAttribute('width', '60'); border.setAttribute('height', '100');
            border.setAttribute('rx', '4');
            border.setAttribute('fill', 'none');
            border.setAttribute('stroke', cfg.valueColor);
            border.setAttribute('stroke-width', '2');
            svg.appendChild(border);

            var wrapper = document.createElement('div');
            wrapper.className = 'tankSvgWrapper';
            wrapper.appendChild(svg);

            var valText = document.createElement('span');
            valText.className          = 'tankValueText';
            valText.style.color        = cfg.valueColor;
            valText.style.fontSize     = cfg.valueSize + 'px';
            valText.style.fontFamily   = _getFontFamily(cfg.valueFont);
            valText.style.textShadow   = _tankTextShadow(cfg.valueBg);
            valText.textContent        = _applyFormat(0, cfg.format);
            wrapper.appendChild(valText);

            el.appendChild(wrapper);
            _updateTankSvg(el, 0);
        },
        applyEdit: function (el, cfg) {
            var t = el.querySelector('.tankValueText');
            if (t) {
                t.style.color      = cfg.valueColor;
                t.style.fontFamily = _getFontFamily(cfg.valueFont);
                t.style.fontSize   = cfg.valueSize + 'px';
                t.style.textShadow = _tankTextShadow(cfg.valueBg);
            }
            var svg = el.querySelector('.tankSvg');
            if (svg) svg.style.backgroundColor = cfg.valueBg;
            var border = el.querySelector('.tankBorder');
            if (border) border.setAttribute('stroke', cfg.valueColor);
            var prog = el.querySelector('.tankProg');
            if (prog) prog.setAttribute('fill', cfg.valueColor);
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    }

};

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
    return el;
}

// ── Add / apply ───────────────────────────────────────────────────────────────

function addNewItem() {
    var config;
    try { config = _readConfig(); } catch(err) { console.error('_readConfig error:', err); return; }


    if (_editingEl) {
        var typeDef = _indicatorTypes[_getIndicatorType(_editingEl)] || _indicatorTypes.digitalIndicator;
        _editingEl.style.borderColor = config.valueColor;
        _editingEl.style.setProperty('--value-color', config.valueColor);
        _applySize(_editingEl, config);
        _storeConfig(_editingEl, config);
        _applyToHeader(_editingEl.querySelector('.indicatorHeader'), config);
        typeDef.applyEdit(_editingEl, config);
        showSaveBtn();

    } else {
        var ws   = document.querySelector('#workSpace');
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
    if (last) { last.remove(); showSaveBtn(); }
}

function _collectIndicators() {
    var ws  = document.querySelector('#workSpace');
    var wsW = ws.clientWidth;
    var wsH = ws.clientHeight;
    var indicators = [];
    document.querySelectorAll('#workSpace .indicator').forEach(function(el) {
        var d    = el.dataset;
        var rawW = parseInt(el.style.width)  || (d.width  ? parseInt(d.width)  : null);
        var rawH = parseInt(el.style.height) || (d.height ? parseInt(d.height) : null);
        indicators.push({
            type:         _getIndicatorType(el),
            param_id:     d.paramId !== undefined && d.paramId !== '' ? parseInt(d.paramId) : null,
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
            alarm_color:   d.alarmColor || '#ff0000'
        });
    });
    return indicators;
}
