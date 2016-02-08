/// <reference path="../typings/tsd.d.ts" />

//import express = require('express');
import nconf = require('nconf');
//import jade = require('jade');
import _ = require('lodash');
import OneBotAwayBot = require('./bot');
import OneBusAwayClient = require('./OneBusAwayClient');

class WebApp {
    private _bot: OneBotAwayBot;
    private _oneBusAwayClient: OneBusAwayClient;
    
    constructor(oneBusAwayApiKey: string, slackToken: string) {
        this._oneBusAwayClient = new OneBusAwayClient(oneBusAwayApiKey);
        this._bot = new OneBotAwayBot(this._oneBusAwayClient, slackToken);
        this._bot.start();
    }
}

nconf.file({ file: './config.json' });
var ONE_BUS_AWAY_KEY = nconf.get('ONE_BUS_AWAY');
var SLACK_TOKEN = nconf.get('SLACK_TOKEN');

let app = new WebApp(ONE_BUS_AWAY_KEY, SLACK_TOKEN);
