const db                  = require('./connection');
const { initSchema }      = require('./schema');
const ProfileRepository   = require('./ProfileRepository');
const UnitRepository      = require('./UnitRepository');
const ParameterRepository = require('./ParameterRepository');
const DataTypeRepository  = require('./DataTypeRepository');
const IndicatorRepository = require('./IndicatorRepository');
const LogRepository       = require('./LogRepository');
const FontRepository      = require('./FontRepository');
const AlarmSoundRepository = require('./AlarmSoundRepository');
const UserRepository      = require('./UserRepository');

initSchema(db);

const profiles   = new ProfileRepository(db);
const units      = new UnitRepository(db);
const parameters = new ParameterRepository(db);
const dataTypes  = new DataTypeRepository(db);
const indicators = new IndicatorRepository(db);
const logs       = new LogRepository(db);
const fonts      = new FontRepository(db);
const sounds     = new AlarmSoundRepository(db);
const users      = new UserRepository(db);

module.exports = {
    // profiles
    getProfiles:    () => profiles.getProfiles(),
    getProfile:     (id) => profiles.getProfile(id),
    createProfile:  (name, bg, size) => profiles.createProfile(name, bg, size),
    getActiveProfile: () => profiles.getActiveProfile(),
    selectProfile:  (id) => profiles.selectProfile(id),
    updateProfile:  (id, bg, size, soundId, vol, delay, wsW, wsH, sbTimeout) => profiles.updateProfile(id, bg, size, soundId, vol, delay, wsW, wsH, sbTimeout),
    deleteProfile:  (id) => profiles.deleteProfile(id),

    // units
    getUnits:   () => units.getUnits(),
    createUnit: (name, symbol) => units.createUnit(name, symbol),
    updateUnit: (id, name, symbol) => units.updateUnit(id, name, symbol),
    importUnits: (list) => units.importUnits(list),
    deleteUnit:  (id) => units.deleteUnit(id),

    // parameters
    getParameters:    () => parameters.getParameters(),
    getParameter:     (id) => parameters.getParameter(id),
    createParameter:  (id, name, typeId, unitId, size, accuracy, refUnit) => parameters.createParameter(id, name, typeId, unitId, size, accuracy, refUnit),
    updateParameter:  (id, name, typeId, unitId, size, accuracy, refUnit) => parameters.updateParameter(id, name, typeId, unitId, size, accuracy, refUnit),
    importParameters: (params) => parameters.importParameters(params),
    deleteParameter:  (id) => parameters.deleteParameter(id),

    // data types
    getDataTypes:   () => dataTypes.getDataTypes(),
    getDataType:    (id) => dataTypes.getDataType(id),
    createDataType: (name, fmt) => dataTypes.createDataType(name, fmt),
    updateDataType: (id, name, fmt) => dataTypes.updateDataType(id, name, fmt),
    deleteDataType: (id) => dataTypes.deleteDataType(id),

    // indicators
    getIndicatorsByProfile: (profileId) => indicators.getIndicatorsByProfile(profileId),
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
};
