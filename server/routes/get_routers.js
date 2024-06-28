const express = require('express');
const router = express.Router();
const helper = require('../helper');

router.get('/', (req, res) =>{
    res.render('index');
});

router.get('/getSettings',(req, res) =>{
    try {
        var settings = helper.getSettings();
        res.status(200).send(JSON.stringify(settings));
    } catch (error) {
        console.log(error);
        res.status(400);
    } 
});

module.exports = router;