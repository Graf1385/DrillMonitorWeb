const express = require('express');
const router = express.Router();
const helper = require('../helper');

router.get('/', (req, res) =>{
    res.render('index');
});

router.post('/getSettings',(req, res) =>{
    try {
        var ip = '';
        var mask = '';
        helper.networkInterfaces.Ethernet.forEach(element => {
            if(element.family == 'IPv4'){
                ip = element.address;
                mask = element.netmask;
            }
        });
       
        res.status(200).send({
            ip : ip,
            mask : mask
        });

    } catch (error) {
        console.log(error);
        res.status(400);
    } 
});

module.exports = router;