

// ============================================================================
// DATE HELPER FUNCTIONS
// ============================================================================

/**
 * Adds months to a date, handling end-of-month edge cases
 * @param {Date} date - Starting date
 * @param {number} months - Number of months to add
 * @param {number} targetDay - Target day of month (will clamp if month has fewer days)
 * @returns {Date} - New date with months added
 */
export function addMonthsSafe(date, months, targetDay) {
    let newMonth = date.getMonth() + months;
    let newYear = date.getFullYear();
    
    while (newMonth >= 12) {
        newMonth -= 12;
        newYear += 1;
    }
    
    const lastDayOfMonth = new Date(newYear, newMonth + 1, 0).getDate();
    return new Date(newYear, newMonth, Math.min(targetDay, lastDayOfMonth));
}

/**
 * Subtracts months from a date, handling end-of-month edge cases
 * @param {Date} date - Starting date
 * @param {number} months - Number of months to subtract
 * @param {number} targetDay - Target day of month (will clamp if month has fewer days)
 * @returns {Date} - New date with months subtracted
 */
export function subtractMonthsSafe(date, months, targetDay) {
    let newMonth = date.getMonth() - months;
    let newYear = date.getFullYear();
    
    while (newMonth < 0) {
        newMonth += 12;
        newYear -= 1;
    }
    
    const lastDayOfMonth = new Date(newYear, newMonth + 1, 0).getDate();
    return new Date(newYear, newMonth, Math.min(targetDay, lastDayOfMonth));
}

/**
 * Calculates the number of days between two dates
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {number} - Days between dates
 */
export function daysBetween(startDate, endDate) {
    return (endDate - startDate) / (1000 * 60 * 60 * 24);
}

/**
 * Calculates term in years between two dates
 * @param {Date} referenceDate
 * @param {Date} targetDate
 * @returns {number} - Years between dates
 */
export function calculateTerm(referenceDate, targetDate) {
    return daysBetween(referenceDate, targetDate) / 365.25;
}

export function parseDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr.includes('T')) return new Date(dateStr.split('T')[0]);
    return new Date(dateStr);
}

export function formatDate(date) {
    if (!date || !(date instanceof Date)) return 'null';
    return date.toISOString().split('T')[0];
}

export function addMonths(date, months) {
    /**
     * Add months to a date, handling end-of-month edge cases
     */
    const result = new Date(date);
    const originalDay = result.getDate();
    
    result.setMonth(result.getMonth() + months);
    
    // If the day changed due to month length differences
    if (result.getDate() !== originalDay) {
        // Set to last day of the target month
        result.setDate(0);
    }
    
    return result;
}

export function subtractMonths(date, months) {
    const result = new Date(date);
    const originalDay = result.getDate();

    result.setMonth(result.getMonth() - months);

    // If the day changed due to month length differences
    if (result.getDate() !== originalDay) {
        // Set to last day of the target month
        result.setDate(0);
    }

    return result;
}

export function daysBetween2(date1, date2) {
    if (!(date1 instanceof Date) || !(date2 instanceof Date)) {
        throw new Error('Both arguments must be Date objects');
    }

    if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
        throw new Error('Invalid date provided');
    }

    if (date2 < date1) {
        throw new Error(`date2 (${formatDate(date2)}) must be after date1 (${formatDate(date1)})`);
    }

    return Math.round((date2 - date1) / (24 * 60 * 60 * 1000));
}

export function getNextBusinessDay(date) {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    while (!isBusinessDay(next)) next.setDate(next.getDate() + 1);
    return next;
}

export function isBusinessDay(date) {
    /**
     * Check if a date is a business day (not weekend or holiday)
     */
    // Check weekend
    const day = date.getDay();
    if (day === 0 || day === 6) return false;

    // Check holidays
    const holidays = getUSFederalHolidays(date.getFullYear());
    const dateStr = formatDate(date);

    for (const holiday of holidays) {
        if (formatDate(holiday) === dateStr) {
            return false;
        }
    }

    return true;
}

function getUSFederalHolidays(year) {
    /**
     * Returns array of US federal holiday dates for given year
     * Includes Good Friday (market closed but not federal holiday)
     */
    const holidays = [];

    // New Year's Day
    holidays.push(new Date(year, 0, 1));

    // Martin Luther King Jr. Day (3rd Monday in January)
    holidays.push(getNthWeekdayOfMonth(year, 0, 1, 3));

    // Presidents' Day (3rd Monday in February)
    holidays.push(getNthWeekdayOfMonth(year, 1, 1, 3));

    // Good Friday (Friday before Easter - market closed)
    holidays.push(getGoodFriday(year));

    // Memorial Day (last Monday in May)
    holidays.push(getLastWeekdayOfMonth(year, 4, 1));

    // Independence Day
    holidays.push(new Date(year, 6, 4));

    // Labor Day (1st Monday in September)
    holidays.push(getNthWeekdayOfMonth(year, 8, 1, 1));

    // Columbus Day (2nd Monday in October)
    holidays.push(getNthWeekdayOfMonth(year, 9, 1, 2));

    // Veterans Day
    holidays.push(new Date(year, 10, 11));

    // Thanksgiving (4th Thursday in November)
    holidays.push(getNthWeekdayOfMonth(year, 10, 4, 4));

    // Christmas
    holidays.push(new Date(year, 11, 25));

    // Adjust for weekends (observed on Friday if Saturday, Monday if Sunday)
    return holidays.map(holiday => {
        const day = holiday.getDay();
        if (day === 6) { // Saturday -> Friday
            return new Date(holiday.getFullYear(), holiday.getMonth(), holiday.getDate() - 1);
        } else if (day === 0) { // Sunday -> Monday
            return new Date(holiday.getFullYear(), holiday.getMonth(), holiday.getDate() + 1);
        }
        return holiday;
    });
}

function getNthWeekdayOfMonth(year, month, weekday, n) {
    /**
     * Get the nth occurrence of a weekday in a month
     * weekday: 0=Sunday, 1=Monday, etc.
     * n: which occurrence (1=first, 2=second, etc.)
     */
    let date = new Date(year, month, 1);
    let count = 0;

    while (date.getMonth() === month) {
        if (date.getDay() === weekday) {
            count++;
            if (count === n) return new Date(date);
        }
        date.setDate(date.getDate() + 1);
    }

    return null;
}

function getLastWeekdayOfMonth(year, month, weekday) {
    /**
     * Get the last occurrence of a weekday in a month
     */
    let date = new Date(year, month + 1, 0); // Last day of month

    while (date.getDay() !== weekday) {
        date.setDate(date.getDate() - 1);
    }

    return new Date(date);
}

function getGoodFriday(year) {
    /**
     * Calculate Good Friday (Friday before Easter)
     * Using simplified Easter calculation (Gauss algorithm)
     */
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    const easter = new Date(year, month, day);
    const goodFriday = new Date(easter);
    goodFriday.setDate(easter.getDate() - 2);

    return goodFriday;
}