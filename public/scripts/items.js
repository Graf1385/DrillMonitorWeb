var _addModal      = document.querySelector('#newItemModal');
var _errorModal    = document.querySelector('#addItemErrorModal');
var _activeType    = 'digitalIndicator';
var _editingEl     = null;

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

var _alarmTarget = null;

function ctxOpenAlarmSettings() {
    _ctxMenu.style.display = 'none';
    if (!_ctxTarget) return;
    _alarmTarget = _ctxTarget;
    _ctxTarget = null;
    var d = _alarmTarget.dataset;
    document.querySelector('#as_alarmMin').value   = d.alarmMin !== '' && d.alarmMin !== undefined ? d.alarmMin : '';
    document.querySelector('#as_alarmMax').value   = d.alarmMax !== '' && d.alarmMax !== undefined ? d.alarmMax : '';
    document.querySelector('#as_alarmColor').value = d.alarmColor || '#ff0000';
    document.querySelector('#alarmSettingsModal').showModal();
}

function applyAlarmSettings() {
    if (!_alarmTarget) { document.querySelector('#alarmSettingsModal').close(); return; }
    function nullable(v) { var n = parseFloat(v); return isNaN(n) ? '' : n; }
    _alarmTarget.dataset.alarmMin   = nullable(document.querySelector('#as_alarmMin').value);
    _alarmTarget.dataset.alarmMax   = nullable(document.querySelector('#as_alarmMax').value);
    _alarmTarget.dataset.alarmColor = document.querySelector('#as_alarmColor').value;
    _alarmTarget = null;
    document.querySelector('#alarmSettingsModal').close();
    showSaveBtn();
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
    var select      = _addModal.querySelector('#ni_paramId');
    var isDatetime  = type === 'timeIndicator' || type === 'dateIndicator';
    var numericRows = _addModal.querySelectorAll('.numericOnlyRow');

    if (isDatetime) {
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
    _loadParameters().then(function () {
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

    var indType = indicator.classList.contains('timeIndicator') ? 'timeIndicator'
                : indicator.classList.contains('dateIndicator')  ? 'dateIndicator'
                : 'digitalIndicator';
    var d = indicator.dataset;
    _loadParameters(d.paramId || '').then(function () {
        _applyTypeToParamSelect(indType);
        _addModal.showModal();
    });
    _addModal.querySelector('#ni_width').value   = d.width  || indicator.offsetWidth  || '';
    _addModal.querySelector('#ni_height').value  = d.height || indicator.offsetHeight || '';
    _addModal.querySelector('#ni_headerText').value  = d.headerText  || '';
    _addModal.querySelector('#ni_headerColor').value = d.headerColor || '#c9d1d9';
    _addModal.querySelector('#ni_headerBg').value    = d.headerBg    || '#161b22';
    _addModal.querySelector('#ni_headerFont').value  = d.headerFont  || 'monospace';
    _addModal.querySelector('#ni_headerSize').value  = d.headerSize  || 14;
    _addModal.querySelector('#ni_format').value      = d.format      || '';
    _addModal.querySelector('#ni_valueFont').value   = d.valueFont   || 'monospace';
    _addModal.querySelector('#ni_valueSize').value   = d.valueSize   || 48;
    _addModal.querySelector('#ni_valueColor').value  = d.valueColor  || '#38bdf8';
    _addModal.querySelector('#ni_valueBg').value     = d.valueBg     || '#0d1117';
    _addModal.querySelector('#ni_rangeMin').value    = d.rangeMin    || '';
    _addModal.querySelector('#ni_rangeMax').value    = d.rangeMax    || '';
}

function onParamChange(selectEl) {
    var opt = selectEl.options[selectEl.selectedIndex];
    if (!opt || !opt.value) return;
    _addModal.querySelector('#ni_headerText').value = opt.textContent;
    _addModal.querySelector('#ni_format').value     = opt.dataset.defaultFormat || '';
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
    _addModal.querySelector('#ni_headerFont').value  = 'monospace';
    _addModal.querySelector('#ni_headerSize').value  = 14;
    _addModal.querySelector('#ni_format').value      = '';
    _addModal.querySelector('#ni_valueFont').value   = 'monospace';
    _addModal.querySelector('#ni_valueSize').value   = 48;
    _addModal.querySelector('#ni_valueColor').value  = '#38bdf8';
    _addModal.querySelector('#ni_valueBg').value     = '#0d1117';
    _addModal.querySelector('#ni_rangeMin').value    = 0;
    _addModal.querySelector('#ni_rangeMax').value    = 100;
}

function selectItemType(type) {
    _activeType = type;
    _addModal.querySelectorAll('.itemTypeCard').forEach(function (c) {
        c.classList.remove('selected');
    });
    var idMap = { digitalIndicator: '#typeDigital', timeIndicator: '#typeTime', dateIndicator: '#typeDate' };
    if (idMap[type]) document.querySelector(idMap[type]).classList.add('selected');
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
        headerFont:  _addModal.querySelector('#ni_headerFont').value,
        headerSize:  clamp(_addModal.querySelector('#ni_headerSize').value, 8, 72),
        format:      _addModal.querySelector('#ni_format').value,
        valueFont:   _addModal.querySelector('#ni_valueFont').value,
        valueSize:   clamp(_addModal.querySelector('#ni_valueSize').value, 12, 120),
        valueColor:  _addModal.querySelector('#ni_valueColor').value,
        valueBg:     _addModal.querySelector('#ni_valueBg').value,
        rangeMin:    nullable(_addModal.querySelector('#ni_rangeMin').value),
        rangeMax:    nullable(_addModal.querySelector('#ni_rangeMax').value),
        alarmMin:   null,
        alarmMax:   null,
        alarmColor: '#ff0000'
    };
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _applyToHeader(headerEl, config) {
    headerEl.style.color           = config.headerColor;
    headerEl.style.backgroundColor = config.headerBg;
    headerEl.style.fontFamily      = config.headerFont;
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

function _applyToValue(valueEl, config, numericVal) {
    valueEl.style.color           = config.valueColor;
    valueEl.style.backgroundColor = config.valueBg;
    valueEl.style.fontFamily      = config.valueFont;
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
        alarmMin:   n(config.alarmMin),
        alarmMax:   n(config.alarmMax),
        alarmColor: config.alarmColor || '#ff0000'
    });
}

function _applySize(el, config) {
    el.style.width  = config.width  ? config.width  + 'px' : '';
    el.style.height = config.height ? config.height + 'px' : '';
}

// ── Create element ────────────────────────────────────────────────────────────

function _createDigitalIndicator(config, left, top) {
    var el = document.createElement('div');
    el.className = 'indicator digitalIndicator';
    el.id        = 'item_' + Date.now();
    el.style.left        = left + 'px';
    el.style.top         = top  + 'px';
    el.style.borderColor = config.valueColor;
    el.style.setProperty('--value-color', config.valueColor);
    _applySize(el, config);
    _storeConfig(el, config);

    var header = document.createElement('div');
    header.className = 'indicatorHeader';
    _applyToHeader(header, config);

    var valueEl = document.createElement('div');
    valueEl.className = 'indicatorValue';
    _applyToValue(valueEl, config, 0);

    el.appendChild(header);
    el.appendChild(valueEl);
    return el;
}

function _createTimeIndicator(config, left, top) {
    var el = document.createElement('div');
    el.className = 'indicator timeIndicator';
    el.id        = 'item_' + Date.now();
    el.style.left        = left + 'px';
    el.style.top         = top  + 'px';
    el.style.borderColor = config.valueColor;
    el.style.setProperty('--value-color', config.valueColor);
    _applySize(el, config);
    _storeConfig(el, config);

    var header = document.createElement('div');
    header.className = 'indicatorHeader';
    _applyToHeader(header, config);

    var valueEl = document.createElement('div');
    valueEl.className = 'indicatorValue';
    valueEl.style.color           = config.valueColor;
    valueEl.style.backgroundColor = config.valueBg;
    valueEl.style.fontFamily      = config.valueFont;
    valueEl.style.fontSize        = config.valueSize + 'px';
    valueEl.style.textShadow      = '0 0 10px ' + config.valueColor;
    valueEl.textContent           = '00:00:00';

    el.appendChild(header);
    el.appendChild(valueEl);
    return el;
}

function _createDateIndicator(config, left, top) {
    var el = document.createElement('div');
    el.className = 'indicator dateIndicator';
    el.id        = 'item_' + Date.now();
    el.style.left        = left + 'px';
    el.style.top         = top  + 'px';
    el.style.borderColor = config.valueColor;
    el.style.setProperty('--value-color', config.valueColor);
    _applySize(el, config);
    _storeConfig(el, config);

    var header = document.createElement('div');
    header.className = 'indicatorHeader';
    _applyToHeader(header, config);

    var valueEl = document.createElement('div');
    valueEl.className = 'indicatorValue';
    valueEl.style.color           = config.valueColor;
    valueEl.style.backgroundColor = config.valueBg;
    valueEl.style.fontFamily      = config.valueFont;
    valueEl.style.fontSize        = config.valueSize + 'px';
    valueEl.style.textShadow      = '0 0 10px ' + config.valueColor;
    valueEl.textContent = 'дд.мм.гг';

    el.appendChild(header);
    el.appendChild(valueEl);
    return el;
}

// ── Add / apply ───────────────────────────────────────────────────────────────

function addNewItem() {
    var config;
    try { config = _readConfig(); } catch(err) { console.error('_readConfig error:', err); return; }


    if (_editingEl) {
        var isDatetime = _editingEl.classList.contains('timeIndicator') ||
                         _editingEl.classList.contains('dateIndicator');
        _editingEl.style.borderColor = config.valueColor;
        _editingEl.style.setProperty('--value-color', config.valueColor);
        _applySize(_editingEl, config);
        _storeConfig(_editingEl, config);
        _applyToHeader(_editingEl.querySelector('.indicatorHeader'), config);
        if (isDatetime) {
            var vEl = _editingEl.querySelector('.indicatorValue');
            vEl.style.color           = config.valueColor;
            vEl.style.backgroundColor = config.valueBg;
            vEl.style.fontFamily      = config.valueFont;
            vEl.style.fontSize        = config.valueSize + 'px';
            vEl.style.textShadow      = '0 0 10px ' + config.valueColor;
        } else {
            var currentNum = parseFloat(_editingEl.querySelector('.indicatorValue').textContent) || 0;
            _applyToValue(_editingEl.querySelector('.indicatorValue'), config, currentNum);
        }
        showSaveBtn();

    } else {
        var ws   = document.querySelector('#workSpace');
        var left = Math.max(20, Math.round(ws.clientWidth  / 2 - 80));
        var top  = Math.max(20, Math.round(ws.clientHeight / 2 - 60));
        var newEl = _activeType === 'timeIndicator'
            ? _createTimeIndicator(config, left, top)
            : _activeType === 'dateIndicator'
            ? _createDateIndicator(config, left, top)
            : _createDigitalIndicator(config, left, top);
        ws.appendChild(newEl);
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
    var indicators = [];
    document.querySelectorAll('#workSpace .indicator').forEach(function(el) {
        var d = el.dataset;
        indicators.push({
            type:         el.classList.contains('timeIndicator') ? 'timeIndicator' :
                          el.classList.contains('dateIndicator') ? 'dateIndicator' : 'digitalIndicator',
            param_id:     d.paramId !== undefined && d.paramId !== '' ? parseInt(d.paramId) : null,
            pos_left:     parseInt(el.style.left) || 0,
            pos_top:      parseInt(el.style.top)  || 0,
            width:        parseInt(el.style.width)  || (d.width  ? parseInt(d.width)  : null),
            height:       parseInt(el.style.height) || (d.height ? parseInt(d.height) : null),
            header_text:  d.headerText  || '',
            header_color: d.headerColor || '#c9d1d9',
            header_bg:    d.headerBg    || '#161b22',
            header_font:  d.headerFont  || 'monospace',
            header_size:  parseInt(d.headerSize) || 14,
            format:       d.format || '',
            value_color:  d.valueColor  || '#38bdf8',
            value_bg:     d.valueBg     || '#0d1117',
            value_font:   d.valueFont   || 'monospace',
            value_size:   parseInt(d.valueSize)  || 48,
            range_min:    d.rangeMin !== '' && d.rangeMin !== undefined ? parseFloat(d.rangeMin) : null,
            range_max:    d.rangeMax !== '' && d.rangeMax !== undefined ? parseFloat(d.rangeMax) : null,
            alarm_min:   d.alarmMin !== '' && d.alarmMin !== undefined ? parseFloat(d.alarmMin) : null,
            alarm_max:   d.alarmMax !== '' && d.alarmMax !== undefined ? parseFloat(d.alarmMax) : null,
            alarm_color: d.alarmColor || '#ff0000'
        });
    });
    return indicators;
}
