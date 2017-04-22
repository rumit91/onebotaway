/// <reference path="../typings/tsd.d.ts" />
/// <reference path="./custom-typings/botkit.d.ts" />

import Botkit = require('botkit');
import _ = require('lodash');
import Q = require('q');
import schedule = require('node-schedule');
import OneBusAwayClient = require('./oneBusAwayClient');
import Models = require('./models');
import BusCommandDefinition = Models.BusCommandDefinition;
import BusCommandDefinitionRule = Models.BusCommandDefinitionRule;
import BusArrivalsInfo = Models.BusArrivalsInfo;
import BusArrival = Models.BusArrival;
import NotificationSchedule = Models.NotificationSchedule;
import OneBusAwayStop = Models.OneBusAwayStop;
import OneBusAwayRoute = Models.OneBusAwayRoute;
import OneBusAwayArrivalsAndDepartures = Models.OneBusAwayArrivalsAndDepartures;

class OneBotAwayBot {
    private _oneBusAway: OneBusAwayClient;
    private _controller;
    private _bot;
    //TODO: Remove hardcoded utc offset. Get from config instead.
    private _userUtcOffset = -8 * 60 * 60 * 1000;
    private _runningToBus = false;
    private _runningToStopId: string;
    private _runningToRouteId: string;
    private _runningToVehicleId: string;
    private _busCommandDefinition: BusCommandDefinition = {
        rules: [{
            // home stop
            startTime: 0, // midnight
            endTime: 39600000, // 11am
            stop: '1_13460', // Bellevue Ave & E Olive St
            route: '40_100236', //545
            travelTimeToStopInMin: 5
        },
        {
            // work stop
            startTime: 39601000, // 11:00:01 AM
            endTime: 86399000, // 11:59:59 PM
            stop: '1_71334', // Overlake TC - Bay 4
            route: '40_100236', //545
            travelTimeToStopInMin: 12
        }]
    }
    private _scheduledJobs: schedule.Job[] = [];
    private _notificationSchedules: NotificationSchedule[] = [        
        /*{
            // Test Schedule
            stop: '1_71334', // Overlake TC - Bay 4
            route: '40_100236', //545
            notificationsStartTime: {
                hour: 12,
                min: 20,
            },
            notificationsEndTime: {
                hour: 23,
                min: 0,
            },
            notifyOn: [1,2,3,4,5],
            secBetweenNotifications: 50,
            travelTimeToStopInMin: 12,
            skipOn: []
        },*/
        {
            stop: '1_13460', // Bellevue Ave & E Olive St
            route: '40_100236', //545
            notificationsStartTime: {
                hour: 7,
                min: 30,
            },
            notificationsEndTime: {
                hour: 10,
                min: 0,
            },
            notifyOn: [1,2,3,4,5], // Mon - Fri
            secBetweenNotifications: 550,
            travelTimeToStopInMin: 5,
            skipOn: []
        },
        {
            stop: '1_71334', // Overlake TC - Bay 4
            route: '40_100236', //545
            notificationsStartTime: {
                hour: 17,
                min: 30,
            },
            notificationsEndTime: {
                hour: 20,
                min: 0,
            },
            notifyOn: [1,2,3,4,5], // Mon - Fri
            secBetweenNotifications: 850,
            travelTimeToStopInMin: 12,
            skipOn: []
        }
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
    }

    start() {
        // Connect bot to real-time messaging.
        this._bot.startRTM(function(err) {
            if (err) {
                throw new Error(err);
            }
        });
    }
    
    notify() {
        _.each(this._notificationSchedules, notifySchedule => {
            if (this._jobShouldRun(notifySchedule)) {
                console.log('---------------------------------');
                console.log('Running schedule');
                console.log(this._getStringForSchedule(notifySchedule));
                this._getBusArrivalsInfo(notifySchedule.stop, notifySchedule.route, 100).then(info => {
                    this._bot.say({
                        text: this._getBotCommandReplyString(info),
                        channel: 'D0KCKR12A'
                    });
                });
                notifySchedule.lastNotifiedOn = new Date();
            }
        });
    }
    
