const express = require('express');
const router = express.Router();
const helper = require('../helper');

router.post('/setSettings', (req, res) => {
    try {
        var settings = JSON.parse(req.body.settings)
        helper.saveSettings(settings);
        res.status(200).send();

    } catch (error) {
        res.status(400).send();
        console.log(error);
    }
});

module.exports = router;