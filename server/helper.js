var _os = require('os');
var _fs = require('fs');
var _set_ip_address = require('set-ip-address');
const _netplan = require('netplan-js');
const { execFile: _execFile } = require('child_process');
const _parList = require('./data/parameters.json');



function netMaskToPrefex(mask){
    var numbersStr = mask.split('.');
    var count = 0;
    numbersStr.forEach(element => {
        var dec = Number.parseInt(element);
        var bin = (dec >>> 0).toString(2)
        if(dec > 0)
            count += bin.match(/[1]/g).length;
        
    });   
    return count;
}

function rebootSystem(){
    _execFile('sudo', ['systemctl', 'restart', 'networking'], function(error) {
        if (error) { console.error('networking restart error:', error); return; }
        _execFile('netplan', ['apply'], function(err) {
            if (err) console.error('netplan apply error:', err);
        });
    });
}

function getNetPlan(){
    

    const netplan = new _netplan();

    netplan.loadConfigs().then(() => {
        const config = netplan.getInterface('ethernets', 'eth0');
        console.log('Current config:', JSON.stringify(config));
    });
}

function getSettings(){  
    getNetPlan();
    var netInf = _os.networkInterfaces();
    var settings = require('./data/settings.json');
    
    settings.ip = netInf.eth0[0].address;
    settings.mask = netInf.eth0[0].netmask;
    settings.gateway = netInf.eth0[0].gateway;

    return settings;
}

function saveSettings(settings){

    var prefex = netMaskToPrefex(settings.mask);

    var eth0 = {
        interface : "eth0",
        ip_address : settings.ip,
        prefix : prefex,
        gateway : settings.gateway,
        dhcp: false
    }

    _set_ip_address.configure([eth0])
        .then(() => console.log('Сетевые настройки успешно применены'))
        .catch((err) => console.error('Ошибка изменения сетевых настроек:', err));

    _fs.writeFileSync('./server/data/settings.json', JSON.stringify(settings), (error) => {
        console.log(error);
        throw error;
    });   

    rebootSystem();
   
}

module.exports = {
    parlist : _parList,
    getSettings,
    saveSettings
};
