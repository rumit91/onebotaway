/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./custom-typings/botkit.d.ts" />

import Botkit = require('botkit');
import request = require('request');
import fs = require('fs');
import nconf = require('nconf');
import _ = require('lodash');
import Q = require('q');
import schedule = require('node-schedule');

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

interface BusArrivalsInfo {
    busStopName: string;
    routeName: string;
    lookupSpanInMin: number; // look for arrivals from (now) to (now + X min)
    arrivals: BusArrival[];
}

interface BusArrival {
    predicted: Date;
    scheduled: Date;
}

interface NotificationSchedule {
    stop: string;
    route: string;
    notificationsStartTime: {
        hour: number;
        //min: number; // Commenting out for now since it doesn't work well with Chron
    };
    notificationsEndTime: {
        hour: number;
        //min: number; // Commenting out for now since it doesn't work well with Chron
    };
    notifyOn: number[];
    minBetweenNotifications: number;
    travelTimeToStopInMin: number;
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
    private _scheduledJobs: schedule.Job[] = [];
    private _notificationSchedules: NotificationSchedule[] = [
        /* */
        {
            // Test Schedule
            stop: '1_71334', // Overlake TC - Bay 4
            route: '40_100236', //545
            notificationsStartTime: {
                hour: 20,
                //min: 27,
            },
            notificationsEndTime: {
                hour: 22,
                //min: 0,
            },
            notifyOn: [1,2,3,4,5],
            minBetweenNotifications: 1,
            travelTimeToStopInMin: 5
        },
        /**/
        {
            stop: '1_13460', // Bellevue Ave & E Olive St
            route: '40_100236', //545
            notificationsStartTime: {
                hour: 7,
                //min: 30,
            },
            notificationsEndTime: {
                hour: 10,
                //min: 0,
            },
            notifyOn: [1,2,3,4,5],
            minBetweenNotifications: 10,
            travelTimeToStopInMin: 5
        },
        {
            stop: '1_71334', // Overlake TC - Bay 4
            route: '40_100236', //545
            notificationsStartTime: {
                hour: 17,
                //min: 30,
            },
            notificationsEndTime: {
                hour: 20,
                //min: 0,
            },
            notifyOn: [1,2,3,4,5],
            minBetweenNotifications: 15,
            travelTimeToStopInMin: 12
        },
    ]

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
        this._setUpNotificationSchedule();
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
            if (this._fitsBusCommandRuleInterval(rule, new Date())) {                
                this._getBusArrivalsInfo(rule.stop, rule.route, 100).then(info => {
                    bot.reply(message, this._getBotCommandReplyString(info));
                });
            }
        });
    }
    
    private _getBusArrivalsInfo(stop: string, route: string, lookUpSpanInMin: number): Q.Promise<BusArrivalsInfo> {
        let info: BusArrivalsInfo = {
            busStopName: '',
            routeName: '',
            lookupSpanInMin: lookUpSpanInMin,
            arrivals: []
        };
        
        return this._oneBusAway.getStopInfo(stop).then<any>(res => {
            info.busStopName = (JSON.parse(res[0].body) as OneBusAwayStop).data.entry.name;
            return this._oneBusAway.getRouteInfo(route);
        }).then<any>(res => {
            info.routeName = (JSON.parse(res[0].body) as OneBusAwayRoute).data.entry.shortName;
            return this._oneBusAway.getArrivalInfo(stop, lookUpSpanInMin);
        }).then<any>(res => {
            let arrivals = (JSON.parse(res[0].body) as OneBusAwayArrivalsAndDepartures).data.entry.arrivalsAndDepartures;
            // Filter out routes we don't care about and busses that have already left
            arrivals = _.filter(arrivals, arrival => {
                return arrival.routeId === route && 
                    (arrival.predictedArrivalTime !== 0 ? arrival.predictedArrivalTime > new Date().getTime() 
                    : arrival.scheduledArrivalTime > new Date().getTime());
            });
            _.each(arrivals, arrival => {
                info.arrivals.push({
                    predicted: new Date(arrival.predictedArrivalTime),
                    scheduled: new Date(arrival.scheduledArrivalTime)
                });
            });
            return info;
        });
    }

    private _getBotCommandReplyString(info: BusArrivalsInfo): string {
        let replyString = ':bus: `' + info.routeName + '` at :busstop:`' + info.busStopName + '`\n';
        if (info.arrivals.length === 0) {
            return replyString + 'No arrivals in the next ' + info.lookupSpanInMin + ' min :scream:';
        } else {
            let now = new Date();
            _.each(info.arrivals, arrival => {
                let arrivalTime = arrival.predicted.getTime() === 0 ? arrival.scheduled : arrival.predicted;
                let minAway = Math.floor((arrivalTime.getTime() - now.getTime()) / (60 * 1000));
                let offBy = Math.floor((arrivalTime.getTime() - arrival.scheduled.getTime()) / (60 * 1000));
                let arrivalTimeString = this._getArrivalTimeString(arrival);
                let offByString = arrival.predicted.getTime() === 0 ? '(scheduled)' :
                                  offBy > 0 ? '(' + offBy + ' min late)' :
                                  offBy < 0 ? '(' + (offBy * -1) + ' min early)' :
                                  '(on time)';
                let emoji = arrival.predicted.getTime() === 0 ? ':black_circle:' :
                            offBy > 0 ? ':red_circle:' :
                            offBy < 0 ? ':large_blue_circle:' :
                            ':white_circle:';
                
                replyString += emoji + ' *' + minAway + ' min away* ' + offByString + ' - ' + arrivalTimeString + '\n';
            });
        }
        return replyString;
    }
    
    private _getArrivalTimeString(arrival: BusArrival): string {
        if (arrival.predicted.getTime() === 0) {
            return arrival.scheduled.getHours() + ':' + ("0" + arrival.scheduled.getMinutes()).slice(-2); 
        }
        return arrival.predicted.getHours() + ':' + ("0" + arrival.predicted.getMinutes()).slice(-2);
    }

    private _fitsBusCommandRuleInterval(rule: BusCommandDefinitionRule, dateTime: Date): boolean {
        //Subtract the date to get just the time in milliseconds
        let time = dateTime.getTime() - Date.parse(dateTime.toDateString());
        return time > rule.startTime && time < rule.endTime;
    }   
    
    private _setUpNotificationSchedule() {
        _.each(this._notificationSchedules, notifySchedule => {
            const cronString = this._getCronStringForNotificationSchedule(notifySchedule);
            this._scheduledJobs.push(schedule.scheduleJob(cronString, () => {
                this._getBusArrivalsInfo(notifySchedule.stop, notifySchedule.route, 100).then(info => {
                     this._bot.say({
                        text: this._getNotificationString(info, notifySchedule),
                        channel: 'D0KCKR12A'
                     });
                });
            }));
        });
    }
    
    private _getCronStringForNotificationSchedule(notifySchedule: NotificationSchedule): string {
        let cronString = '0 ';
            
        // Cron Min
        let cronMin = [];
        let tempMin = 0;
        while (tempMin < 60) {
            cronMin.push(tempMin);
            tempMin += notifySchedule.minBetweenNotifications;
        }
        cronString += cronMin.join(',') + ' ';
            
        // Cron Hour
        let cronHour = [];
        let tempHour = notifySchedule.notificationsStartTime.hour;
        while (tempHour < notifySchedule.notificationsEndTime.hour) {
            cronHour.push(tempHour);
            tempHour++;
        }
        if (cronHour.length < 1) {
            cronHour.push(tempHour);
        }
        cronString += cronHour.join(',') + ' ';
            
        //Cron Day of Month
        cronString += '* ';
            
        //Cron Month
        cronString += '* ';
            
        //Cron Day of Week
        cronString += notifySchedule.notifyOn.join(',');

        //console.log(cronString);

        return cronString;
    }
    
    private _getNotificationString(info: BusArrivalsInfo, notifySchedule: NotificationSchedule): string {
        let notificationStringContainer = ['Consider catching the :bus:'];
        let noArrivalsString = 'No *' + info.routeName + '* arrivals in the next *' + info.lookupSpanInMin + ' min* :scream:\n:confused: Good luck...'; 
        if (info.arrivals.length === 0) {
            return noArrivalsString;
        } else {
            let now = new Date();
            _.each(info.arrivals, arrival => {
                let arrivalTimeString = this._getArrivalTimeString(arrival);
                let needToLeaveInMin = this._getMinToLeaveIn(arrival, notifySchedule.travelTimeToStopInMin);
                if (needToLeaveInMin > 1) {
                    notificationStringContainer.push(':runner: in *' + needToLeaveInMin + ' min* to catch :bus: `' 
                        + info.routeName + '` at ' + arrivalTimeString + (arrival.predicted.getTime() === 0 ? ' (scheduled)' : ''));
                } 
            });
        }
        if (notificationStringContainer.length === 1) {
            return noArrivalsString;
        }
        return notificationStringContainer.join('\n');
    }
    
    private _getMinToLeaveIn(arrival: BusArrival, travelTimeToStopInMin: number): number {
        let arrivalTime = arrival.predicted.getTime() === 0 ? arrival.scheduled : arrival.predicted;
        let travelTimeInMillisec = travelTimeToStopInMin * 60 * 1000;
        let timeBeforeLeavingInMillisec = arrivalTime.getTime() - travelTimeInMillisec - (new Date()).getTime();
        return Math.floor(timeBeforeLeavingInMillisec / 1000 / 60);
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
