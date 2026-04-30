class IndicatorRepository {
    constructor(db) {
        this.db = db;
    }

    getIndicatorsByProfile(profileId) {
        return this.db.prepare(`
            SELECT i.*, p.name AS param_name
            FROM indicators i
            LEFT JOIN parameters p ON p.id = i.param_id
            WHERE i.profile_id = ?
            ORDER BY i.id ASC
        `).all(profileId);
    }

    saveIndicators(profileId, list) {
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM indicators WHERE profile_id = ?').run(profileId);
            const insert = this.db.prepare(`
                INSERT INTO indicators
                    (param_id, profile_id, type, pos_left, pos_top, height, width,
                     header_text, header_color, header_bg, header_font, header_size,
                     format, value_color, value_bg, value_font, value_size,
                     range_min, range_max, alarm_enabled, alarm_min, alarm_max, alarm_color,
                     units, zone_colors, ticker_speed, value_bg_opacity, extra_data)
                VALUES
                    (@param_id, @profile_id, @type, @pos_left, @pos_top, @height, @width,
                     @header_text, @header_color, @header_bg, @header_font, @header_size,
                     @format, @value_color, @value_bg, @value_font, @value_size,
                     @range_min, @range_max, @alarm_enabled, @alarm_min, @alarm_max, @alarm_color,
                     @units, @zone_colors, @ticker_speed, @value_bg_opacity, @extra_data)
            `);
            for (const item of list) insert.run({ ...item, profile_id: profileId });
        })();
    }
}

module.exports = IndicatorRepository;
