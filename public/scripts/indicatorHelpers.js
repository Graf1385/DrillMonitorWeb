// ── Gauge constants ───────────────────────────────────────────────────────────

var _GAUGE_R   = 78;
var _GAUGE_L   = 245.04;
var _GAUGE_G   = 147.02;
var _GAUGE_GY  = 196.03;
var _GAUGE_ARC = 'M 22 100 A 78 78 0 0 1 178 100';

// ── Tank constants ────────────────────────────────────────────────────────────

var _TANK_X    = 22;
var _TANK_Y    = 7;
var _TANK_W    = 56;
var _TANK_H    = 96;
var _TANK_BOT  = 103;
var _TANK_GY_Y = 45.4;
var _TANK_R_Y  = 26.2;

// ── Manometer constants ───────────────────────────────────────────────────────

var _MANO_CX     = 100;
var _MANO_CY     = 105;
var _MANO_R      = 70;
var _MANO_R_NDL  = 60;
var _MANO_START  = 135;
var _MANO_SWEEP  = 270;
var _MANO_L      = 329.87;
var _MANO_GREEN  = 197.92;
var _MANO_YELLOW = 263.89;
var _MANO_ARC    = 'M 50.5,154.5 A 70,70 0 1,1 149.5,154.5';

// ── Font registry ─────────────────────────────────────────────────────────────

var _fontMap = {};

function _getFontFamily(fontId) {
    var id = parseInt(fontId) || 0;
    return id && _fontMap[id] ? _fontMap[id] : 'monospace';
}

