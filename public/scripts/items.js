var _addModal      = document.querySelector('#newItemModal');
var _errorModal    = document.querySelector('#addItemErrorModal');
var _activeType    = 'digitalIndicator';
var _editingEl     = null;

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
            opt.value       = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        });
        if (selectedId !== undefined && selectedId !== null && selectedId !== '') {
            select.value = selectedId;
        }
    });
}

function showNewItems() {
    _editingEl = null;
    _addModal.querySelector('h1').textContent = 'Добавить элемент';
    _addModal.querySelector('.okBtn').textContent = 'Добавить';
    _addModal.querySelector('.itemTypeRow').style.display = '';
    _resetModalDefaults();
    _loadParameters().then(function () { _addModal.showModal(); });
}

function _openEditModal(indicator) {
    _editingEl = indicator;
    _addModal.querySelector('h1').textContent = 'Настройки индикатора';
    _addModal.querySelector('.okBtn').textContent = 'Применить';
    _addModal.querySelector('.itemTypeRow').style.display = 'none';

    var d = indicator.dataset;
    _loadParameters(d.paramId || '').then(function () { _addModal.showModal(); });
    _addModal.querySelector('#ni_width').value   = d.width  || indicator.offsetWidth  || '';
    _addModal.querySelector('#ni_height').value  = d.height || indicator.offsetHeight || '';
    _addModal.querySelector('#ni_headerText').value  = d.headerText  || '';
    _addModal.querySelector('#ni_headerColor').value = d.headerColor || '#c9d1d9';
    _addModal.querySelector('#ni_headerBg').value    = d.headerBg    || '#161b22';
    _addModal.querySelector('#ni_headerFont').value  = d.headerFont  || 'monospace';
    _addModal.querySelector('#ni_headerSize').value  = d.headerSize  || 14;
    _addModal.querySelector('#ni_decimals').value    = d.decimals    || 1;
    _addModal.querySelector('#ni_valueFont').value   = d.valueFont   || 'monospace';
    _addModal.querySelector('#ni_valueSize').value   = d.valueSize   || 48;
    _addModal.querySelector('#ni_valueColor').value  = d.valueColor  || '#38bdf8';
    _addModal.querySelector('#ni_valueBg').value     = d.valueBg     || '#0d1117';
}

function onParamChange(selectEl) {
    var opt = selectEl.options[selectEl.selectedIndex];
    if (!opt || !opt.value) return;
    _addModal.querySelector('#ni_headerText').value = opt.textContent;
}

function closeAddItemModal() {
    _addModal.close();
    _editingEl = null;
}

function _resetModalDefaults() {
    _addModal.querySelector('#ni_width').value   = '';
    _addModal.querySelector('#ni_height').value  = '';
    _addModal.querySelector('#ni_headerText').value  = 'Заголовок';
    _addModal.querySelector('#ni_headerColor').value = '#c9d1d9';
    _addModal.querySelector('#ni_headerBg').value    = '#161b22';
    _addModal.querySelector('#ni_headerFont').value  = 'monospace';
    _addModal.querySelector('#ni_headerSize').value  = 14;
    _addModal.querySelector('#ni_decimals').value    = 1;
    _addModal.querySelector('#ni_valueFont').value   = 'monospace';
    _addModal.querySelector('#ni_valueSize').value   = 48;
    _addModal.querySelector('#ni_valueColor').value  = '#38bdf8';
    _addModal.querySelector('#ni_valueBg').value     = '#0d1117';
}

function selectItemType(type) {
    _activeType = type;
    _addModal.querySelectorAll('.itemTypeCard').forEach(function (c) {
        c.classList.remove('selected');
    });
    var idMap = { digitalIndicator: '#typeDigital', timeIndicator: '#typeTime' };
    if (idMap[type]) document.querySelector(idMap[type]).classList.add('selected');
}

// ── Config read ───────────────────────────────────────────────────────────────

function _readConfig() {
    function clamp(val, min, max) { return Math.min(max, Math.max(min, parseInt(val) || min)); }
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
        decimals:    clamp(_addModal.querySelector('#ni_decimals').value, 0, 4),
        valueFont:   _addModal.querySelector('#ni_valueFont').value,
        valueSize:   clamp(_addModal.querySelector('#ni_valueSize').value, 12, 120),
        valueColor:  _addModal.querySelector('#ni_valueColor').value,
        valueBg:     _addModal.querySelector('#ni_valueBg').value
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

function _applyToValue(valueEl, config, numericVal) {
    valueEl.style.color           = config.valueColor;
    valueEl.style.backgroundColor = config.valueBg;
    valueEl.style.fontFamily      = config.valueFont;
    valueEl.style.fontSize        = config.valueSize + 'px';
    valueEl.style.textShadow      = '0 0 10px ' + config.valueColor;
    valueEl.textContent           = numericVal.toFixed(config.decimals);
}

function _storeConfig(el, config) {
    Object.assign(el.dataset, {
        paramId:     config.paramId !== null ? config.paramId : '',
        width:       config.width   !== null ? config.width   : '',
        height:      config.height  !== null ? config.height  : '',
        headerText:  config.headerText,
        headerColor: config.headerColor,
        headerBg:    config.headerBg,
        headerFont:  config.headerFont,
        headerSize:  config.headerSize,
        decimals:    config.decimals,
        valueFont:   config.valueFont,
        valueSize:   config.valueSize,
        valueColor:  config.valueColor,
        valueBg:     config.valueBg
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

// ── Add / apply ───────────────────────────────────────────────────────────────

function addNewItem() {
    var config = _readConfig();

    if (_activeType === 'digitalIndicator' && config.paramId === null) {
        _addModal.close();
        _errorModal.showModal();
        return;
    }

    if (_editingEl) {
        var isTime = _editingEl.classList.contains('timeIndicator');
        _editingEl.style.borderColor = config.valueColor;
        _applySize(_editingEl, config);
        _storeConfig(_editingEl, config);
        _applyToHeader(_editingEl.querySelector('.indicatorHeader'), config);
        if (isTime) {
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
            type:         el.classList.contains('timeIndicator') ? 'timeIndicator' : 'digitalIndicator',
            param_id:     d.paramId !== undefined && d.paramId !== '' ? parseInt(d.paramId) : null,
            pos_left:     parseInt(el.style.left) || 0,
            pos_top:      parseInt(el.style.top)  || 0,
            width:        d.width  ? parseInt(d.width)  : null,
            height:       d.height ? parseInt(d.height) : null,
            header_text:  d.headerText  || '',
            header_color: d.headerColor || '#c9d1d9',
            header_bg:    d.headerBg    || '#161b22',
            header_font:  d.headerFont  || 'monospace',
            header_size:  parseInt(d.headerSize) || 14,
            decimals:     parseInt(d.decimals)   || 1,
            value_color:  d.valueColor  || '#38bdf8',
            value_bg:     d.valueBg     || '#0d1117',
            value_font:   d.valueFont   || 'monospace',
            value_size:   parseInt(d.valueSize)  || 48
        });
    });
    return indicators;
}
