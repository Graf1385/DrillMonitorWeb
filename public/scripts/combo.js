(function () {
    var ARROW = '<svg class="ccArrow" viewBox="0 0 10 6" width="10" height="6"><path fill="currentColor" d="M0 0l5 6 5-6z"/></svg>';
    var _protoDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

    function CC(select) {
        if (select._cc) return;
        select._cc = this;
        var self = this;

        this._sel      = select;
        this._intended = null;

        var wrap = document.createElement('div');
        wrap.className = 'cc-wrap';
        select.parentNode.insertBefore(wrap, select);
        select.style.display = 'none';
        wrap.appendChild(select);
        this._wrap = wrap;

        var disp = document.createElement('div');
        disp.className = 'cc-display';
        disp.tabIndex  = 0;
        disp.innerHTML = '<span class="cc-val"></span>' + ARROW;
        wrap.appendChild(disp);
        this._disp = disp;

        var drop = document.createElement('div');
        drop.className = 'cc-drop';
        wrap.appendChild(drop);
        this._drop = drop;

        // Override .value setter so programmatic assignments update the display
        Object.defineProperty(select, 'value', {
            configurable: true,
            get: function () { return _protoDesc.get.call(select); },
            set: function (v) {
                self._intended = String(v);
                _protoDesc.set.call(select, v);
                self._refresh();
            }
        });

        // Re-try when options are added (e.g. loaded asynchronously)
        new MutationObserver(function () { self._refresh(); })
            .observe(select, { childList: true });

        disp.addEventListener('click', function () { self._toggle(); });
        disp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self._open(); }
            if (e.key === 'Escape') { self._close(); }
        });
        document.addEventListener('click', function (e) {
            if (!wrap.contains(e.target)) self._close();
        });

        this._refresh();
    }

    CC.prototype._refresh = function () {
        var sel = this._sel;
        if (this._intended !== null && sel.selectedIndex < 0 && sel.options.length > 0) {
            _protoDesc.set.call(sel, this._intended);
        }
        var opt = sel.options[sel.selectedIndex];
        this._disp.querySelector('.cc-val').textContent = opt ? opt.text : '';
    };

    CC.prototype._buildList = function () {
        var self = this;
        this._drop.innerHTML = '';
        Array.from(this._sel.options).forEach(function (opt) {
            var item = document.createElement('div');
            item.className = 'cc-opt' + (opt.selected ? ' cc-active' : '');
            item.textContent = opt.text;
            item.addEventListener('mousedown', function (e) {
                e.preventDefault();
                self._sel.value = opt.value;
                self._sel.dispatchEvent(new Event('change', { bubbles: true }));
                self._close();
            });
            self._drop.appendChild(item);
        });
    };

    CC.prototype._open  = function () { this._buildList(); this._drop.classList.add('open'); this._wrap.classList.add('open'); };
    CC.prototype._close = function () { this._drop.classList.remove('open'); this._wrap.classList.remove('open'); };
    CC.prototype._toggle = function () { if (this._drop.classList.contains('open')) this._close(); else this._open(); };

    window.initCombo  = function (sel) { if (sel && !sel._cc) new CC(sel); };
    window.initCombos = function (root) {
        Array.from(root.querySelectorAll('select')).forEach(function (s) { initCombo(s); });
    };
})();
