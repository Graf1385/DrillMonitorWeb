class ParameterRepository {
    constructor(db) {
        this.db = db;
    }

    getParameters() {
        return this.db.prepare(`
            SELECT p.id, p.name, p.unit_id, u.symbol AS units, u.name AS unit_name,
                   p.type_id, dt.name AS type_name, dt.default_format
            FROM parameters p
            LEFT JOIN data_types dt ON p.type_id = dt.id
            LEFT JOIN units u ON p.unit_id = u.id
            ORDER BY p.id ASC
        `).all();
    }

    getParameter(id) {
        return this.db.prepare(`
            SELECT p.id, p.name, p.unit_id, u.symbol AS units, p.type_id, dt.name AS type_name
            FROM parameters p
            LEFT JOIN data_types dt ON p.type_id = dt.id
            LEFT JOIN units u ON p.unit_id = u.id
            WHERE p.id = ?
        `).get(id);
    }

    createParameter(id, name, typeId, unitId) {
        return this.db.prepare(
            'INSERT INTO parameters (id, name, type_id, unit_id) VALUES (?, ?, ?, ?)'
        ).run(id, name, typeId, unitId || null);
    }

    updateParameter(id, name, typeId, unitId) {
        return this.db.prepare(
            'UPDATE parameters SET name = ?, type_id = ?, unit_id = ? WHERE id = ?'
        ).run(name, typeId != null ? typeId : null, unitId || null, id);
    }

    importParameters(params) {
        const upsert = this.db.prepare(
            'INSERT OR REPLACE INTO parameters (id, name, type_id, unit_id) VALUES (?, ?, ?, ?)'
        );
        this.db.transaction(() => {
            for (const p of params) upsert.run(p.id, p.name, p.typeId != null ? p.typeId : null, p.unitId || null);
        })();
    }

    deleteParameter(id) {
        return this.db.prepare('DELETE FROM parameters WHERE id = ?').run(id);
    }
}

module.exports = ParameterRepository;
