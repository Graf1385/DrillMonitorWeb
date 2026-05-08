function _esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class ParametersManager {
    constructor() {
        this._types  = [];
        this._units  = [];
        this._dirty  = {};
    }

    // ── Public entry points ───────────────────────────────────────────────────

    show() {
        this.switchTab('params');
        $.when(
            $.getJSON('/api/parameters'),
            $.getJSON('/api/data-types'),
            $.getJSON('/api/units')
        ).then(function(paramsResp, typesResp, unitsResp) {
            window.parametersManager._types = typesResp[0];
            window.parametersManager._units = unitsResp[0];
            window.parametersManager._renderParamsTable(paramsResp[0]);
            window.parametersManager._renderUnitsTable(unitsResp[0]);
            document.querySelector('#parametersModal').showModal();
        });
    }

    switchTab(tab) {
        var isParams = tab === 'params';
        document.querySelector('#pmTabBtnParams').classList.toggle('pmTabActive', isParams);
        document.querySelector('#pmTabBtnUnits').classList.toggle('pmTabActive', !isParams);
        document.querySelector('#pmPanelParams').style.display = isParams ? '' : 'none';
        document.querySelector('#pmPanelUnits').style.display  = isParams ? 'none' : '';
    }

    isUnitsTabActive() {
        return document.querySelector('#pmTabBtnUnits').classList.contains('pmTabActive');
    }

    addRow() {
        if (this.isUnitsTabActive()) this._addUnitRow(); else this._addParamRow();
    }

    exportData() {
        if (this.isUnitsTabActive()) this._exportUnits(); else this._exportParams();
    }

    importData() {
        if (this.isUnitsTabActive())
            document.querySelector('#unitsImportFile').click();
        else
            document.querySelector('#paramImportFile').click();
    }

    // ── Parameters ────────────────────────────────────────────────────────────

    _unitsOptions(selectedId) {
        return '<option value="">— нет —</option>' +
            this._units.map(function(u) {
                return '<option value="' + u.id + '"' + (selectedId === u.id ? ' selected' : '') + '>' +
                    _esc(u.symbol) + ' — ' + _esc(u.name) + '</option>';
            }).join('');
    }

    _renderParamsTable(params) {
        var self = this;
        var rows = params.map(function(p) {
            var typeOpts = self._types.map(function(t) {
                return '<option value="' + t.id + '"' + (p.type_id === t.id ? ' selected' : '') + '>' + _esc(t.name) + '</option>';
            }).join('');
            return '<tr data-param-id="' + p.id + '">' +
                '<td class="il-id">' + p.id + '</td>' +
                '<td class="il-input"><input class="settingsInput pm-nameInput" value="' + _esc(p.name) + '"></td>' +
                '<td class="il-input"><select class="settingsSelect pm-typeSelect">' + typeOpts + '</select></td>' +
                '<td class="il-input"><select class="settingsSelect pm-unitSelect">' + self._unitsOptions(p.unit_id) + '</select></td>' +
                '<td class="il-del"><button class="il-delBtn" onclick="parametersManager.deleteParam(' + p.id + ')">Удалить</button></td>' +
            '</tr>';
        });

        var body = document.querySelector('#parametersBody');
        body.innerHTML =
            '<table class="settingsTable il-table">' +
            '<colgroup><col style="width:50px"><col><col style="width:110px"><col style="width:140px"><col style="width:90px"></colgroup>' +
            '<thead><tr><th>ID</th><th>Название</th><th>Тип</th><th>Ед. изм.</th><th></th></tr></thead>' +
            '<tbody id="parametersTableBody">' + rows.join('') + '</tbody></table>';
        initCombos(document.querySelector('#parametersTableBody'));
        this._dirty = {};

        if (body._paramChangeHandler) body.removeEventListener('change', body._paramChangeHandler);
        var mgr = this;
        body._paramChangeHandler = function(e) {
            var row = e.target.closest('[data-param-id]');
            if (row) {
                mgr._dirty[row.dataset.paramId] = true;
                row.classList.add('pm-dirty');
            }
        };
        body.addEventListener('change', body._paramChangeHandler);
    }

    save() {
        var modal = document.querySelector('#parametersModal');
        var rows  = Array.from(document.querySelectorAll('#parametersTableBody tr[data-param-id]'));
        if (rows.length === 0) { modal.close(); return; }

        var valid = true;
        var saves = rows.map(function(row) {
            var id     = parseInt(row.dataset.paramId);
            var nameEl = row.querySelector('.pm-nameInput');
            var typeEl = row.querySelector('.pm-typeSelect');
            var unitEl = row.querySelector('.pm-unitSelect');
            var name   = nameEl ? nameEl.value.trim() : '';
            if (!name) { showError('Параметр #' + id + ': название не может быть пустым'); valid = false; return null; }
            var typeId = typeEl ? parseInt(typeEl.value) : null;
            var unitId = unitEl ? (unitEl.value || null) : null;
            return $.ajax({
                url:         '/api/parameters/' + id,
                method:      'PUT',
                contentType: 'application/json',
                data:        JSON.stringify({ name: name, typeId: typeId, unitId: unitId }),
                error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка сохранения #' + id); }
            });
        }).filter(Boolean);

        if (!valid) return;
        this._dirty = {};
        if (saves.length === 0) { modal.close(); return; }
        $.when.apply($, saves).always(function() { modal.close(); });
    }

    deleteParam(id) {
        if (!confirm('Удалить параметр #' + id + '?')) return;
        $.ajax({
            url: '/api/parameters/' + id,
            method: 'DELETE',
            success: function() {
                var row = document.querySelector('[data-param-id="' + id + '"]');
                if (row) row.remove();
            },
            error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка удаления'); }
        });
    }

    _addParamRow() {
        var typeOptions = this._types.map(function(t) {
            return '<option value="' + t.id + '">' + t.name + '</option>';
        }).join('');
        var tbody = document.querySelector('#parametersTableBody');
        if (!tbody) return;
        var tr = document.createElement('tr');
        tr.className = 'pm-newRow';
        tr.innerHTML =
            '<td class="il-input"><input type="number" class="settingsInput pm-newId" placeholder="ID" min="0" style="width:54px"></td>' +
            '<td class="il-input"><input class="settingsInput pm-newName" placeholder="Название"></td>' +
            '<td class="il-input"><select class="settingsSelect pm-newType">' + typeOptions + '</select></td>' +
            '<td class="il-input"><select class="settingsSelect pm-newUnit">' + this._unitsOptions(null) + '</select></td>' +
            '<td class="il-del"><button class="il-delBtn" onclick="parametersManager.saveNewParam(this)">Сохранить</button></td>';
        tbody.appendChild(tr);
        initCombos(tr);
        tr.querySelector('.pm-newId').focus();
    }

    saveNewParam(btn) {
        var row    = btn.closest('tr');
        var idVal  = row.querySelector('.pm-newId').value;
        var name   = row.querySelector('.pm-newName').value.trim();
        var typeId = parseInt(row.querySelector('.pm-newType').value);
        var unitId = row.querySelector('.pm-newUnit').value || null;
        if (idVal === '' || isNaN(parseInt(idVal))) { showError('Введите ID параметра'); return; }
        if (!name) { showError('Введите название параметра'); return; }
        var mgr = this;
        $.ajax({
            url: '/api/parameters',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ id: parseInt(idVal), name: name, typeId: typeId, unitId: unitId }),
            success: function() {
                $.getJSON('/api/parameters', function(params) { mgr._renderParamsTable(params); });
            },
            error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка добавления'); }
        });
    }

    _exportParams() {
        $.getJSON('/api/parameters', function(params) {
            var data = params.map(function(p) {
                return { id: p.id, name: p.name, typeId: p.type_id, unitId: p.unit_id || null, units: p.units || '' };
            });
            var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = 'parameters.json'; a.click();
            URL.revokeObjectURL(url);
        });
    }

    importParamsFile(input) {
        var file = input.files[0];
        if (!file) return;
        var reader = new FileReader();
        var mgr = this;
        reader.onload = function(e) {
            try {
                var data = JSON.parse(e.target.result);
                if (!Array.isArray(data)) throw new Error('Ожидается массив');
                $.ajax({
                    url: '/api/parameters/import',
                    method: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({ parameters: data }),
                    success: function() {
                        $.getJSON('/api/parameters', function(params) { mgr._renderParamsTable(params); });
                    },
                    error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка импорта'); }
                });
            } catch (err) { showError('Неверный формат JSON: ' + err.message); }
            input.value = '';
        };
        reader.readAsText(file);
    }

    // ── Units ─────────────────────────────────────────────────────────────────

    _renderUnitsTable(units) {
        var rows = units.map(function(u) {
            return '<tr data-unit-id="' + u.id + '">' +
                '<td class="il-id">' + u.id + '</td>' +
                '<td class="il-input"><input class="settingsInput um-nameInput" value="' + _esc(u.name) + '" onchange="parametersManager.updateUnit(' + u.id + ')"></td>' +
                '<td class="il-input"><input class="settingsInput um-symbolInput" value="' + _esc(u.symbol) + '" onchange="parametersManager.updateUnit(' + u.id + ')" style="width:90px"></td>' +
                '<td class="il-del"><button class="il-delBtn" onclick="parametersManager.deleteUnit(' + u.id + ')">Удалить</button></td>' +
            '</tr>';
        }).join('');
        document.querySelector('#unitsBody').innerHTML =
            '<table class="settingsTable il-table">' +
            '<colgroup><col style="width:40px"><col><col style="width:110px"><col style="width:90px"></colgroup>' +
            '<thead><tr><th>ID</th><th>Название</th><th>Символ</th><th></th></tr></thead>' +
            '<tbody id="unitsTableBody">' + rows + '</tbody></table>';
    }

    updateUnit(id) {
        var row = document.querySelector('[data-unit-id="' + id + '"]');
        if (!row) return;
        var name   = row.querySelector('.um-nameInput').value.trim();
        var symbol = row.querySelector('.um-symbolInput').value.trim();
        if (!name)   { showError('Название не может быть пустым'); return; }
        if (!symbol) { showError('Символ не может быть пустым'); return; }
        $.ajax({
            url: '/api/units/' + id,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({ name: name, symbol: symbol }),
            error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка сохранения'); }
        });
    }

    _addUnitRow() {
        var tbody = document.querySelector('#unitsTableBody');
        if (!tbody) return;
        var tr = document.createElement('tr');
        tr.className = 'pm-newRow';
        tr.innerHTML =
            '<td class="il-id">—</td>' +
            '<td class="il-input"><input class="settingsInput um-newName" placeholder="Название"></td>' +
            '<td class="il-input"><input class="settingsInput um-newSymbol" placeholder="Символ" style="width:90px"></td>' +
            '<td class="il-del"><button class="il-delBtn" onclick="parametersManager.saveNewUnit(this)">Сохранить</button></td>';
        tbody.appendChild(tr);
        tr.querySelector('.um-newName').focus();
    }

    _reloadUnits(cb) {
        var mgr = this;
        $.getJSON('/api/units', function(units) {
            mgr._units = units;
            mgr._renderUnitsTable(units);
            if (cb) cb();
        });
    }

    deleteUnit(id) {
        if (!confirm('Удалить единицу #' + id + '?')) return;
        var mgr = this;
        $.ajax({
            url: '/api/units/' + id,
            method: 'DELETE',
            success: function() { mgr._reloadUnits(); },
            error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка удаления'); }
        });
    }

    saveNewUnit(btn) {
        var row    = btn.closest('tr');
        var name   = row.querySelector('.um-newName').value.trim();
        var symbol = row.querySelector('.um-newSymbol').value.trim();
        if (!name)   { showError('Введите название'); return; }
        if (!symbol) { showError('Введите символ'); return; }
        var mgr = this;
        $.ajax({
            url: '/api/units',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ name: name, symbol: symbol }),
            success: function() { mgr._reloadUnits(); },
            error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка добавления'); }
        });
    }

    _exportUnits() {
        $.getJSON('/api/units', function(units) {
            var blob = new Blob([JSON.stringify(units, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = 'units.json'; a.click();
            URL.revokeObjectURL(url);
        });
    }

    importUnitsFile(input) {
        var file = input.files[0];
        if (!file) return;
        var reader = new FileReader();
        var mgr = this;
        reader.onload = function(e) {
            try {
                var data = JSON.parse(e.target.result);
                if (!Array.isArray(data)) throw new Error('Ожидается массив');
                $.ajax({
                    url: '/api/units/import',
                    method: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({ units: data }),
                    success: function() { mgr._reloadUnits(); },
                    error: function(xhr) { showError(xhr.responseJSON ? xhr.responseJSON.error : 'Ошибка импорта'); }
                });
            } catch (err) { showError('Неверный формат JSON: ' + err.message); }
            input.value = '';
        };
        reader.readAsText(file);
    }
}

window.parametersManager = new ParametersManager();

// ── Global wrappers for HTML onclick attributes ───────────────────────────────

window.switchParamTab      = function(tab) { parametersManager.switchTab(tab); };
window.pmAddRow            = function()    { parametersManager.addRow(); };
window.pmExport            = function()    { parametersManager.exportData(); };
window.pmImport            = function()    { parametersManager.importData(); };
window.saveParameters      = function()    { parametersManager.save(); };
window.addParameterRow     = function()    { parametersManager._addParamRow(); };
window.deleteParam         = function(id)  { parametersManager.deleteParam(id); };
window.saveNewParam        = function(btn) { parametersManager.saveNewParam(btn); };
window.exportParameters    = function()    { parametersManager._exportParams(); };
window.importParametersFile = function(inp) { parametersManager.importParamsFile(inp); };
window.exportUnits         = function()    { parametersManager._exportUnits(); };
window.importUnitsFile     = function(inp) { parametersManager.importUnitsFile(inp); };
window.updateUnit          = function(id)  { parametersManager.updateUnit(id); };
window.deleteUnit          = function(id)  { parametersManager.deleteUnit(id); };
window.saveNewUnit         = function(btn) { parametersManager.saveNewUnit(btn); };
window.showUnitsModal      = function()    { parametersManager.switchTab('units'); };
