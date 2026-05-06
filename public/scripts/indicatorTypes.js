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
        setValue: function (el, val, zc) {
            var v = el.querySelector('.indicatorValue');
            if (!v) return;
            v.textContent = _formatValue(el, val);
            var c = zc || el.dataset.valueColor;
            v.style.color      = c;
            v.style.textShadow = '0 0 10px ' + c;
        },
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
            v.style.textShadow      = _makeShadow(cfg.valueColor);
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    timeIndicator: {
        cardId: '#typeTime',
        isNumeric: false,
        defaultSize: {},
        defaultValueSize: 40,
        setValue: null,
        create: function (el, cfg) {
            var v = document.createElement('div');
            v.className = 'indicatorValue';
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = _valueFontPx(cfg.valueSize);
            v.style.textShadow      = _makeShadow(cfg.valueColor);
            v.textContent           = '00:00:00';
            el.appendChild(v);
        },
        applyEdit: function (el, cfg) {
            var v = el.querySelector('.indicatorValue');
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = _valueFontPx(cfg.valueSize);
            v.style.textShadow      = _makeShadow(cfg.valueColor);
        }
    },

    dateIndicator: {
        cardId: '#typeDate',
        isNumeric: false,
        defaultSize: {},
        defaultValueSize: 28,
        setValue: null,
        create: function (el, cfg) {
            var v = document.createElement('div');
            v.className = 'indicatorValue';
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = _valueFontPx(cfg.valueSize);
            v.style.textShadow      = _makeShadow(cfg.valueColor);
            v.textContent           = 'дд.мм.гг';
            el.appendChild(v);
        },
        applyEdit: function (el, cfg) {
            var v = el.querySelector('.indicatorValue');
            v.style.color           = cfg.valueColor;
            v.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            v.style.fontFamily      = _getFontFamily(cfg.valueFont);
            v.style.fontSize        = _valueFontPx(cfg.valueSize);
            v.style.textShadow      = _makeShadow(cfg.valueColor);
        }
    },

    gaugeIndicator: {
        cardId: '#typeGauge',
        isNumeric: true,
        defaultSize: { width: 200, height: 160 },
        defaultValueSize: 30,
        setValue: function (el, val) {
            var t = el.querySelector('.gaugeValueText');
            if (t) t.textContent = _formatValue(el, val);
            _updateGaugeSvg(el, val);
        },
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
            valText.className        = 'gaugeValueText';
            valText.style.color      = cfg.valueColor;
            valText.style.fontFamily = _getFontFamily(cfg.valueFont);
            valText.style.fontSize   = _valueFontPx(cfg.valueSize);
            valText.style.fontWeight = 'bold';
            valText.style.textShadow = _makeShadow(cfg.valueColor);
            valText.textContent      = _applyFormat(0, cfg.format);
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
            t.style.textShadow = _makeShadow(cfg.valueColor);
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
        setValue: function (el, val) {
            var t = el.querySelector('.tankValueText');
            if (t) t.textContent = _formatValue(el, val);
            _updateTankSvg(el, val);
        },
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
            valText.style.textShadow   = _tankTextShadow(cfg.valueBg) + ', 0 0 20px ' + cfg.valueColor;
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
                t.style.textShadow = _tankTextShadow(cfg.valueBg) + ', 0 0 20px ' + cfg.valueColor;
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
        setValue: function (el, val, zc) {
            var hv = el.querySelector('.hBarValue');
            if (hv) {
                hv.textContent = _formatValue(el, val);
                if (zc) { hv.style.color = zc; hv.style.textShadow = _tankTextShadow(el.dataset.valueBg); }
                else    { hv.style.color = el.dataset.valueColor; hv.style.textShadow = ''; }
            }
            _updateHBar(el, val);
        },
        create: function (el, cfg) {
            var wrapper = document.createElement('div');
            wrapper.className             = 'hBarWrapper';
            wrapper.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            wrapper.style.fontSize        = _valueFontPx(cfg.valueSize);

            var track = document.createElement('div');
            track.className = 'hBarTrack';

            var fill = document.createElement('div');
            fill.className             = 'hBarFill';
            fill.style.backgroundColor = cfg.valueColor;
            fill.style.boxShadow       = '0 0 14px ' + cfg.valueColor + ', inset 0 0 8px rgba(255,255,255,0.06)';

            var valText = document.createElement('span');
            valText.className        = 'hBarValue';
            valText.style.color      = cfg.valueColor;
            valText.style.fontFamily = _getFontFamily(cfg.valueFont);
            valText.style.fontSize   = _valueFontPx(cfg.valueSize);
            valText.style.textShadow = _makeBarShadow(cfg.valueColor);
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
            if (fill) {
                fill.style.backgroundColor = cfg.valueColor;
                fill.style.boxShadow       = '0 0 14px ' + cfg.valueColor + ', inset 0 0 8px rgba(255,255,255,0.06)';
            }
            var val = el.querySelector('.hBarValue');
            if (val) {
                val.style.color      = cfg.valueColor;
                val.style.fontFamily = _getFontFamily(cfg.valueFont);
                val.style.fontSize   = _valueFontPx(cfg.valueSize);
                val.style.textShadow = _makeBarShadow(cfg.valueColor);
            }
            var wrapper = el.querySelector('.hBarWrapper');
            if (wrapper) {
                wrapper.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
                wrapper.style.fontSize        = _valueFontPx(cfg.valueSize);
            }
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    vProgressIndicator: {
        cardId: '#typeVProgress',
        isNumeric: true,
        defaultSize: { width: 80, height: 220 },
        defaultValueSize: 26,
        setValue: function (el, val, zc) {
            var vv = el.querySelector('.vBarValue');
            if (vv) {
                vv.textContent = _formatValue(el, val);
                if (zc) { vv.style.color = zc; vv.style.textShadow = _tankTextShadow(el.dataset.valueBg); }
                else    { vv.style.color = el.dataset.valueColor; vv.style.textShadow = ''; }
            }
            _updateVBar(el, val);
        },
        create: function (el, cfg) {
            var wrapper = document.createElement('div');
            wrapper.className             = 'vBarWrapper';
            wrapper.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            wrapper.style.fontSize        = _valueFontPx(cfg.valueSize);

            var maxLbl = document.createElement('span');
            maxLbl.className   = 'vBarMax';
            maxLbl.textContent = cfg.rangeMax !== null ? cfg.rangeMax : 100;

            var track = document.createElement('div');
            track.className = 'vBarTrack';

            var fill = document.createElement('div');
            fill.className             = 'vBarFill';
            fill.style.backgroundColor = cfg.valueColor;
            fill.style.boxShadow       = '0 0 14px ' + cfg.valueColor + ', inset 0 0 8px rgba(255,255,255,0.06)';

            var valText = document.createElement('span');
            valText.className        = 'vBarValue';
            valText.style.color      = cfg.valueColor;
            valText.style.fontFamily = _getFontFamily(cfg.valueFont);
            valText.style.fontSize   = _valueFontPx(cfg.valueSize);
            valText.style.textShadow = _makeBarShadow(cfg.valueColor);
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
            if (fill) {
                fill.style.backgroundColor = cfg.valueColor;
                fill.style.boxShadow       = '0 0 14px ' + cfg.valueColor + ', inset 0 0 8px rgba(255,255,255,0.06)';
            }
            var val = el.querySelector('.vBarValue');
            if (val) {
                val.style.color      = cfg.valueColor;
                val.style.fontFamily = _getFontFamily(cfg.valueFont);
                val.style.fontSize   = _valueFontPx(cfg.valueSize);
                val.style.textShadow = _makeBarShadow(cfg.valueColor);
            }
            var wrapper = el.querySelector('.vBarWrapper');
            if (wrapper) {
                wrapper.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
                wrapper.style.fontSize        = _valueFontPx(cfg.valueSize);
            }
            setIndicatorValue(el, el._currentValue !== undefined ? el._currentValue : 0);
        }
    },

    tickerIndicator: {
        cardId: '#typeTicker',
        isNumeric: false,
        lockParam: false,
        defaultSize: { width: 300, height: 80 },
        defaultValueSize: 28,
        setValue: function (el, val) {
            var txt = val !== undefined && val !== null ? String(val) : '';
            el._currentValue = txt;
            var s1 = el.querySelector('.tickerSpan1');
            var s2 = el.querySelector('.tickerSpan2');
            if (s1) s1.textContent = txt;
            if (s2) s2.textContent = txt;
            _tickerResize(el);
        },
        create: function (el, cfg) {
            var outer = document.createElement('div');
            outer.className             = 'tickerOuter';
            outer.style.color           = cfg.valueColor;
            outer.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            outer.style.fontSize        = _valueFontPx(cfg.valueSize);

            var inner = document.createElement('div');
            inner.className               = 'tickerInner';
            inner.style.fontFamily        = _getFontFamily(cfg.valueFont);
            inner.style.fontSize          = _valueFontPx(cfg.valueSize);
            inner.style.textShadow        = _makeBarShadow(cfg.valueColor);
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
                el._tickerObserver = new ResizeObserver(function () { _tickerResize(el); });
                el._tickerObserver.observe(outer);
            }
        },
        applyEdit: function (el, cfg) {
            var outer = el.querySelector('.tickerOuter');
            if (outer) {
                outer.style.color           = cfg.valueColor;
                outer.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
                outer.style.fontSize        = _valueFontPx(cfg.valueSize);
            }
            var inner = el.querySelector('.tickerInner');
            if (inner) {
                inner.style.fontFamily        = _getFontFamily(cfg.valueFont);
                inner.style.fontSize          = _valueFontPx(cfg.valueSize);
                inner.style.textShadow        = _makeBarShadow(cfg.valueColor);
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
        setValue: function (el, val) {
            var t = el.querySelector('.manoValueText');
            if (t) t.textContent = _formatValue(el, val);
            _updateManoSvg(el, val);
        },
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
            valText.style.textShadow = _makeShadow(cfg.valueColor);
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
                t.style.textShadow = _makeShadow(cfg.valueColor);
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
        defaultSize: { width: 480, height: 280 },
        defaultValueSize: 12,

        create: function (el, cfg) {
            // Lock header to a fixed title
            var header = el.querySelector('.indicatorHeader');
            if (header) {
                header.textContent = 'История сигнализаций';
                el.dataset.headerText = 'История сигнализаций';
            }

            el.dataset.ahShowTrigger = cfg.showTrigger !== false ? '1' : '0';
            el.dataset.ahShowClear   = cfg.showClear   !== false ? '1' : '0';
            el.dataset.ahShowAck     = cfg.showAck     !== false ? '1' : '0';

            var wrap = document.createElement('div');
            wrap.className = 'ahWrap';
            if (cfg.valueFont) wrap.style.fontFamily = _getFontFamily(cfg.valueFont);
            if (cfg.valueSize) wrap.style.fontSize   = cfg.valueSize + 'px';

            var log_div = document.createElement('div');
            log_div.className = 'ahLog';
            wrap.appendChild(log_div);
            el.appendChild(wrap);

            function _pad(n) { return n < 10 ? '0' + n : String(n); }
            function _fmtTime(ts) {
                var d = ts instanceof Date ? ts : new Date(ts);
                return _pad(d.getHours()) + ':' + _pad(d.getMinutes()) + ':' + _pad(d.getSeconds());
            }
            function _fmtDate(ts) {
                var d = ts instanceof Date ? ts : new Date(ts);
                return _pad(d.getDate()) + '.' + _pad(d.getMonth() + 1) + '.' + d.getFullYear();
            }

            function _render() {
                if (!el.isConnected) {
                    document.removeEventListener('alarmLogUpdate', _render);
                    return;
                }
                var showTrigger = el.dataset.ahShowTrigger !== '0';
                var showClear   = el.dataset.ahShowClear   !== '0';
                var showAck     = el.dataset.ahShowAck     !== '0';
                var all = window.getAlarmLog ? window.getAlarmLog() : [];
                var entries = all.filter(function(e) {
                    if (e.event === 'trigger') return showTrigger;
                    if (e.event === 'clear')   return showClear;
                    return showAck;
                });
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

                    var badgeText, badgeCls;
                    if (e.event === 'trigger')    { badgeText = 'ТРЕВОГА'; badgeCls = 'ahBadge ahBadge--trigger'; }
                    else if (e.event === 'clear') { badgeText = 'СБРОС';   badgeCls = 'ahBadge ahBadge--clear'; }
                    else                          { badgeText = 'КВИТ.';   badgeCls = 'ahBadge ahBadge--ack'; }

                    var valStr = typeof e.value === 'number' ? e.value.toFixed(2) : String(e.value);
                    var accentColor = e.color || '#f85149';

                    var row = document.createElement('div');
                    row.className = 'ahEntry';
                    row.style.borderLeftColor = accentColor;

                    var left = document.createElement('div');
                    left.className = 'ahLeft';

                    var timeSpan = document.createElement('span');
                    timeSpan.className   = 'ahTime';
                    timeSpan.textContent = _fmtTime(e.ts);

                    var dateSpan = document.createElement('span');
                    dateSpan.className   = 'ahDate';
                    dateSpan.textContent = _fmtDate(e.ts);

                    left.appendChild(timeSpan);
                    left.appendChild(dateSpan);

                    var badge = document.createElement('span');
                    badge.className   = badgeCls;
                    badge.textContent = badgeText;

                    var right = document.createElement('div');
                    right.className = 'ahRight';

                    var nameSpan = document.createElement('span');
                    nameSpan.className   = 'ahName';
                    nameSpan.textContent = e.name;

                    var valSpan = document.createElement('span');
                    valSpan.className   = 'ahVal';
                    valSpan.textContent = valStr;

                    right.appendChild(nameSpan);
                    right.appendChild(valSpan);

                    row.appendChild(left);
                    row.appendChild(badge);
                    row.appendChild(right);
                    log_div.appendChild(row);
                }
            }

            setTimeout(_render, 0);
            document.addEventListener('alarmLogUpdate', _render);
            el._ahRender = _render;
        },

        applyEdit: function (el, cfg) {
            var header = el.querySelector('.indicatorHeader');
            var wrap   = el.querySelector('.ahWrap');
            if (header) {
                if (cfg.headerFont !== undefined) header.style.fontFamily = _getFontFamily(cfg.headerFont);
                if (cfg.headerSize !== undefined) header.style.fontSize   = cfg.headerSize + 'px';
            }
            if (wrap) {
                if (cfg.valueFont !== undefined) wrap.style.fontFamily = _getFontFamily(cfg.valueFont);
                if (cfg.valueSize !== undefined) wrap.style.fontSize   = cfg.valueSize + 'px';
            }
            if (cfg.showTrigger !== undefined) el.dataset.ahShowTrigger = cfg.showTrigger ? '1' : '0';
            if (cfg.showClear   !== undefined) el.dataset.ahShowClear   = cfg.showClear   ? '1' : '0';
            if (cfg.showAck     !== undefined) el.dataset.ahShowAck     = cfg.showAck     ? '1' : '0';
            if (el._ahRender) el._ahRender();
        }
    },

};
