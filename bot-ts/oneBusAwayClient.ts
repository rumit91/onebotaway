/// <reference path="../typings/tsd.d.ts" />

import request = require('request');
import Q = require('q');

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

export = OneBusAwayClient;
