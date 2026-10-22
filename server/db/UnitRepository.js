class UnitRepository {
    constructor(db) {
        this.db = db;
    }

    getUnits() {
        return this.db.prepare('SELECT id, name, symbol FROM units ORDER BY name ASC').all();
    }

    createUnit(name, symbol) {
        return this.db.prepare('INSERT INTO units (name, symbol) VALUES (?, ?)').run(name, symbol);
    }

    updateUnit(id, name, symbol) {
        return this.db.prepare('UPDATE units SET name = ?, symbol = ? WHERE id = ?').run(name, symbol, id);
    }

    // Запись списка единиц «как есть»: строка с известным id обновляется (так
    // переименование символа остаётся переименованием, а не новой единицей),
    // строка без id добавляется по символу. Нужна для настройки из Loader.
    upsertUnits(list) {
        const exists   = this.db.prepare('SELECT 1 FROM units WHERE id = ?');
        const update   = this.db.prepare('UPDATE units SET name = ?, symbol = ? WHERE id = ?');
        const insertId = this.db.prepare('INSERT INTO units (id, name, symbol) VALUES (?, ?, ?)');
        const insertSym = this.db.prepare(`
            INSERT INTO units (name, symbol) VALUES (?, ?)
            ON CONFLICT(symbol) DO UPDATE SET name = excluded.name
        `);
        return this.db.transaction(function (rows) {
            rows.forEach(function (u) {
                const name   = String(u.name).trim();
                const symbol = String(u.symbol).trim();
                const id     = parseInt(u.id, 10);
                if (isNaN(id))            insertSym.run(name, symbol);
                else if (exists.get(id))  update.run(name, symbol, id);
                else                      insertId.run(id, name, symbol);
            });
        })(list);
    }

    importUnits(units) {
        const upsert = this.db.prepare(`
            INSERT INTO units (name, symbol) VALUES (?, ?)
            ON CONFLICT(symbol) DO UPDATE SET name = excluded.name
        `);
        this.db.transaction(function(list) {
            list.forEach(function(u) { upsert.run(String(u.name), String(u.symbol)); });
        })(units);
    }

    deleteUnit(id) {
        return this.db.prepare('DELETE FROM units WHERE id = ?').run(id);
    }
}

module.exports = UnitRepository;
