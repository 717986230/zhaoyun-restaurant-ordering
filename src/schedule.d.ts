/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Schedule {
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days: number[];
  /** "HH:MM" */
  from: string;
  /** "HH:MM"; earlier than `from` runs past midnight, equal means all day. */
  to: string;
}

export declare const WEEKDAYS: readonly Weekday[];
export declare const DEFAULT_TIME_ZONE: string;
export declare function normalizeSchedule(value: unknown): Schedule | null;
export declare function readSchedule(stored: unknown): Schedule | null;
export declare function isTimeZone(value: unknown): boolean;
export declare function normalizeTimeZone(value: unknown): string;
export declare function wallClock(date: Date, timeZone?: string): { day: Weekday; minute: number };
export declare function isOnSchedule(schedule: Schedule | null | undefined, date?: Date, timeZone?: string): boolean;
