var os = require('os');
var fs = require('fs');
var set_ip_address = require('set-ip-address');
var html_parser = require('node-html-parser');

const networkInterfaces = os.networkInterfaces();
const parList = require('./data/parameters.json');
const settings = require('./data/settings.json');


function getSettings(){
    settings.ip = networkInterfaces.eth0[0].address;
    settings.mask = networkInterfaces.eth0[0].netmask;
    return settings;
}

function saveSettings(settings){
    fs.writeFileSync('./server/data/settings.json', settings, (error) => {
        console.log(error);
    });
   
   
}

module.exports = {
    networkInterfaces,
    parList,
    getSettings,
    saveSettings
};
