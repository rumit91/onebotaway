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

interface BusCommandInfo {
    busStopName: string;
    routeName: string;
    lookupSpanInMin: number; // look for arrivals from (now) to (now + X min)
    arrivals: {
        predicted: Date;
        scheduled: Date;
    }[];
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
    private _oneBusAway: OneBusAwayClient;
    private _controller;
    private _bot;
    private _interval;
    private _busCommandDefinition: BusCommandDefinition = {
        rules: [{
            // home stop
            startTime: 0, // midnight
            endTime: 39600000, // 11am
            stop: '1_13460', // Bellevue Ave & E Olive St
            route: '40_100236' //545
        },
        {
            // work stop
            startTime: 39601000, // 11:00:01 AM
            endTime: 86399000, // 11:59:59 PM
            stop: '1_71334', // Overlake TC - Bay 4
            route: '40_100236' //545
        }]
    }

    constructor(oneBusAway: OneBusAwayClient, slackToken: string) {
        this._oneBusAway = oneBusAway;
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
            this._respondToBotCommand(bot, message);
        });
    }
    
    private _respondToBotCommand(bot, message) {
        _.each(this._busCommandDefinition.rules, rule => {
            if (this._fitsRuleInterval(rule, new Date())) {
                let info: BusCommandInfo = {
                    busStopName: '',
                    routeName: '',
                    lookupSpanInMin: 100,
                    arrivals: []
                }
                
                this._oneBusAway.getStopInfo(rule.stop).then<any>(res => {
                    info.busStopName = (JSON.parse(res[0].body) as OneBusAwayStop).data.entry.name;
                    return this._oneBusAway.getRouteInfo(rule.route);
                }).then<any>(res => {
                    info.routeName = (JSON.parse(res[0].body) as OneBusAwayRoute).data.entry.shortName;
                    return this._oneBusAway.getArrivalInfo(rule.stop, info.lookupSpanInMin);
                }).then<any>(res => {
                    let arrivals = (JSON.parse(res[0].body) as OneBusAwayArrivalsAndDepartures).data.entry.arrivalsAndDepartures;
                    // Filter out routes we don't care about and busses that have already left
                    arrivals = _.filter(arrivals, arrival => {
                        return arrival.routeId === rule.route && arrival.predictedArrivalTime > new Date().getTime();
                    });
                    _.each(arrivals, arrival => {
                        info.arrivals.push({
                            predicted: new Date(arrival.predictedArrivalTime),
                            scheduled: new Date(arrival.scheduledArrivalTime)
                        });
                    });
                    bot.reply(message, this._getBotCommandReplyString(info));
                }).fail(err => {
                    console.log(err)
                    bot.reply(message, JSON.stringify(err));
                });
            }
        });
    }

    private _getBotCommandReplyString(info: BusCommandInfo) {
        let replyString = ':bus: `' + info.routeName + '` at :busstop:`' + info.busStopName + '`\n';
        if (info.arrivals.length === 0) {
            return replyString + 'No arrivals in the next ' + info.lookupSpanInMin + ' min';
        } else {
            let now = new Date();
            _.each(info.arrivals, arrival => {
                let minAway = Math.floor((arrival.predicted.getTime() - now.getTime()) / (60 * 1000));
                let offBy = Math.floor((arrival.predicted.getTime() - arrival.scheduled.getTime()) / (60 * 1000));
                let arrivalTimeString = arrival.predicted.getHours() + ':' + ("0" + arrival.predicted.getMinutes()).slice(-2);
                let offByString = offBy > 0 ? '(' + offBy + ' min late)' :
                                  offBy < 0 ? '(' + (offBy * -1) + ' min early)' :
                                  '(on time)';
                let emoji = offBy > 0 ? ':red_circle:' :
                            offBy < 0 ? ':large_blue_circle:' :
                            ':white_circle:';
                
                replyString += emoji + ' *' + minAway + ' min away* ' + offByString + ' - ' + arrivalTimeString + '\n';
            });
        }
        return replyString;
    }

    private _fitsRuleInterval(rule: BusCommandDefinitionRule, dateTime: Date): boolean {
        //Subtract the date to get just the time in milliseconds
        let time = dateTime.getTime() - Date.parse(dateTime.toDateString());
        //console.log(time > rule.startTime && time < rule.endTime);
        return time > rule.startTime && time < rule.endTime;
    }    
}

class OneBusAwayClient {
    private _oneBusAwayKey: string;
    private _oneBusAwayBaseUrl = 'http://api.pugetsound.onebusaway.org/api/where/';
    
    constructor(oneBusAwayKey: string) {
        this._oneBusAwayKey = oneBusAwayKey;
    }
    
    public getStopInfo(stop: string) {
        return Q.nfcall<any>(request, this._getOneBusAwayStopUrl(stop));
    }

    public getRouteInfo(route: string) {
        return Q.nfcall<any>(request, this._getOneBusAwayRouteUrl(route));
    }

    public getArrivalInfo(stop: string, minutesAfter: number) {
        return Q.nfcall<any>(request, this._getOneBusAwayArrivalsAndDeparturesUrl(stop, minutesAfter));
    }

    private _getOneBusAwayStopUrl(stopNumber: string): string {
        return this._oneBusAwayBaseUrl + 'stop/' + stopNumber + '.json?key=' + this._oneBusAwayKey;
    }

    private _getOneBusAwayRouteUrl(routeNumber: string): string {
        return this._oneBusAwayBaseUrl + 'route/' + routeNumber + '.json?key=' + this._oneBusAwayKey;
    }

    private _getOneBusAwayArrivalsAndDeparturesUrl(stopNumber: string, minutesAfter: number): string {
        return this._oneBusAwayBaseUrl + 'arrivals-and-departures-for-stop/' + stopNumber 
            + '.json?key=' + this._oneBusAwayKey + '&minutesAfter=' + minutesAfter;
    }
}

var bot = new OneBotAwayBot(new OneBusAwayClient(ONE_BUS_AWAY_KEY), SLACK_TOKEN);
bot.start();