    run() {
        if (this._runningToBus) {
            this._getBusArrivalsInfo(this._runningToStopId, this._runningToRouteId, 100).then(info => {
                const vehicleIds = _.map(info.arrivals, 'vehicleId');
                console.log('VehicleIds: ' + vehicleIds);
                console.log('Running to: ' + this._runningToVehicleId);
                if (_.includes(vehicleIds, this._runningToVehicleId)) {
                    this._bot.say({
                        text: this._getBotCommandReplyString(info),
                        channel: 'D0KCKR12A'
                    });
                } else {
                    this._bot.say({
                        text: 'I hope you made your bus!',
                        channel: 'D0KCKR12A'
                    });
                    this._runningToBus = false;
                }
            });
        }
    }

    private _setUpListeningCommands() {
        this._controller.hears(['hi'], ['direct_message'], (bot, message) => {
            bot.reply(message, 'Hi! I\'m a bus bot.');
        });

        this._controller.hears(['bus'], ['direct_message'], (bot, message) => {
            this._respondToBusCommand(bot, message);
        });
        
        this._controller.hears(['run'], ['direct_message'], (bot, message) => {
           this._respondToRunCommand(bot, message); 
        });
        
        this._controller.hears(['skip'], ['direct_message'], (bot, message) => {
           this._respondToSkipCommand(bot, message); 
        });
        
        this._controller.hears(['schedule'], ['direct_message'], (bot, message) => {
            _.each(this._notificationSchedules, notifySchedule => {
               const scheduleString = this._getStringForSchedule(notifySchedule);
               const dollarString = ':dollar::dollar::dollar::dollar::dollar::dollar::dollar::dollar::dollar::dollar:'; 
               bot.reply(message, scheduleString + '\n' + dollarString);
            });
        });
    }
    
    private _getStringForSchedule(notifySchedule: NotificationSchedule): string {
        let scheduleString = 'Stop: `' +  notifySchedule.stop + '`\n';
        scheduleString += 'Route: `' + notifySchedule.route + '`\n';
        scheduleString += 'StartTime: `' + notifySchedule.notificationsStartTime.hour + '`\n';
        scheduleString += 'EndTime: `' + notifySchedule.notificationsEndTime.hour + '`\n';
        scheduleString += 'NotifyOn: `' + notifySchedule.notifyOn.join(', ') + '`\n';
        scheduleString += 'SecBetweenNotifications: `' + notifySchedule.secBetweenNotifications + '`\n';
        scheduleString += 'TravelTime: `' + notifySchedule.travelTimeToStopInMin + '`';
        return scheduleString;
    }
    
    private _getCronStringForPrinting(cronString: string): string {
        let cronSubstrings = cronString.split(' ');
        let stringForPrinting = 'Sec: `' + cronSubstrings[0] + '`\n';
        stringForPrinting += 'Min: `' + cronSubstrings[1] + '`\n';
        stringForPrinting += 'Hour: `' + cronSubstrings[2] + '`\n';
        stringForPrinting += 'Day of Month: `' + cronSubstrings[3] + '`\n';
        stringForPrinting += 'Month: `' + cronSubstrings[4] + '`\n';
        stringForPrinting += 'Day of Week: `' + cronSubstrings[5] + '`\n';
        return stringForPrinting;        
    }
    
    private _respondToRunCommand(bot, message) {
        if(this._runningToBus) {
            bot.reply(message, 'Already running to bus!');
        } else {
            this._runningToBus = true;
            let foundSchedule = false;
            _.each(this._notificationSchedules, notifySchedule => {
                if (this._fitsNotificationScheduleInterval(notifySchedule) && !foundSchedule) {
                    foundSchedule = true;
                    this._runningToStopId = notifySchedule.stop;
                    this._runningToRouteId = notifySchedule.route;
                    bot.reply(message, 'Godspeed! I\'ll keep you posted with arrival times.');                
                    this._getBusArrivalsInfo(notifySchedule.stop, notifySchedule.route, 100, notifySchedule.travelTimeToStopInMin).then(info => {
                        this._runningToVehicleId = info.arrivals[0].vehicleId;
                    });
                }
            });
            
            if (!foundSchedule) {
                let bummerString = ':cold_sweat: I can\'t find any notification schedules for the current time,' 
                                 + ' so I don\'t know what bus you are running to.\n' 
                                 + 'Sorry I coudn\'t help you. Please check your notification schedules.';
                this._bot.say({
                    text: bummerString,
                    channel: 'D0KCKR12A'
                });
            }
        }
    }
    
