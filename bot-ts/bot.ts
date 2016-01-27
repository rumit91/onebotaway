/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./custom-typings/botkit.d.ts" />

import Botkit = require('botkit');
import request = require('request');
import fs = require('fs');
import nconf = require('nconf');
import _ = require('lodash');
import Q = require('q');

nconf.file({ file: './config.json' });
var ONE_BUS_AWAY_KEY = nconf.get('ONE_BUS_AWAY');
var SLACK_TOKEN = nconf.get('SLACK_TOKEN');

interface BusCommandDefinition {
    rules: BusCommandDefinitionRule[];
}
interface BusCommandDefinitionRule {
    startTime: number;
    endTime: number;
    stop: string;
    route: string;
}

interface OneBusAwayStop {
    // TODO: Complete this definition
    data: {
        entry: {
            code: string;
            id: string;
            name: string;
        }
    }
}

interface OneBusAwayRoute {
    // TODO: Complete this definition
    data: {
        entry: {
            id: string;
            longName: string;
            shortName: string;
        }
    }
}

interface OneBusAwayArrivalsAndDepartures {
    // TODO: Complete this definition
    data: {
        entry: {
            arrivalsAndDepartures: {
                routeId: string;
                scheduledArrivalTime: number;
                predictedArrivalTime: number;
            }[];
        }
    }
}

class OneBotAwayBot {
    private _controller;
    private _bot;
    private _interval;
    private _busCommandDefinition: BusCommandDefinition = {
        rules: [{
            // home stop
            startTime: 0, // midnight
            endTime: 39600000, // 11am
            stop: '1_13460',
            route: '40_100236'
        },
            {
                // work stop
                startTime: 39601000, // 11:00:01 AM
                endTime: 86399000, // 11:59:59 PM
                stop: '1_13460',
                route: '40_100236'
            }]
    }
    private _oneBusAwayKey: string;
    private _oneBusAwayBaseUrl = 'http://api.pugetsound.onebusaway.org/api/where/';

    constructor(oneBusAwayKey: string, slackToken: string) {
        this._oneBusAwayKey = oneBusAwayKey;
        // Create a controller.
        this._controller = Botkit.slackbot({
            debug: true
        });
        
        // Spawn a bot.
        this._bot = this._controller.spawn({
            token: slackToken
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

            _.each(this._busCommandDefinition.rules, rule => {
                if (this._fitsRuleInterval(rule, new Date())) {
                    var info = {
                        busStopName: '',
                        routeName: '',
                        nextArrival: ''
                    }
                    this._getStopInfo(rule.stop).then<any>(res => {
                        info.busStopName = (JSON.parse(res[0].body) as OneBusAwayStop).data.entry.name;
                        return this._getRouteInfo(rule.route);
                    }).then<any>(res => {
                        info.routeName = (JSON.parse(res[0].body) as OneBusAwayRoute).data.entry.shortName;
                        return this._getArrivalInfo(rule.stop);
                    }).then<any>(res => {
                        let arrivals = (JSON.parse(res[0].body) as OneBusAwayArrivalsAndDepartures).data.entry.arrivalsAndDepartures;
                        arrivals = _.filter(arrivals, arrival => {
                           return arrival.routeId === rule.route && arrival.predictedArrivalTime > new Date().getTime();  
                        });
                        if (arrivals.length === 0) {
                            info.nextArrival = 'No arrivals in the next 30 min';
                        } else {
                            let arrivalTime = new Date(arrivals[0].predictedArrivalTime);
                            info.nextArrival = arrivalTime.toTimeString();
                        }
                        bot.reply(message, '*' + info.nextArrival + '* ' + '(Next `' + info.routeName + '` bus at the `' + info.busStopName + '` stop)');
                    }).fail(err => {
                        console.log(err);
                    });
                }
            });
        });
    }

    private _fitsRuleInterval(rule: BusCommandDefinitionRule, dateTime: Date): boolean {
        //Subtract the date to get just the time in milliseconds
        let time = dateTime.getTime() - Date.parse(dateTime.toDateString());
        console.log(time > rule.startTime && time < rule.endTime);
        return time > rule.startTime && time < rule.endTime;
    }

    private _getStopInfo(stop: string) {
        return Q.nfcall<any>(request, this._getOneBusAwayStopUrl(stop));
    }
    
    private _getRouteInfo(route: string) {
        return Q.nfcall<any>(request, this._getOneBusAwayRouteUrl(route));
    }
    
    private _getArrivalInfo(stop:string) {
        return Q.nfcall<any>(request, this._getOneBusAwayArrivalsAndDeparturesUrl(stop));
    }

    private _getOneBusAwayStopUrl(stopNumber: string): string {
        return this._oneBusAwayBaseUrl + 'stop/' + stopNumber + '.json?key=' + this._oneBusAwayKey;
    }

    private _getOneBusAwayRouteUrl(routeNumber: string): string {
        return this._oneBusAwayBaseUrl + 'route/' + routeNumber + '.json?key=' + this._oneBusAwayKey;
    }

    private _getOneBusAwayArrivalsAndDeparturesUrl(stopNumber: string): string {
        return this._oneBusAwayBaseUrl + 'arrivals-and-departures-for-stop/' + stopNumber + '.json?key=' + this._oneBusAwayKey;
    }
}

var bot = new OneBotAwayBot(ONE_BUS_AWAY_KEY, SLACK_TOKEN);
bot.start();
