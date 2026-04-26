class DataTypeRepository {
    constructor(db) {
        this.db = db;
    }

    getDataTypes() {
        return this.db.prepare('SELECT * FROM data_types ORDER BY id ASC').all();
    }

    getDataType(id) {
        return this.db.prepare('SELECT * FROM data_types WHERE id = ?').get(id);
    }

    createDataType(name, defaultFormat) {
        return this.db.prepare(
            'INSERT INTO data_types (name, default_format) VALUES (?, ?)'
        ).run(name, defaultFormat);
    }

    updateDataType(id, name, defaultFormat) {
        return this.db.prepare(
            'UPDATE data_types SET name = ?, default_format = ? WHERE id = ?'
        ).run(name, defaultFormat, id);
    }

    deleteDataType(id) {
        return this.db.prepare('DELETE FROM data_types WHERE id = ?').run(id);
    }
}

module.exports = DataTypeRepository;