    private _respondToSkipCommand(bot, message) {
        let foundSchedule = false;
        _.each(this._notificationSchedules, notifySchedule => {
            if (this._fitsNotificationScheduleInterval(notifySchedule)) {
                foundSchedule = true;
                this._getBusArrivalsInfo(notifySchedule.stop, notifySchedule.route, 30).then(info => {
                    bot.reply(message, 'Ok I won\'t send you anymore updates about the :bus: `' 
                        + info.routeName + '` at :busstop: `' + info.busStopName + '` for the rest of the day.');
                    notifySchedule.skipOn.push(this._getCurrentUserDate());
                });
            }
        });
        if (!foundSchedule) {
            let bummerString = 'I can\'t find any notification schedules for the current time,' 
                                + ' so there\'s nothing to skip.';
            this._bot.say({
                text: bummerString,
                channel: 'D0KCKR12A'
            });
        }
    }
    
    private _respondToBusCommand(bot, message) {
        _.each(this._busCommandDefinition.rules, rule => {
            if (this._fitsBusCommandRuleInterval(rule)) {                
                this._getBusArrivalsInfo(rule.stop, rule.route, 100).then(info => {
                    let take = 5;
                    if(parseInt(message.text.substring(4)) > 0) {
                        take = parseInt(message.text.substring(4));
                    }
                    bot.reply(message, this._getBotCommandReplyString(info, take));
                });
            }
        });
    }
    
    private _fitsBusCommandRuleInterval(rule: BusCommandDefinitionRule): boolean {
        const currentDateTime = new Date();
        // Check if we are at UTC so that we can offset appropriately
        let offset = this._userUtcOffset - this._getServerUtcOffsetInMs(); 
        
        // Subtract the date to get just the time in milliseconds
        let time = currentDateTime.getTime() - Date.parse(currentDateTime.toDateString()) + (offset);
        // If time is negative we have crossed the day boundary.
        if (time < 0) {
            time += (24 * 60 * 60 * 1000); // Add 24 hrs to account for day boundary.
        }
        //console.log('Date: ' + dateTime);
        //console.log('time: ' + time + ' startTime: ' + rule.startTime + ' endTime: ' + rule.endTime);
        return time > rule.startTime && time < rule.endTime;
    }
    
    private _fitsNotificationScheduleInterval(notifySchedule: NotificationSchedule): boolean {
        const currentDateTime = new Date();
        // Check if we are at UTC so that we can offset appropriately
        let offset = this._userUtcOffset - this._getServerUtcOffsetInMs();
        
        // Subtract the date to get just the time in milliseconds
        let time = currentDateTime.getTime() - Date.parse(currentDateTime.toDateString()) + (offset);
        // If time is negative we have crossed the day boundary.
        if (time < 0) {
            time += (24 * 60 * 60 * 1000); // Add 24 hrs to account for day boundary.
        }
        
        const scheduleStartTime = notifySchedule.notificationsStartTime.hour * 60 * 60 * 1000
            + notifySchedule.notificationsStartTime.min * 60 * 1000;
        const scheduleEndTime = notifySchedule.notificationsEndTime.hour * 60 * 60 * 1000
            + notifySchedule.notificationsEndTime.min * 60 * 1000;
            
        return time > scheduleStartTime && time < scheduleEndTime;
    }
    
