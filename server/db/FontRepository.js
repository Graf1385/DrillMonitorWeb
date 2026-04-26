class FontRepository {
    constructor(db) {
        this.db = db;
    }

    getFonts() {
        return this.db.prepare('SELECT id, name FROM fonts ORDER BY name ASC').all();
    }

    getFontFile(id) {
        return this.db.prepare('SELECT font, mime_type FROM fonts WHERE id = ?').get(id);
    }
}

module.exports = FontRepository;
