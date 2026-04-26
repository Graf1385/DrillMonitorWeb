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