function _scaledFontPx(size) {
    return (size / (window._wsScale || 1)) + 'px';
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _applyToHeader(headerEl, config) {
    headerEl.style.color           = config.headerColor;
    headerEl.style.backgroundColor = config.headerBg;
    headerEl.style.fontFamily      = _getFontFamily(config.headerFont);
    headerEl.style.fontSize        = _scaledFontPx(config.headerSize);
    headerEl.textContent           = config.headerText;
}

function _applySize(el, config) {
    el.style.width  = config.width  ? config.width  + 'px' : '';
    el.style.height = config.height ? config.height + 'px' : '';
}

function _storeConfig(el, config) {
    function n(v) { return v !== null && v !== undefined ? v : ''; }
    Object.assign(el.dataset, {
        paramId:     n(config.paramId),
        paramName:   config.paramName || '',
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
        alarmColor:   config.alarmColor || '#ff0000',
        units:          config.units || '',
        zoneColors:     config.zoneColors ? '1' : '0',
        tickerSpeed:    config.tickerSpeed || 12,
        valueBgOpacity: config.valueBgOpacity !== undefined ? config.valueBgOpacity : 0
    });
}

// ── Value formatting ──────────────────────────────────────────────────────────

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

function _formatValue(el, numericVal) {
    var str   = _applyFormat(numericVal, el.dataset.format || '');
    var units = el.dataset.units || '';
    return units ? str + ' ' + units : str;
}

function _getZoneColor(el, numericVal) {
    if (el.dataset.zoneColors !== '1') return null;
    var min = parseFloat(el.dataset.rangeMin); if (isNaN(min)) min = 0;
    var max = parseFloat(el.dataset.rangeMax); if (isNaN(max) || max <= min) max = min + 100;
    var pct = Math.max(0, Math.min(1, (numericVal - min) / (max - min)));
    if (pct < 0.6) return '#3fb950';
    if (pct < 0.8) return '#d29922';
    return '#f85149';
}

function _hexToRgba(hex, alpha) {
    var h = (hex || '#000000').replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var r = parseInt(h.slice(0,2), 16);
    var g = parseInt(h.slice(2,4), 16);
    var b = parseInt(h.slice(4,6), 16);
    var raw = parseFloat(alpha);
    var a = isNaN(raw) ? 1 : Math.max(0, Math.min(1, 1 - raw));
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

function _tankTextShadow(bg) {
    var c = bg || '#1a2233';
    return '-1px -1px 0 ' + c + ',1px -1px 0 ' + c + ',-1px 1px 0 ' + c + ',1px 1px 0 ' + c + ',0 0 6px ' + c;
}

function _applyToValue(valueEl, config, numericVal) {
    valueEl.style.color           = config.valueColor;
    valueEl.style.backgroundColor = config.valueBg;
    valueEl.style.fontFamily      = _getFontFamily(config.valueFont);
    valueEl.style.fontSize        = _scaledFontPx(config.valueSize);
    valueEl.style.textShadow      = '0 0 10px ' + config.valueColor;
    valueEl.textContent           = _applyFormat(numericVal, config.format);
}

// ── SVG / DOM updaters ────────────────────────────────────────────────────────

function _updateGaugeSvg(el, numericVal) {
    var d = el.dataset;
    var min = parseFloat(d.rangeMin); if (isNaN(min)) min = 0;
    var max = parseFloat(d.rangeMax); if (isNaN(max) || max <= min) max = min + 100;

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

function _updateTankSvg(el, numericVal) {
    var d   = el.dataset;
    var min = parseFloat(d.rangeMin); if (isNaN(min)) min = 0;
    var max = parseFloat(d.rangeMax); if (isNaN(max) || max <= min) max = min + 100;
    var pct  = Math.max(0, Math.min(1, (numericVal - min) / (max - min)));
    var prog = el.querySelector('.tankProg');
    if (prog) prog.setAttribute('d', _makeTankWavePath(_TANK_BOT - pct * _TANK_H));
}

function _updateHBar(el, numericVal) {
    var d = el.dataset;
    var min = parseFloat(d.rangeMin); if (isNaN(min)) min = 0;
    var max = parseFloat(d.rangeMax); if (isNaN(max) || max <= min) max = min + 100;
    var pct = Math.max(0, Math.min(1, (numericVal - min) / (max - min)));
    var fill = el.querySelector('.hBarFill');
    if (fill) fill.style.width = (pct * 100).toFixed(2) + '%';
    var mn = el.querySelector('.hBarMin'); if (mn) mn.textContent = min;
    var mx = el.querySelector('.hBarMax'); if (mx) mx.textContent = max;
}

function _updateVBar(el, numericVal) {
    var d = el.dataset;
    var min = parseFloat(d.rangeMin); if (isNaN(min)) min = 0;
    var max = parseFloat(d.rangeMax); if (isNaN(max) || max <= min) max = min + 100;
    var pct = Math.max(0, Math.min(1, (numericVal - min) / (max - min)));
    var fill = el.querySelector('.vBarFill');
    if (fill) fill.style.height = (pct * 100).toFixed(2) + '%';
    var mn = el.querySelector('.vBarMin'); if (mn) mn.textContent = min;
    var mx = el.querySelector('.vBarMax'); if (mx) mx.textContent = max;
}

function _updateManoSvg(el, numericVal) {
    var d = el.dataset;
    var min = parseFloat(d.rangeMin); if (isNaN(min)) min = 0;
    var max = parseFloat(d.rangeMax); if (isNaN(max) || max <= min) max = min + 100;

    var minLbl = el.querySelector('.manoMinLabel');
    var maxLbl = el.querySelector('.manoMaxLabel');
    if (minLbl) minLbl.textContent = min;
    if (maxLbl) maxLbl.textContent = max;

    var pct  = Math.max(0, Math.min(1, (numericVal - min) / (max - min)));
    var gPrg = Math.min(pct, 0.6) * _MANO_L;
    var yPrg = Math.max(0, Math.min(pct, 0.8) - 0.6) * _MANO_L;
    var rPrg = Math.max(0, pct - 0.8) * _MANO_L;

    var gEl = el.querySelector('.manoGreenProg');
    var yEl = el.querySelector('.manoYellowProg');
    var rEl = el.querySelector('.manoRedProg');
    if (gEl) gEl.setAttribute('stroke-dasharray', gPrg.toFixed(2) + ' ' + _MANO_L);
    if (yEl) yEl.setAttribute('stroke-dasharray', yPrg.toFixed(2) + ' ' + _MANO_L);
    if (rEl) rEl.setAttribute('stroke-dasharray', rPrg.toFixed(2) + ' ' + _MANO_L);

    var angleRad = (_MANO_START + pct * _MANO_SWEEP) * Math.PI / 180;
    var needle   = el.querySelector('.manoNeedle');
    if (needle) {
        needle.setAttribute('x2', (_MANO_CX + _MANO_R_NDL * Math.cos(angleRad)).toFixed(2));
        needle.setAttribute('y2', (_MANO_CY + _MANO_R_NDL * Math.sin(angleRad)).toFixed(2));
    }
}

function _tickerResize(el) {
    var outer = el.querySelector('.tickerOuter');
    if (!outer) return;
    var w = outer.clientWidth;
    if (w <= 0) return;
    var s1 = el.querySelector('.tickerSpan1');
    var s2 = el.querySelector('.tickerSpan2');
    if (s1) s1.style.minWidth = w + 'px';
    if (s2) s2.style.minWidth = w + 'px';
}
