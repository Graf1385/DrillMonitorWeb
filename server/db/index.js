const db                  = require('./connection');
const { initSchema }      = require('./schema');
const ProfileRepository   = require('./ProfileRepository');
const IndicatorRepository = require('./IndicatorRepository');
const LogRepository       = require('./LogRepository');
const FontRepository      = require('./FontRepository');
const AlarmSoundRepository = require('./AlarmSoundRepository');
const UserRepository      = require('./UserRepository');
const SessionRepository   = require('./SessionRepository');
const AlarmRepository     = require('./AlarmRepository');

initSchema(db);

const profiles   = new ProfileRepository(db);
const indicators = new IndicatorRepository(db);
const logs       = new LogRepository(db);
const fonts      = new FontRepository(db);
const sounds     = new AlarmSoundRepository(db);
const users      = new UserRepository(db);
const sessions   = new SessionRepository(db);
const alarms     = new AlarmRepository(db);

module.exports = {
    // profiles
    getProfiles:    () => profiles.getProfiles(),
    getProfile:     (id) => profiles.getProfile(id),
    createProfile:  (name, bg, size) => profiles.createProfile(name, bg, size),
    getActiveProfile: () => profiles.getActiveProfile(),
    selectProfile:  (id) => profiles.selectProfile(id),
    updateProfile:  (id, bg, size, soundId, vol, delay, wsW, wsH, sbTimeout, tz, output) => profiles.updateProfile(id, bg, size, soundId, vol, delay, wsW, wsH, sbTimeout, tz, output),
    deleteProfile:  (id) => profiles.deleteProfile(id),

    // indicators
    getIndicatorsByProfile: (profileId) => indicators.getIndicatorsByProfile(profileId),
    getActiveIndicators:    ()           => indicators.getActiveIndicators(),
    saveIndicators:         (profileId, list) => indicators.saveIndicators(profileId, list),

    // logs
    createLog:    (msg) => logs.createLog(msg),
    getLogs:      () => logs.getLogs(),
    clearLogs:    () => logs.clearLogs(),
    deleteOldLogs: () => logs.deleteOldLogs(),

    // fonts
    getFonts:    () => fonts.getFonts(),
    getFontFile: (id) => fonts.getFontFile(id),

    // alarm sounds
    getAlarmSounds:    () => sounds.getAlarmSounds(),
    getAlarmSoundFile: (id) => sounds.getAlarmSoundFile(id),
    createAlarmSound:  (name, buf) => sounds.createAlarmSound(name, buf),
    deleteAlarmSound:  (id) => sounds.deleteAlarmSound(id),

    // users
    getUser:            (name) => users.getUser(name),
    verifyUser:         (name, password) => users.verifyUser(name, password),
    updateUserPassword: (name, newPassword) => users.updateUserPassword(name, newPassword),

    // sessions
    createSession:   (token, expiresAt) => sessions.create(token, expiresAt),
    getSession:      (token) => sessions.get(token),
    deleteSession:   (token) => sessions.delete(token),
    purgeExpiredSessions: () => sessions.purgeExpired(),

    // история тревог (server/alarm.js)
    alarmStart:     (a) => alarms.start(a),
    alarmExtreme:   (id, value) => alarms.extreme(id, value),
    alarmAck:       (id, at) => alarms.ack(id, at),
    alarmEnd:       (id, at, value, reason) => alarms.end(id, at, value, reason),
    alarmCloseOpen: (at, reason) => alarms.closeOpen(at, reason),
    alarmRecent:    (limit) => alarms.recent(limit),
    alarmCount:     () => alarms.count(),
    alarmTrim:      () => alarms.trim(),
};
