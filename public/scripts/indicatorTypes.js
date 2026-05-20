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
            var c = zc || el.dataset.valueColor;
            if (val == null) {
                v.textContent      = '—';
                v.style.color      = c;
                v.style.textShadow = '0 0 10px ' + c;
                return;
            }
            v.textContent = _formatValue(el, val);
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
        fixedParamId: 52,
        fixedHeader: 'Время сбора данных',
        defaultSize: {},
        defaultValueSize: 40,
        setValue: function (el, epochSeconds) {
            var v = el.querySelector('.indicatorValue');
            if (!v) return;
            if (epochSeconds == null) { v.textContent = '--:--:--'; return; }
            el._lastEpoch = epochSeconds;
            var tz = _settings && _settings.timezone || '';
            var d  = new Date(epochSeconds * 1000);
            if (tz) {
                v.textContent = new Intl.DateTimeFormat('ru-RU', {
                    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
                }).format(d);
            } else {
                function pad(n) { return n < 10 ? '0' + n : String(n); }
                v.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
            }
        },
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
        usesGlobalTime: true,
        defaultSize: {},
        defaultValueSize: 28,
        setValue: function (el, epochSeconds) {
            var v = el.querySelector('.indicatorValue');
            if (!v) return;
            if (epochSeconds == null) { v.textContent = 'дд.мм.гг'; return; }
            el._lastEpoch = epochSeconds;
            var tz = _settings && _settings.timezone || '';
            var d  = new Date(epochSeconds * 1000);
            if (tz) {
                v.textContent = new Intl.DateTimeFormat('ru-RU', {
                    timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric'
                }).format(d);
            } else {
                function pad(n) { return n < 10 ? '0' + n : String(n); }
                v.textContent = pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
            }
        },
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
            if (val == null) { if (t) t.textContent = '—'; return; }
            if (t) t.textContent = _formatValue(el, val);
            _updateGaugeSvg(el, val);
        },
        create: function (el, cfg) {
            var NS  = 'http://www.w3.org/2000/svg';
            var svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', '0 0 200 115');
            svg.setAttribute('class', 'gaugeSvg');
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            svg.style.backgroundColor = _hexToRgba(cfg.valueBg, cfg.valueBgOpacity);
            svg.style.overflow = 'visible';

            function mkArc(cls, stroke, dashArray, dashOffset) {
                var p = document.createElementNS(NS, 'path');
                p.setAttribute('d', _GAUGE_ARC);
                p.setAttribute('fill', 'none');
                p.setAttribute('stroke', stroke);
                p.setAttribute('stroke-width', '14');
                p.setAttribute('stroke-linecap', 'butt');
                p.setAttribute('class', cls);
                p.setAttribute('stroke-dasharray', dashArray);
                if (dashOffset) p.setAttribute('stroke-dashoffset', String(dashOffset));
                return p;
            }

            svg.appendChild(mkArc('gaugeTrack',      '#0b1929', _GAUGE_L + ' ' + _GAUGE_L, 0));
            svg.appendChild(mkArc('gaugeGreenDim',   '#071910', '147.02 ' + _GAUGE_L,      0));
            svg.appendChild(mkArc('gaugeYellowDim',  '#1a1200', '49.01 '  + _GAUGE_L,      -147.02));
            svg.appendChild(mkArc('gaugeRedDim',     '#180505', '49.01 '  + _GAUGE_L,      -196.03));
            svg.appendChild(mkArc('gaugeGreenProg',  '#00d47e', '0 '      + _GAUGE_L,      0));
            svg.appendChild(mkArc('gaugeYellowProg', '#f0a020', '0 '      + _GAUGE_L,      -147.02));
            svg.appendChild(mkArc('gaugeRedProg',    '#ff4444', '0 '      + _GAUGE_L,      -196.03));

            // Radial tick marks outside the arc
            // Arc center (100, 100); θ_i = 180 + i*9° in SVG screen coords (Y-down)
            for (var i = 0; i <= 20; i++) {
                var angRad  = (180 + i * 9) * Math.PI / 180;
                var isMajor = (i % 5 === 0);
                var rOuter  = isMajor ? 93 : 89;
                var cosA = Math.cos(angRad), sinA = Math.sin(angRad);
                var tick = document.createElementNS(NS, 'line');
                tick.setAttribute('x1', (100 + 85 * cosA).toFixed(2));
                tick.setAttribute('y1', (100 + 85 * sinA).toFixed(2));
                tick.setAttribute('x2', (100 + rOuter * cosA).toFixed(2));
                tick.setAttribute('y2', (100 + rOuter * sinA).toFixed(2));
                tick.setAttribute('stroke', isMajor ? '#1e3f64' : '#122033');
                tick.setAttribute('stroke-width', isMajor ? '1.5' : '0.75');
                tick.setAttribute('stroke-linecap', 'round');
                svg.appendChild(tick);
            }

            function mkText(cls, x, y, fontSize, fill, content) {
                var t = document.createElementNS(NS, 'text');
                t.setAttribute('class', cls);
                t.setAttribute('x', String(x));
                t.setAttribute('y', String(y));
                t.setAttribute('text-anchor', 'middle');
                t.setAttribute('dominant-baseline', 'middle');
                t.setAttribute('fill', fill);
                t.setAttribute('font-size', String(fontSize));
                t.setAttribute('font-family', 'monospace');
                t.setAttribute('font-weight', 'normal');
                t.textContent = content;
                return t;
            }

            svg.appendChild(mkText('gaugeMinLabel',  20, 110, 8, '#344e66', cfg.rangeMin !== null ? cfg.rangeMin : 0));
            svg.appendChild(mkText('gaugeMaxLabel', 180, 110, 8, '#344e66', cfg.rangeMax !== null ? cfg.rangeMax : 100));

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
            if (val == null) { if (t) t.textContent = '—'; return; }
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
            if (val == null) { if (hv) hv.textContent = '—'; return; }
            if (hv) {
                hv.textContent = _formatValue(el, val);
                var c = zc || el.dataset.valueColor;
                hv.style.color      = c;
                hv.style.textShadow = _tankTextShadow(el.dataset.valueBg) + ', 0 0 16px ' + c;
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
            valText.style.textShadow = _tankTextShadow(cfg.valueBg) + ', 0 0 16px ' + cfg.valueColor;
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
                val.style.textShadow = _tankTextShadow(cfg.valueBg) + ', 0 0 16px ' + cfg.valueColor;
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
            if (val == null) { if (vv) vv.textContent = '—'; return; }
            if (vv) {
                vv.textContent = _formatValue(el, val);
                var c = zc || el.dataset.valueColor;
                vv.style.color      = c;
                vv.style.textShadow = _tankTextShadow(el.dataset.valueBg) + ', 0 0 16px ' + c;
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
            valText.style.textShadow = _tankTextShadow(cfg.valueBg) + ', 0 0 16px ' + cfg.valueColor;
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
                val.style.textShadow = _tankTextShadow(cfg.valueBg) + ', 0 0 16px ' + cfg.valueColor;
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
            if (val == null) { if (t) t.textContent = '—'; return; }
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
            svg.style.overflow = 'visible';

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

            svg.appendChild(mkArc('manoTrack',      '#0b1929', _MANO_L + ' ' + _MANO_L, 0));
            svg.appendChild(mkArc('manoGreenDim',   '#071910', '197.92 ' + _MANO_L,     0));
            svg.appendChild(mkArc('manoYellowDim',  '#1a1200', '65.97 '  + _MANO_L,     -_MANO_GREEN));
            svg.appendChild(mkArc('manoRedDim',     '#180505', '65.98 '  + _MANO_L,     -_MANO_YELLOW));
            svg.appendChild(mkArc('manoGreenProg',  '#00d47e', '0 '      + _MANO_L,     0));
            svg.appendChild(mkArc('manoYellowProg', '#f0a020', '0 '      + _MANO_L,     -_MANO_GREEN));
            svg.appendChild(mkArc('manoRedProg',    '#ff4444', '0 '      + _MANO_L,     -_MANO_YELLOW));

            // Radial tick marks outside the arc
            // Arc center (100, 105), start 135°, sweep 270°; θ_i = 135 + i*13.5°
            for (var i = 0; i <= 20; i++) {
                var angRad  = (135 + i * 13.5) * Math.PI / 180;
                var isMajor = (i % 5 === 0);
                var rOuter  = isMajor ? 84 : 80;
                var cosA = Math.cos(angRad), sinA = Math.sin(angRad);
                var tick = document.createElementNS(NS, 'line');
                tick.setAttribute('x1', (_MANO_CX + 75 * cosA).toFixed(2));
                tick.setAttribute('y1', (_MANO_CY + 75 * sinA).toFixed(2));
                tick.setAttribute('x2', (_MANO_CX + rOuter * cosA).toFixed(2));
                tick.setAttribute('y2', (_MANO_CY + rOuter * sinA).toFixed(2));
                tick.setAttribute('stroke', isMajor ? '#1e3f64' : '#122033');
                tick.setAttribute('stroke-width', isMajor ? '1.5' : '0.75');
                tick.setAttribute('stroke-linecap', 'round');
                svg.appendChild(tick);
            }

            // Needle: fixed vertical line, rotated via CSS transform
            var needle = document.createElementNS(NS, 'line');
            needle.setAttribute('class', 'manoNeedle');
            needle.setAttribute('x1', String(_MANO_CX));
            needle.setAttribute('y1', String(_MANO_CY));
            needle.setAttribute('x2', String(_MANO_CX));
            needle.setAttribute('y2', String(_MANO_CY - _MANO_R_NDL + 5));
            needle.setAttribute('stroke', cfg.valueColor);
            needle.setAttribute('stroke-width', '1.5');
            needle.setAttribute('stroke-linecap', 'round');
            svg.appendChild(needle);

            // Hub outer decorative ring
            var hubRing = document.createElementNS(NS, 'circle');
            hubRing.setAttribute('class', 'manoHubRing');
            hubRing.setAttribute('cx', String(_MANO_CX));
            hubRing.setAttribute('cy', String(_MANO_CY));
            hubRing.setAttribute('r', '9');
            hubRing.setAttribute('fill', 'none');
            hubRing.setAttribute('stroke', cfg.valueColor);
            hubRing.setAttribute('stroke-width', '0.75');
            hubRing.setAttribute('opacity', '0.35');
            svg.appendChild(hubRing);

            // Hub center dot
            var hub = document.createElementNS(NS, 'circle');
            hub.setAttribute('class', 'manoHub');
            hub.setAttribute('cx', String(_MANO_CX));
            hub.setAttribute('cy', String(_MANO_CY));
            hub.setAttribute('r', '5');
            hub.setAttribute('fill', cfg.valueColor);
            hub.setAttribute('stroke', '#080e18');
            hub.setAttribute('stroke-width', '1.5');
            svg.appendChild(hub);

            function mkLbl(cls, x, y, anchor, content) {
                var t = document.createElementNS(NS, 'text');
                t.setAttribute('class', cls);
                t.setAttribute('x', String(x));
                t.setAttribute('y', String(y));
                t.setAttribute('text-anchor', anchor);
                t.setAttribute('dominant-baseline', 'middle');
                t.setAttribute('fill', '#344e66');
                t.setAttribute('font-size', '8');
                t.setAttribute('font-family', 'monospace');
                t.textContent = content;
                return t;
            }
            svg.appendChild(mkLbl('manoMinLabel', 38,  174, 'middle', cfg.rangeMin !== null ? cfg.rangeMin : 0));
            svg.appendChild(mkLbl('manoMaxLabel', 162, 174, 'middle', cfg.rangeMax !== null ? cfg.rangeMax : 100));

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
            var needle = el.querySelector('.manoNeedle');
            if (needle) needle.setAttribute('stroke', cfg.valueColor);
            var hubRing = el.querySelector('.manoHubRing');
            if (hubRing) hubRing.setAttribute('stroke', cfg.valueColor);
            var hub = el.querySelector('.manoHub');
            if (hub) hub.setAttribute('fill', cfg.valueColor);
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
