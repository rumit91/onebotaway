/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./custom-typings/botkit.d.ts" />

import Botkit = require('botkit');
import request = require('request');
import fs = require('fs');
import nconf = require('nconf');

nconf.file({ file: './config.json' });
var ONE_BUS_AWAY_KEY = nconf.get('ONE_BUS_AWAY');
var SLACK_TOKEN = nconf.get('SLACK_TOKEN');

class OneBotAwayBot {
    private _controller;
    private _bot;
    private _interval;

    constructor(oneBusAwayKey: string, slackToken: string) {
        // Create a controller.
        this._controller = Botkit.slackbot({
            debug: true
        });
        
        // Spawn a bot.
        this._bot = this._controller.spawn({
            token: SLACK_TOKEN
        });

        this._setUpListeningCommands();
    }

    start() {
        // Connect bot to real-time messaging.
        this._bot.startRTM(function(err) {
            if (err) {
                throw new Error(err);
            }
        });
    }

    private _setUpListeningCommands() {
        this._controller.hears(['nvm'], ['direct_message'], (bot, message) => {
            if (this._interval) {
                clearInterval(this._interval);
            }
        });

        this._controller.hears(['bus'], ['direct_message'], (bot, message) => {
            bot.reply(message, 'Let me check...');
            var oneBusAwayUrl = 'http://api.pugetsound.onebusaway.org/api/where/arrivals-and-departures-for-stop/'
                + '1_71334.json?key='
                + ONE_BUS_AWAY_KEY;

            this._sayNextArrival(message, bot, oneBusAwayUrl);
            this._interval = setInterval(this._sayNextArrival.bind(this, message, bot, oneBusAwayUrl), 5000);
        });
    }

    private _sayNextArrival(message, bot, url) {
        request(url, (error, response, body) => {
            if (!error && response.statusCode == 200) {
                var stopInfo = JSON.parse(body);
                var nextBus = stopInfo.data.entry.arrivalsAndDepartures[0];
                if (nextBus) {
                    var nextArrivalTime = new Date(nextBus.predictedArrivalTime);
                    bot.say({
                        text: nextBus.routeShortName + ': ' + nextArrivalTime.toTimeString(),
                        channel: message.channel
                    });
                } else {
                    bot.say({
                        text: 'No arrivals in the next 35 min',
                        channel: message.channel
                    });
                }

            }
        });
    }
}

var bot = new OneBotAwayBot(ONE_BUS_AWAY_KEY, SLACK_TOKEN);
bot.start();
