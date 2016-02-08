export interface BusCommandDefinition {
    rules: BusCommandDefinitionRule[];
}

export interface BusCommandDefinitionRule {
    startTime: number;
    endTime: number;
    stop: string;
    route: string;
    travelTimeToStopInMin: number;
}

export interface BusArrivalsInfo {
    busStopName: string;
    routeName: string;
    lookupSpanInMin: number; // look for arrivals from (now) to (now + X min)
    arrivals: BusArrival[];
}

export interface BusArrival {
    predicted: Date;
    scheduled: Date;
    vehicleId: string;
}

export interface NotificationSchedule {
    stop: string;
    route: string;
    notificationsStartTime: {
        hour: number;
        min: number;
    };
    notificationsEndTime: {
        hour: number;
        min: number;
    };
    notifyOn: number[];
    minBetweenNotifications: number;
    travelTimeToStopInMin: number;
    skipOn: Date[];
}

export interface OneBusAwayStop {
    // TODO: Complete this definition
    data: {
        entry: {
            code: string;
            id: string;
            name: string;
        }
    }
}

export interface OneBusAwayRoute {
    // TODO: Complete this definition
    data: {
        entry: {
            id: string;
            longName: string;
            shortName: string;
        }
    }
}

export interface OneBusAwayArrivalsAndDepartures {
    // TODO: Complete this definition
    data: {
        entry: {
            arrivalsAndDepartures: {
                routeId: string;
                scheduledArrivalTime: number;
                predictedArrivalTime: number;
                vehicleId: string;
            }[];
        }
    }
}