    private _getBusArrivalsInfo(stop: string, route: string, lookUpSpanInMin: number, travelTimeToStop = 0): Q.Promise<BusArrivalsInfo> {
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
            const travelTimeInMillisec = travelTimeToStop * 60 * 1000;
            // Filter out routes we don't care about and busses that have already left
            arrivals = _.filter(arrivals, arrival => {
                return arrival.routeId === route && 
                    (arrival.predictedArrivalTime !== 0 ? arrival.predictedArrivalTime - travelTimeInMillisec > new Date().getTime() 
                    : arrival.scheduledArrivalTime - travelTimeInMillisec > new Date().getTime());
            });
            _.each(arrivals, arrival => {
                info.arrivals.push({
                    predicted: new Date(arrival.predictedArrivalTime),
                    scheduled: new Date(arrival.scheduledArrivalTime),
                    vehicleId: arrival.vehicleId
                });
            });
            return info;
        });
    }

    private _getBotCommandReplyString(info: BusArrivalsInfo, take: number = 5): string {
        let replyString = ':bus: `' + info.routeName + '` at :busstop:`' + info.busStopName + '`\n';
        if (info.arrivals.length === 0) {
            return replyString + 'No arrivals in the next ' + info.lookupSpanInMin + ' min :scream:';
        } else {
            let now = new Date();
            _.each(_.take(info.arrivals, take), arrival => {
                const arrivalTime = arrival.predicted.getTime() === 0 ? arrival.scheduled : arrival.predicted;
                const minAway = Math.floor((arrivalTime.getTime() - now.getTime()) / (60 * 1000));
                const offByString = this._getOffByStatusString(arrival);
                const arrivalTimeString = this._getArrivalTimeString(arrival);
                
                replyString += '*' + minAway + ' min away* ' + offByString + ' - ' + arrivalTimeString + '\n';
            });
        }
        return replyString;
    }
    
    private _getOffByStatusString(arrival: BusArrival): string {
        const arrivalTime = arrival.predicted.getTime() === 0 ? arrival.scheduled : arrival.predicted;
        const offBy = Math.floor((arrivalTime.getTime() - arrival.scheduled.getTime()) / (60 * 1000));
        const statusEmoji = arrival.predicted.getTime() === 0 ? ':black_circle:' :
                          offBy > 0 ? ':red_circle:' :
                          offBy < 0 ? ':large_blue_circle:' :
                          ':white_circle:';
        return arrival.predicted.getTime() === 0 ? '(' + statusEmoji + 'scheduled)' :
               offBy > 0 ? '(' + statusEmoji + offBy + ' min late)' :
               offBy < 0 ? '(' + statusEmoji + (offBy * -1) + ' min early)' :
               '(' + statusEmoji + ' on time)';
    }
    
    private _getArrivalTimeString(arrival: BusArrival): string {
        if (arrival.predicted.getTime() === 0) {
            return this._convertUtcHoursToUserTimezone(arrival.scheduled.getHours()) + ':' + ("0" + arrival.scheduled.getMinutes()).slice(-2); 
        }
        return this._convertUtcHoursToUserTimezone(arrival.predicted.getHours()) + ':' + ("0" + arrival.predicted.getMinutes()).slice(-2);
    }
    
    private _convertUtcHoursToUserTimezone(hours: number): number {
        let offsetInHours = (this._userUtcOffset - this._getServerUtcOffsetInMs()) / 1000 / 60 / 60;
        let userHours = (hours + offsetInHours);
        userHours =  userHours >= 24 ? userHours - 24 : 
                     userHours < 0 ? userHours + 24 :
                     userHours;
        return userHours;
    }
    
    private _convertUserHoursToUtc(hours: number): number {
        let offsetInHours = (this._userUtcOffset - this._getServerUtcOffsetInMs()) / 1000 / 60 / 60;
        let utcHours = (hours - offsetInHours);
        utcHours = utcHours >= 24 ? utcHours - 24 : 
                   utcHours < 0 ? utcHours + 24 :
                   utcHours;
        return utcHours;
    }
    
    private _jobShouldRun(notifySchedule: NotificationSchedule): boolean {
        return !this._runningToBus
               && !this._shouldSkipSchedule(notifySchedule)
               && this._timeIsWithinSchedule(notifySchedule) 
               && this._dayOfWeekIsWithinSchedule(notifySchedule)
               && this._enoughTimePassedSinceLastNotification(notifySchedule);    
    }
    
    private _shouldSkipSchedule(notifySchedule: NotificationSchedule): boolean {
        let shouldSkip = false;
        const currentDate = this._getCurrentUserDate();
        console.log('---------------------------------');
        console.log('Current Date: ' + currentDate);
        console.log('Skip On: ' + notifySchedule.skipOn);
        
        shouldSkip = _.filter(notifySchedule.skipOn, skipDate => {
            return skipDate.getTime() == currentDate.getTime();
        }).length > 0;
        
        // Filter out old skip dates.
        notifySchedule.skipOn = _.filter(notifySchedule.skipOn, skipDate => {
            return skipDate.getTime() >= currentDate.getTime();
        });
        
        if (shouldSkip) {
            console.log('Skipping Schedule');
        }
        
        return shouldSkip;
    }
    
    private _getCurrentUserDate(): Date {
        const currentDateTime = new Date();
        let currentDate = new Date(currentDateTime.getTime() + this._userUtcOffset - this._getServerUtcOffsetInMs());  
        currentDate.setHours(0, 0, 0, 0);
        return currentDate;
    }
    
    private _timeIsWithinSchedule(notifySchedule: NotificationSchedule): boolean {
        const startTimeInMillisec = notifySchedule.notificationsStartTime.hour * 60 * 60 * 1000
            + notifySchedule.notificationsStartTime.min * 60 * 1000;
        const endTimeInMillisec = notifySchedule.notificationsEndTime.hour * 60 * 60 * 1000
            + notifySchedule.notificationsEndTime.min * 60 * 1000;
        
        const currentDateTime = new Date();
        const currentDate =  new Date(currentDateTime.getFullYear(), currentDateTime.getMonth(), currentDateTime.getDate());
        let currentTimeInMillisec = currentDateTime.getTime() - currentDate.getTime() + this._userUtcOffset - this._getServerUtcOffsetInMs();
        const dayInMillisec = 24 * 60 * 60 * 1000;
        currentTimeInMillisec = currentTimeInMillisec >= dayInMillisec ? currentTimeInMillisec - dayInMillisec : 
                                currentTimeInMillisec < 0 ? currentTimeInMillisec + dayInMillisec :
                                currentTimeInMillisec;
        
        console.log('---------------------------------');
        console.log('start: ' + startTimeInMillisec + '\n' 
            + 'current: ' + currentTimeInMillisec + '\n' 
            + 'end: ' + endTimeInMillisec + '\n'
            + 'in schedule: ' + (currentTimeInMillisec >= startTimeInMillisec && currentTimeInMillisec < endTimeInMillisec));
        
        return currentTimeInMillisec >= startTimeInMillisec && currentTimeInMillisec < endTimeInMillisec;
    }
    
    private _dayOfWeekIsWithinSchedule(notifySchedule: NotificationSchedule): boolean {
        let currentTimestamp = new Date().getTime() + this._userUtcOffset - this._getServerUtcOffsetInMs();
        let currentDayOfWeek = new Date(currentTimestamp).getDay();
        
        console.log('current DayOfWeek: ' + currentDayOfWeek + '\n' 
            + 'in schedule: ' + _.includes(notifySchedule.notifyOn, currentDayOfWeek));
        
        return _.includes(notifySchedule.notifyOn, currentDayOfWeek);
    }
    
    private _enoughTimePassedSinceLastNotification(notifySchedule: NotificationSchedule): boolean {
        const enoughTime = notifySchedule.lastNotifiedOn 
            ? (new Date()).getTime() >= notifySchedule.lastNotifiedOn.getTime() + (notifySchedule.secBetweenNotifications*1000) 
            : true;
        console.log('---------------------------------');
        console.log('Last Notified On: ' + notifySchedule.lastNotifiedOn);
        console.log('Sec between notifications: ' + notifySchedule.secBetweenNotifications);
        console.log('Enough time pass?: ' + enoughTime);
        return enoughTime;
    }
    
    private _getNotificationString(info: BusArrivalsInfo, notifySchedule: NotificationSchedule): string {
        let notificationStringContainer = ['Catching the :bus: ' + info.routeName + '?'];
        let noArrivalsString = 'No *' + info.routeName + '* arrivals in the next *' + info.lookupSpanInMin + ' min* :scream:\n:confused: Good luck...'; 
        if (info.arrivals.length === 0) {
            return noArrivalsString;
        } else {
            let now = new Date();
            _.each(info.arrivals, arrival => {
                let arrivalTimeString = this._getArrivalTimeString(arrival);
                let needToLeaveInMin = this._getMinToLeaveIn(arrival, notifySchedule.travelTimeToStopInMin);
                if (needToLeaveInMin > 1) {
                    const arrivalTime = arrival.predicted.getTime() === 0 ? arrival.scheduled : arrival.predicted;
                    const offByString = this._getOffByStatusString(arrival);
                    
                    notificationStringContainer.push(':runner: in *' + needToLeaveInMin + ' min* - ' 
                        + arrivalTimeString + ' ' + offByString);
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
    
    private _getServerUtcOffsetInMs() {
        return new Date().getTimezoneOffset() * 60 * 1000 * -1;
    }
}

export = OneBotAwayBot;
