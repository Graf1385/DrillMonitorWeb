// ── Indicator type registry ───────────────────────────────────────────────────
// Relies on helpers defined in indicatorHelpers.js (loaded before this file).
// Methods reference setIndicatorValue and _checkAlarm from items.js — resolved
// at call time (after full page load).

var _indicatorTypes = {

    digitalIndicator: {
        cardId: '#typeDigital',
        isNumeric: true,
        defaultSize: {},
        defaultValueSize: 30,
        create: function (el, cfg) {
            var v = document.createElement('div');
            v.className = 'indicatorValue';
            _applyToValue(v, cfg, 0);
            v.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            el.appendChild(v);
        },
        applyEdit: function (el, cfg) {
            var v = el.querySelector('.indicatorValue');
            if (!v) return;
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = _valueFontPx(cfg.valueSize);
            v.style.textShadow      = '0 0 10px ' + cfg.valueColor;
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    timeIndicator: {
        cardId: '#typeTime',
        isNumeric: false,
        defaultSize: {},
        defaultValueSize: 40,
        create: function (el, cfg) {
            var v = document.createElement('div');
            v.className = 'indicatorValue';
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = _valueFontPx(cfg.valueSize);
            v.style.textShadow      = '0 0 10px ' + cfg.valueColor;
            v.textContent           = '00:00:00';
            el.appendChild(v);
        },
        applyEdit: function (el, cfg) {
            var v = el.querySelector('.indicatorValue');
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = _valueFontPx(cfg.valueSize);
            v.style.textShadow      = '0 0 10px ' + cfg.valueColor;
        }
    },

    dateIndicator: {
        cardId: '#typeDate',
        isNumeric: false,
        defaultSize: {},
        defaultValueSize: 28,
        create: function (el, cfg) {
            var v = document.createElement('div');
            v.className = 'indicatorValue';
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = _valueFontPx(cfg.valueSize);
            v.style.textShadow      = '0 0 10px ' + cfg.valueColor;
            v.textContent           = 'дд.мм.гг';
            el.appendChild(v);
        },
        applyEdit: function (el, cfg) {
            var v = el.querySelector('.indicatorValue');
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = _valueFontPx(cfg.valueSize);
            v.style.textShadow      = '0 0 10px ' + cfg.valueColor;
        }
    },

    gaugeIndicator: {
        cardId: '#typeGauge',
        isNumeric: true,
        defaultSize: { width: 200, height: 160 },
        defaultValueSize: 30,
        create: function (el, cfg) {
            var NS  = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', '0 0 200 115');
            svg.setAttribute('class', 'gaugeSvg');
            svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
            svg.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);

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

            svg.appendChild(mkArc('gaugeTrack',      '#14202e', _GAUGE_L + ' ' + _GAUGE_L, 0));
            svg.appendChild(mkArc('gaugeGreenDim',   '#0a2212', '147.02 ' + _GAUGE_L,      0));
            svg.appendChild(mkArc('gaugeYellowDim',  '#221900', '49.01 '  + _GAUGE_L,      -147.02));
            svg.appendChild(mkArc('gaugeRedDim',     '#220606', '49.01 '  + _GAUGE_L,      -196.03));
            svg.appendChild(mkArc('gaugeGreenProg',  '#3fb950', '0 '      + _GAUGE_L,      0));
            svg.appendChild(mkArc('gaugeYellowProg', '#d29922', '0 '      + _GAUGE_L,      -147.02));
            svg.appendChild(mkArc('gaugeRedProg',    '#f85149', '0 '      + _GAUGE_L,      -196.03));

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

            svg.appendChild(mkText('gaugeMinLabel',  16,  109, 9, '#6e7681', cfg.rangeMin !== null ? cfg.rangeMin : 0));
            svg.appendChild(mkText('gaugeMaxLabel', 184,  109, 9, '#6e7681', cfg.rangeMax !== null ? cfg.rangeMax : 100));

            var gaugeWrapper = document.createElement('div');
            gaugeWrapper.className = 'gaugeWrapper';
            gaugeWrapper.appendChild(svg);

            var valText = document.createElement('span');
            valText.className       = 'gaugeValueText';
            valText.style.color     = cfg.valueColor;
            valText.style.fontFamily = _getFontFamily(cfg.valueFont);
            valText.style.fontSize  = _valueFontPx(cfg.valueSize);
            valText.style.fontWeight = 'bold';
            valText.textContent     = _applyFormat(0, cfg.format);
            gaugeWrapper.appendChild(valText);

            el.appendChild(gaugeWrapper);
            _updateGaugeSvg(el, 0);
        },
        applyEdit: function (el, cfg) {
            var t = el.querySelector('.gaugeValueText');
            if (!t) return;
            t.style.color      = cfg.valueColor;
            t.style.fontFamily = _getFontFamily(cfg.valueFont);
            t.style.fontSize   = _valueFontPx(cfg.valueSize);
            var svg = el.querySelector('.gaugeSvg');
            if (svg) svg.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            var seg = el.querySelector('.gaugeSeg');
            if (seg) seg.setAttribute('stroke', cfg.valueBg);
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    tankIndicator: {
        cardId: '#typeTank',
        isNumeric: true,
        defaultSize: { width: 120, height: 200 },
        defaultValueSize: 28,
        create: function (el, cfg) {
            var NS  = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', '18 3 66 104');
            svg.setAttribute('class', 'tankSvg');
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);

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
            fills.appendChild(mkRect('tankDimBg', _TANK_X, _TANK_Y, _TANK_W, _TANK_H, '#0b1220'));

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
            valText.style.fontSize     = _valueFontPx(cfg.valueSize);
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
                t.style.fontSize   = _valueFontPx(cfg.valueSize);
                t.style.textShadow = _tankTextShadow(cfg.valueBg);
            }
            var svg = el.querySelector('.tankSvg');
            if (svg) svg.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            var border = el.querySelector('.tankBorder');
            if (border) border.setAttribute('stroke', cfg.valueColor);
            var prog = el.querySelector('.tankProg');
            if (prog) prog.setAttribute('fill', cfg.valueColor);
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    hProgressIndicator: {
        cardId: '#typeHProgress',
        isNumeric: true,
        defaultSize: { width: 260, height: 100 },
        defaultValueSize: 24,
        create: function (el, cfg) {
            var wrapper = document.createElement('div');
            wrapper.className             = 'hBarWrapper';
            wrapper.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);

            var track = document.createElement('div');
            track.className = 'hBarTrack';

            var fill = document.createElement('div');
            fill.className            = 'hBarFill';
            fill.style.backgroundColor = cfg.valueColor;
            fill.style.boxShadow       = '0 0 8px ' + cfg.valueColor;

            var valText = document.createElement('span');
            valText.className        = 'hBarValue';
            valText.style.color      = cfg.valueColor;
            valText.style.fontFamily = _getFontFamily(cfg.valueFont);
            valText.style.fontSize   = _valueFontPx(cfg.valueSize);
            valText.style.textShadow = _tankTextShadow(cfg.valueBg);
            valText.textContent      = _applyFormat(0, cfg.format);

            track.appendChild(fill);
            track.appendChild(valText);

            var labels = document.createElement('div');
            labels.className = 'hBarLabels';

            var minLbl = document.createElement('span');
            minLbl.className   = 'hBarMin';
            minLbl.textContent = cfg.rangeMin !== null ? cfg.rangeMin : 0;

            var maxLbl = document.createElement('span');
            maxLbl.className   = 'hBarMax';
            maxLbl.textContent = cfg.rangeMax !== null ? cfg.rangeMax : 100;

            labels.appendChild(minLbl);
            labels.appendChild(maxLbl);
            wrapper.appendChild(track);
            wrapper.appendChild(labels);
            el.appendChild(wrapper);
            _updateHBar(el, 0);
        },
        applyEdit: function (el, cfg) {
            var fill = el.querySelector('.hBarFill');
            if (fill) { fill.style.backgroundColor = cfg.valueColor; fill.style.boxShadow = '0 0 8px ' + cfg.valueColor; }
            var val = el.querySelector('.hBarValue');
            if (val) { val.style.color = cfg.valueColor; val.style.fontFamily = _getFontFamily(cfg.valueFont); val.style.fontSize = _valueFontPx(cfg.valueSize); val.style.textShadow = _tankTextShadow(cfg.valueBg); }
            var wrapper = el.querySelector('.hBarWrapper');
            if (wrapper) wrapper.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    vProgressIndicator: {
        cardId: '#typeVProgress',
        isNumeric: true,
        defaultSize: { width: 80, height: 220 },
        defaultValueSize: 26,
        create: function (el, cfg) {
            var wrapper = document.createElement('div');
            wrapper.className             = 'vBarWrapper';
            wrapper.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);

            var maxLbl = document.createElement('span');
            maxLbl.className   = 'vBarMax';
            maxLbl.textContent = cfg.rangeMax !== null ? cfg.rangeMax : 100;

            var track = document.createElement('div');
            track.className = 'vBarTrack';

            var fill = document.createElement('div');
            fill.className             = 'vBarFill';
            fill.style.backgroundColor = cfg.valueColor;
            fill.style.boxShadow       = '0 0 8px ' + cfg.valueColor;

            var valText = document.createElement('span');
            valText.className        = 'vBarValue';
            valText.style.color      = cfg.valueColor;
            valText.style.fontFamily = _getFontFamily(cfg.valueFont);
            valText.style.fontSize   = _valueFontPx(cfg.valueSize);
            valText.style.textShadow = _tankTextShadow(cfg.valueBg);
            valText.textContent      = _applyFormat(0, cfg.format);

            track.appendChild(fill);
            track.appendChild(valText);

            var minLbl = document.createElement('span');
            minLbl.className   = 'vBarMin';
            minLbl.textContent = cfg.rangeMin !== null ? cfg.rangeMin : 0;

            wrapper.appendChild(maxLbl);
            wrapper.appendChild(track);
            wrapper.appendChild(minLbl);
            el.appendChild(wrapper);
            _updateVBar(el, 0);
        },
        applyEdit: function (el, cfg) {
            var fill = el.querySelector('.vBarFill');
            if (fill) { fill.style.backgroundColor = cfg.valueColor; fill.style.boxShadow = '0 0 8px ' + cfg.valueColor; }
            var val = el.querySelector('.vBarValue');
            if (val) { val.style.color = cfg.valueColor; val.style.fontFamily = _getFontFamily(cfg.valueFont); val.style.fontSize = _valueFontPx(cfg.valueSize); val.style.textShadow = _tankTextShadow(cfg.valueBg); }
            var wrapper = el.querySelector('.vBarWrapper');
            if (wrapper) wrapper.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    tickerIndicator: {
        cardId: '#typeTicker',
        isNumeric: false,
        lockParam: false,
        defaultSize: { width: 300, height: 80 },
        defaultValueSize: 28,
        create: function (el, cfg) {
            var outer = document.createElement('div');
            outer.className             = 'tickerOuter';
            outer.style.color           = cfg.valueColor;
            outer.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);

            var inner = document.createElement('div');
            inner.className               = 'tickerInner';
            inner.style.fontFamily        = _getFontFamily(cfg.valueFont);
            inner.style.fontSize          = _valueFontPx(cfg.valueSize);
            inner.style.textShadow        = '0 0 8px ' + cfg.valueColor;
            inner.style.animationDuration = (cfg.tickerSpeed || 12) + 's';

            var s1 = document.createElement('span');
            s1.className   = 'tickerSpan1';
            s1.textContent = '— здесь могла быть ваша реклама —';

            var s2 = document.createElement('span');
            s2.className   = 'tickerSpan2';
            s2.textContent = '— здесь могла быть ваша реклама —';

            inner.appendChild(s1);
            inner.appendChild(s2);
            outer.appendChild(inner);
            el.appendChild(outer);
            setTimeout(function () { _tickerResize(el); }, 0);
            if (window.ResizeObserver) {
                new ResizeObserver(function () { _tickerResize(el); }).observe(outer);
            }
        },
        applyEdit: function (el, cfg) {
            var outer = el.querySelector('.tickerOuter');
            if (outer) {
                outer.style.color           = cfg.valueColor;
                outer.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            }
            var inner = el.querySelector('.tickerInner');
            if (inner) {
                inner.style.fontFamily        = _getFontFamily(cfg.valueFont);
                inner.style.fontSize          = _valueFontPx(cfg.valueSize);
                inner.style.textShadow        = '0 0 8px ' + cfg.valueColor;
                inner.style.animationDuration = (cfg.tickerSpeed || 12) + 's';
            }
            _tickerResize(el);
        }
    },

    manometerIndicator: {
        cardId: '#typeManometer',
        isNumeric: true,
        defaultSize: { width: 200, height: 210 },
        defaultValueSize: 28,
        create: function (el, cfg) {
            var NS  = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', '0 0 200 185');
            svg.setAttribute('class', 'manoSvg');
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            svg.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);

            function mkArc(cls, stroke, dashArray, dashOffset) {
                var p = document.createElementNS(NS, 'path');
                p.setAttribute('d', _MANO_ARC);
                p.setAttribute('fill', 'none');
                p.setAttribute('stroke', stroke);
                p.setAttribute('stroke-width', '14');
                p.setAttribute('stroke-linecap', 'butt');
                p.setAttribute('class', cls);
                p.setAttribute('stroke-dasharray', dashArray);
                if (dashOffset) p.setAttribute('stroke-dashoffset', String(dashOffset));
                return p;
            }

            svg.appendChild(mkArc('manoTrack',      '#14202e', _MANO_L + ' ' + _MANO_L, 0));
            svg.appendChild(mkArc('manoGreenDim',   '#0a2212', '197.92 ' + _MANO_L,     0));
            svg.appendChild(mkArc('manoYellowDim',  '#221900', '65.97 '  + _MANO_L,     -_MANO_GREEN));
            svg.appendChild(mkArc('manoRedDim',     '#220606', '65.98 '  + _MANO_L,     -_MANO_YELLOW));
            svg.appendChild(mkArc('manoGreenProg',  '#3fb950', '0 '      + _MANO_L,     0));
            svg.appendChild(mkArc('manoYellowProg', '#d29922', '0 '      + _MANO_L,     -_MANO_GREEN));
            svg.appendChild(mkArc('manoRedProg',    '#f85149', '0 '      + _MANO_L,     -_MANO_YELLOW));

            var segGap    = 3;
            var segPeriod = _MANO_L / 10;
            var segInner  = (segPeriod - segGap).toFixed(3);
            var segFirst  = (segPeriod - segGap / 2).toFixed(3);
            var segDash   = '0 ' + segFirst;
            for (var si = 0; si < 8; si++) segDash += ' ' + segGap + ' ' + segInner;
            segDash += ' ' + segGap + ' ' + segFirst;
            var seg = document.createElementNS(NS, 'path');
            seg.setAttribute('d', _MANO_ARC);
            seg.setAttribute('fill', 'none');
            seg.setAttribute('stroke', cfg.valueBg);
            seg.setAttribute('stroke-width', '16');
            seg.setAttribute('stroke-linecap', 'butt');
            seg.setAttribute('class', 'manoSeg');
            seg.setAttribute('stroke-dasharray', segDash);
            svg.appendChild(seg);

            var needle = document.createElementNS(NS, 'line');
            needle.setAttribute('class', 'manoNeedle');
            needle.setAttribute('x1', String(_MANO_CX));
            needle.setAttribute('y1', String(_MANO_CY));
            needle.setAttribute('x2', String(_MANO_CX));
            needle.setAttribute('y2', String(_MANO_CY));
            needle.setAttribute('stroke', cfg.valueColor);
            needle.setAttribute('stroke-width', '2.5');
            needle.setAttribute('stroke-linecap', 'round');
            svg.appendChild(needle);

            var hub = document.createElementNS(NS, 'circle');
            hub.setAttribute('class', 'manoHub');
            hub.setAttribute('cx', String(_MANO_CX));
            hub.setAttribute('cy', String(_MANO_CY));
            hub.setAttribute('r', '6');
            hub.setAttribute('fill', cfg.valueColor);
            hub.setAttribute('stroke', cfg.valueBg);
            hub.setAttribute('stroke-width', '2');
            svg.appendChild(hub);

            function mkLbl(cls, x, y, anchor, content) {
                var t = document.createElementNS(NS, 'text');
                t.setAttribute('class', cls);
                t.setAttribute('x', String(x));
                t.setAttribute('y', String(y));
                t.setAttribute('text-anchor', anchor);
                t.setAttribute('dominant-baseline', 'middle');
                t.setAttribute('fill', '#6e7681');
                t.setAttribute('font-size', '9');
                t.textContent = content;
                return t;
            }
            svg.appendChild(mkLbl('manoMinLabel', 38,  172, 'middle', cfg.rangeMin !== null ? cfg.rangeMin : 0));
            svg.appendChild(mkLbl('manoMaxLabel', 162, 172, 'middle', cfg.rangeMax !== null ? cfg.rangeMax : 100));

            var manoWrapper = document.createElement('div');
            manoWrapper.className = 'manoWrapper';
            manoWrapper.appendChild(svg);

            var valText = document.createElement('span');
            valText.className        = 'manoValueText';
            valText.style.color      = cfg.valueColor;
            valText.style.fontFamily = _getFontFamily(cfg.valueFont);
            valText.style.fontSize   = _valueFontPx(cfg.valueSize);
            valText.style.fontWeight = 'bold';
            valText.textContent      = _applyFormat(0, cfg.format);
            manoWrapper.appendChild(valText);

            el.appendChild(manoWrapper);
            _updateManoSvg(el, 0);
        },
        applyEdit: function (el, cfg) {
            var t = el.querySelector('.manoValueText');
            if (t) {
                t.style.color      = cfg.valueColor;
                t.style.fontFamily = _getFontFamily(cfg.valueFont);
                t.style.fontSize   = _valueFontPx(cfg.valueSize);
            }
            var svg = el.querySelector('.manoSvg');
            if (svg) svg.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            var seg = el.querySelector('.manoSeg');
            if (seg) seg.setAttribute('stroke', cfg.valueBg);
            var needle = el.querySelector('.manoNeedle');
            if (needle) needle.setAttribute('stroke', cfg.valueColor);
            var hub = el.querySelector('.manoHub');
            if (hub) { hub.setAttribute('fill', cfg.valueColor); hub.setAttribute('stroke', cfg.valueBg); }
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    // ── Video indicator ───────────────────────────────────────────────────────
    // DOM is built by videoWidget.js (_buildVideoElement / _applyVideoConfig).
    // This stub exists so _getIndicatorType() recognises the class name.
    videoIndicator: {
        cardId:      '#typeVideo',
        isNumeric:   false,
        defaultSize: { width: 320, height: 240 },
        create:      function () {},
        applyEdit:   function () {}
    },

    // ── Alarm History Indicator ───────────────────────────────────────────────
    alarmHistoryIndicator: {
        cardId:      '#typeAlarmHistory',
        isNumeric:   false,
        defaultSize: { width: 420, height: 260 },
        defaultValueSize: 13,

        create: function (el, cfg) {
            var wrap = document.createElement('div');
            wrap.className = 'ahWrap';
            wrap.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            wrap.style.color           = cfg.valueColor;
            wrap.style.fontFamily      = _getFontFamily(cfg.valueFont);
            wrap.style.fontSize        = _valueFontPx(cfg.valueSize);

            var log_div = document.createElement('div');
            log_div.className = 'ahLog';
            wrap.appendChild(log_div);
            el.appendChild(wrap);

            function _pad(n) { return n < 10 ? '0' + n : String(n); }
            function _fmt(ts) {
                var d = ts instanceof Date ? ts : new Date(ts);
                return '[' + _pad(d.getHours()) + ':' + _pad(d.getMinutes()) + ':' + _pad(d.getSeconds())
                     + ' ' + _pad(d.getDate()) + '.' + _pad(d.getMonth() + 1) + '.' + d.getFullYear() + ']';
            }

            function _render() {
                if (!el.isConnected) {
                    document.removeEventListener('alarmLogUpdate', _render);
                    return;
                }
                var entries = window.getAlarmLog ? window.getAlarmLog() : [];
                log_div.innerHTML = '';
                if (!entries.length) {
                    var empty = document.createElement('div');
                    empty.className   = 'ahEmpty';
                    empty.textContent = 'Нет событий';
                    log_div.appendChild(empty);
                    return;
                }
                for (var i = 0; i < entries.length; i++) {
                    var e = entries[i];

                    var eventStr, eventColor;
                    if (e.event === 'trigger')      { eventStr = '⚡ Тревога'; eventColor = '#f85149'; }
                    else if (e.event === 'clear')   { eventStr = '✓ Сброс';   eventColor = '#3fb950'; }
                    else                            { eventStr = '⚠ Квит.';   eventColor = '#d29922'; }

                    var valStr = typeof e.value === 'number' ? e.value.toFixed(2) : String(e.value);

                    var row = document.createElement('div');
                    row.className = 'ahEntry';

                    var tsSpan = document.createElement('span');
                    tsSpan.className   = 'ahTs';
                    tsSpan.textContent = _fmt(e.ts);

                    var dotSpan = document.createElement('span');
                    dotSpan.className   = 'ahDot';
                    dotSpan.textContent = ' ■ ';
                    dotSpan.style.color = e.color || cfg.valueColor;

                    var evtSpan = document.createElement('span');
                    evtSpan.className   = 'ahEvt';
                    evtSpan.textContent = eventStr;
                    evtSpan.style.color = eventColor;

                    var msgSpan = document.createElement('span');
                    msgSpan.className   = 'ahMsg';
                    msgSpan.textContent = ' — ' + e.name + ' = ' + valStr;

                    row.appendChild(tsSpan);
                    row.appendChild(dotSpan);
                    row.appendChild(evtSpan);
                    row.appendChild(msgSpan);
                    log_div.appendChild(row);
                }
            }

            _render();
            document.addEventListener('alarmLogUpdate', _render);
        },

        applyEdit: function (el, cfg) {
            var wrap = el.querySelector('.ahWrap');
            if (!wrap) return;
            wrap.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            wrap.style.color           = cfg.valueColor;
            wrap.style.fontFamily      = _getFontFamily(cfg.valueFont);
            wrap.style.fontSize        = _valueFontPx(cfg.valueSize);
        }
    },

    // ── Alarm Panel Indicator ─────────────────────────────────────────────────
    // Invisible in the workspace when calm. On alarm: projects a fixed, full-
    // screen-centred red panel that cannot be closed or moved by the operator.
    alarmPanelIndicator: {
        cardId:      '#typeAlarmPanel',
        isNumeric:   true,
        defaultSize: { width: 400, height: 300 },
        defaultValueSize: 40,

        create: function (el, cfg) {
            // Compact badge that lives in the workspace
            var body = document.createElement('div');
            body.className = 'alarmPanelBody';

            var NS  = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('width', '18');
            svg.setAttribute('height', '18');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.setAttribute('stroke-linecap', 'round');
            svg.innerHTML =
                '<polygon points="12,2 22,20 2,20"/>' +
                '<line x1="12" y1="9" x2="12" y2="13"/>' +
                '<circle cx="12" cy="17" r="0.5" fill="currentColor"/>';
            body.appendChild(svg);
            el.appendChild(body);

            // Build the fixed overlay — attached directly to <body>
            var overlay = _buildAlarmOverlay(cfg);
            document.body.appendChild(overlay);
            el._alarmOverlay = overlay;

            // Watch for alarm-active / alarm-acked class changes on the indicator
            var observer = new MutationObserver(function () {
                var active = el.classList.contains('alarm-active') ||
                             el.classList.contains('alarm-acked');
                overlay.style.display = active ? 'flex' : 'none';
            });
            observer.observe(el, { attributes: true, attributeFilter: ['class'] });
            el._alarmObserver = observer;
        },

        applyEdit: function (el, cfg) {
            var overlay = el._alarmOverlay;
            if (!overlay) return;

            var title = overlay.querySelector('.apTitle');
            if (title) {
                title.textContent  = cfg.headerText || '';
                title.style.fontFamily = _getFontFamily(cfg.headerFont);
                title.style.fontSize   = Math.max(16, (cfg.headerSize || 14) * 1.5) + 'px';
                title.style.color      = cfg.headerColor || '#ffbcbc';
            }

            var val = overlay.querySelector('.apValue');
            if (val) {
                val.style.fontFamily = _getFontFamily(cfg.valueFont);
                val.style.fontSize   = Math.max(48, (cfg.valueSize || 48) * 1.4) + 'px';
            }

            var units = overlay.querySelector('.apUnits');
            if (units) {
                units.textContent    = cfg.units || '';
                units.style.display  = cfg.units ? '' : 'none';
            }

            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    }

};

// ── Alarm overlay DOM builder ─────────────────────────────────────────────────

function _buildAlarmOverlay(cfg) {
    var overlay = document.createElement('div');
    overlay.className    = 'alarmPanelOverlay';
    overlay.style.display = 'none';

    // Top bar  —  blinking "ТРЕВОГА" label
    var topBar = document.createElement('div');
    topBar.className = 'apTopBar';

    var lbl1 = document.createElement('span');
    lbl1.className   = 'apTopLabel';
    lbl1.textContent = '⚠ тревога';

    var div1 = document.createElement('div');
    div1.className = 'apTopDivider';

    var lbl2 = document.createElement('span');
    lbl2.className   = 'apTopLabel';
    lbl2.textContent = 'тревога ⚠';

    topBar.appendChild(lbl1);
    topBar.appendChild(div1);
    topBar.appendChild(lbl2);

    // Main body — title + value
    var main = document.createElement('div');
    main.className = 'apMain';

    var title = document.createElement('div');
    title.className      = 'apTitle';
    title.textContent    = cfg.headerText || '';
    title.style.fontFamily = _getFontFamily(cfg.headerFont);
    title.style.fontSize   = Math.max(16, (cfg.headerSize || 14) * 1.5) + 'px';
    title.style.color      = cfg.headerColor || '#ffbcbc';

    var valLabel = document.createElement('div');
    valLabel.className   = 'apValueLabel';
    valLabel.textContent = 'текущее значение';

    var val = document.createElement('div');
    val.className        = 'apValue';
    val.textContent      = _applyFormat(0, cfg.format || '');
    val.style.fontFamily = _getFontFamily(cfg.valueFont);
    val.style.fontSize   = Math.max(48, (cfg.valueSize || 48) * 1.4) + 'px';

    var units = document.createElement('div');
    units.className     = 'apUnits';
    units.textContent   = cfg.units || '';
    units.style.display = cfg.units ? '' : 'none';

    main.appendChild(title);
    main.appendChild(valLabel);
    main.appendChild(val);
    main.appendChild(units);

    // Bottom status bar
    var bottom = document.createElement('div');
    bottom.className = 'apBottomBar';

    var dot = document.createElement('div');
    dot.className = 'apStatusDot';

    var statusTxt = document.createElement('span');
    statusTxt.className   = 'apStatusText';
    statusTxt.textContent = 'активная тревога';

    bottom.appendChild(dot);
    bottom.appendChild(statusTxt);

    overlay.appendChild(topBar);
    overlay.appendChild(main);
    overlay.appendChild(bottom);

    return overlay;
}
