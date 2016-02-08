/// <reference path="../typings/tsd.d.ts" />

import express = require('express');
import nconf = require('nconf');
import _ = require('lodash');
import OneBotAwayBot = require('./bot');
import OneBusAwayClient = require('./OneBusAwayClient');

class WebApp {
    private _app: express.Express;
    private _bot: OneBotAwayBot;
    private _oneBusAwayClient: OneBusAwayClient;
    
    constructor(oneBusAwayApiKey: string, slackToken: string, port: string) {
        this._oneBusAwayClient = new OneBusAwayClient(oneBusAwayApiKey);
        this._bot = new OneBotAwayBot(this._oneBusAwayClient, slackToken);
        this._bot.start();
        
        this._app = express();
        this._setupRoutes();
        this._app.listen(port, function() {
            console.log('Listening on port ' + port + '!');
        });
    }
    
    private _setupRoutes() {
        // Base route
        this._app.get('/', (req, res) => {
            res.send('OneBotAway - bus bot');
        });
        
        this._app.get('/notify', (req, res) => {
            this._bot.notify();
            res.send('Checking notification schedules');
        });
    }
}

nconf.file({ file: './config.json' });
const ONE_BUS_AWAY_KEY = process.env.oneBusAway || nconf.get('ONE_BUS_AWAY');
const SLACK_TOKEN = process.env.slackToken || nconf.get('SLACK_TOKEN');
const port = process.env.port || 3000;

let app = new WebApp(ONE_BUS_AWAY_KEY, SLACK_TOKEN, port);
